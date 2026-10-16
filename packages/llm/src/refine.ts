import { z } from 'zod';
import { EditOpSchema, applyEditOps, type EditOp, type SystemModel, type ViewType } from '@archwoven/model';
import {
  CONTEXT_TOKEN_LIMIT, MAX_REPAIRS, MODEL, STRUCTURED_OUTPUTS_BETA, fakeMode, makeAnthropic, resolveApiKey, usageFrom, wireSchema,
  type Effort, type StructuredClient,
} from './client';
import type { RawUsage } from './client';

export type RefineOutcome =
  | { ok: true; ops: EditOp[]; usage: ReturnType<typeof usageFrom> }
  | { ok: false; errors: string[]; usage: ReturnType<typeof usageFrom> };

const refinementSystem = (wire: boolean): string => `You are Archwoven's refinement model. Given the current system model JSON and one user instruction, emit ONLY a JSON array of EditOps that implements the instruction — never the whole model.

EditOp shape: { op: "add"|"remove"|"update"|"move", target: id, patch: ${wire ? '"<JSON-encoded object>"' : '{<native JSON properties>}'}, baseRevision: <current revision>, summary: "<short human summary>" }. The patch field is ${wire ? 'a STRING containing the JSON object' : 'an OBJECT containing native JSON properties'}. Example patch encoding: ${JSON.stringify({ patch: wire ? JSON.stringify({ id: 'svc.cache', kind: 'service' }) : { id: 'svc.cache', kind: 'service' } })}.
Hard rules:
- baseRevision must equal the current model revision exactly.
- add patch for a node: full node {id, kind, label, provenance}; for an edge: full edge {id, from, to, type, provenance}. Edge endpoints must already exist in the model.
- remove only unreferenced elements; if you must remove a node with edges, emit the edge removes first, then the node.
- move patch is {x, y} and changes layout only.
- never invent business-critical components as user-specified; use "proposed" unless the instruction states it.
- fewest ops that satisfy the instruction; no comments, no markdown.`;

export const REFINEMENT_SYSTEM = refinementSystem(true);
export const LOCAL_REFINEMENT_SYSTEM = refinementSystem(false);

const opsSchema = wireSchema(z.toJSONSchema(z.array(EditOpSchema), { reused: 'inline', target: 'draft-2020-12' }));

const textOf = (content: { type: string; text?: string }[]) =>
  content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');

/**
 * Refinement = bounded EditOps, validated by applying them against the current
 * model before returning. Unparseable or unappliable output repairs within the
 * same budget as generation; the caller's model is never mutated on failure.
 */
export async function generateRefinement(
  instruction: string,
  model: SystemModel,
  view: ViewType,
  opts: { client?: StructuredClient; effort?: Effort } = {},
): Promise<RefineOutcome> {
  const effort: Effort = opts.effort ?? 'low';
  if (!opts.client && fakeMode()) {
    const ops: EditOp[] = [{ op: 'add', target: 'svc.cache', patch: { id: 'svc.cache', kind: 'service', label: 'Cache', provenance: 'proposed' }, baseRevision: model.revision, summary: '+Cache service' }];
    return { ok: true, ops, usage: { model: MODEL, effort, inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, latencyMs: 0, repairs: 0 } };
  }
  const client: StructuredClient =
    opts.client ?? (makeAnthropic(resolveApiKey()) as unknown as StructuredClient);

  const t0 = Date.now();
  const messages: unknown[] = [
    { role: 'user', content: `View: ${view}\n\nCurrent model JSON (revision ${model.revision}):\n${JSON.stringify(model)}\n\nInstruction: ${instruction}` },
  ];
  const system = [{ type: 'text', text: REFINEMENT_SYSTEM, cache_control: { type: 'ephemeral' } }];

  // §15 per-request gate: exact token count before send; fail closed.
  try {
    const counted = await client.messages.countTokens({ model: MODEL, system, messages });
    if (counted.input_tokens > CONTEXT_TOKEN_LIMIT) {
      return { ok: false, errors: ['assembled context exceeds the 25k token limit — scope the instruction down'], usage: usageFrom({}, effort, Date.now() - t0, 0) };
    }
  } catch (e) {
    return { ok: false, errors: [`context token count failed: ${e instanceof Error ? e.message : String(e)}`], usage: usageFrom({}, effort, Date.now() - t0, 0) };
  }

  let lastErrors: string[] = [];
  let repairs = 0;
  const billed: Required<RawUsage> = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
  const addUsage = (u: RawUsage) => {
    billed.input_tokens += u.input_tokens ?? 0;
    billed.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
    billed.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
    billed.output_tokens += u.output_tokens ?? 0;
  };

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    let response: Awaited<ReturnType<StructuredClient['beta']['messages']['create']>>;
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        betas: [STRUCTURED_OUTPUTS_BETA],
        system,
        messages,
        output_config: { format: { type: 'json_schema', schema: opsSchema }, effort },
      });
    } catch (e) {
      lastErrors = [`request failed: ${e instanceof Error ? e.message : String(e)}`];
      continue;
    }
    addUsage(response.usage);

    const text = textOf(response.content);
    let ops: unknown;
    try {
      ops = JSON.parse(text);
      // wire grammar encodes patch (a z.record) as a JSON string — decode back to object
      if (Array.isArray(ops)) {
        for (const op of ops) {
          if (op && typeof op === 'object' && typeof (op as { patch?: unknown }).patch === 'string') {
            try { (op as { patch: unknown }).patch = JSON.parse((op as { patch: string }).patch); } catch { /* leave — schema error surfaces */ }
          }
        }
      }
    } catch (e) {
      lastErrors = [`ops were not valid JSON: ${e instanceof Error ? e.message : String(e)}`];
      if (attempt < MAX_REPAIRS) {
        repairs++;
        messages.push({ role: 'assistant', content: text });
        messages.push({ role: 'user', content: 'Your previous response was not a valid EditOps JSON array — emit the complete valid array only.' });
      }
      continue;
    }
    const checked = z.array(EditOpSchema).safeParse(ops);
    if (!checked.success) {
      lastErrors = checked.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    } else {
      const badBase = checked.data.filter((o) => o.baseRevision !== model.revision);
      if (badBase.length > 0) {
        lastErrors = [`baseRevision must be ${model.revision}`];
      } else {
        const applied = applyEditOps(model, checked.data);
        if (applied.ok) return { ok: true, ops: checked.data, usage: usageFrom(billed, effort, Date.now() - t0, repairs) };
        lastErrors = applied.errors;
      }
    }
    if (attempt < MAX_REPAIRS) {
      repairs++;
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: `These EditOps failed validation — fix them and emit the complete corrected array only:\n- ${lastErrors.join('\n- ')}` });
    }
  }

  return { ok: false, errors: lastErrors, usage: usageFrom(billed, effort, Date.now() - t0, repairs) };
}

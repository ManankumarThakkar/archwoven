import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { EditOpSchema, applyEditOps, type EditOp, type SystemModel, type ViewType } from '@archwoven/model';
import {
  MODEL, MAX_REPAIRS, STRUCTURED_OUTPUTS_BETA, fakeMode, resolveApiKey, usageFrom,
  type Effort, type StructuredClient,
} from './client';

export type RefineOutcome =
  | { ok: true; ops: EditOp[]; usage: ReturnType<typeof usageFrom> }
  | { ok: false; errors: string[]; usage: ReturnType<typeof usageFrom> };

const REFINEMENT_SYSTEM = `You are Archwoven's refinement model. Given the current system model JSON and one user instruction, emit ONLY a JSON array of EditOps that implements the instruction — never the whole model.

EditOp shape: { op: "add"|"remove"|"update"|"move", target: id, patch: {...}, baseRevision: <current revision>, summary: "<short human summary>" }.
Hard rules:
- baseRevision must equal the current model revision exactly.
- add patch for a node: full node {id, kind, label, provenance}; for an edge: full edge {id, from, to, type, provenance}. Edge endpoints must already exist in the model.
- remove only unreferenced elements; if you must remove a node with edges, emit the edge removes first, then the node.
- move patch is {x, y} and changes layout only.
- never invent business-critical components as user-specified; use "proposed" unless the instruction states it.
- fewest ops that satisfy the instruction; no comments, no markdown.`;

const opsSchema = z.toJSONSchema(z.array(EditOpSchema), { reused: 'inline', target: 'draft-2020-12' });

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
    opts.client ?? (new Anthropic({ apiKey: resolveApiKey() }) as unknown as StructuredClient);

  const t0 = Date.now();
  const messages: unknown[] = [
    { role: 'user', content: `View: ${view}\n\nCurrent model JSON (revision ${model.revision}):\n${JSON.stringify(model)}\n\nInstruction: ${instruction}` },
  ];

  let lastErrors: string[] = [];
  let repairs = 0;
  let usage = usageFrom({}, effort, 0, 0);

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    let response: Awaited<ReturnType<StructuredClient['beta']['messages']['create']>>;
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        betas: [STRUCTURED_OUTPUTS_BETA],
        system: [{ type: 'text', text: REFINEMENT_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages,
        output_config: { format: { type: 'json_schema', schema: opsSchema, name: 'edit_ops' }, effort },
      });
    } catch (e) {
      lastErrors = [`request failed: ${e instanceof Error ? e.message : String(e)}`];
      usage = usageFrom({}, effort, Date.now() - t0, repairs);
      continue;
    }
    usage = usageFrom(response.usage, effort, Date.now() - t0, repairs);

    const text = textOf(response.content);
    let ops: unknown;
    try {
      ops = JSON.parse(text);
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
        if (applied.ok) return { ok: true, ops: checked.data, usage };
        lastErrors = applied.errors;
      }
    }
    if (attempt < MAX_REPAIRS) {
      repairs++;
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: `These EditOps failed validation — fix them and emit the complete corrected array only:\n- ${lastErrors.join('\n- ')}` });
    }
  }

  return { ok: false, errors: lastErrors, usage };
}

import { newUsageLedger, startAttempt, captureUsage } from './usage';
import { z } from 'zod';
import { EditOpSchema, HOSTED_REQUESTS, applyEditOps, isSourceEvidenceRefusal, sameModelContent, type EditOp, type SystemModel, type ViewType } from '@archwoven/model';
import {
  CONTEXT_TOKEN_LIMIT, MAX_REPAIRS, MODEL, configuredHostedModel, STRUCTURED_OUTPUTS_BETA, fakeMode, countFailureMessage, hostedClient, usageFrom, wireSchema, providerRequestStopped,
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
- Views list their members automatically: new nodes and edges join the architecture view, so never target a view id.
- semanticChecks, guided chapters, boundaries, view mainPath and sequence views are maintained by the server: never target semanticChecks or any of them. Removing a node or edge updates them automatically; new sources and sinks are allowed.
- A required link or path between source-supported elements cannot be removed or retyped. If the instruction asks for that, still emit the op: the server refuses it and explains why to the user. Never emit an empty array.
- fewest ops that satisfy the instruction; no comments, no markdown.`;

/** An empty batch would save a no-op revision with no explanation; it is repaired like any invalid output. */
export const EMPTY_OPS_ERROR = 'No EditOps were emitted. Implement the instruction with at least one op; if it targets a source-backed requirement, still emit the op so the server can explain the refusal.';

/** A batch that applies but changes nothing would read as success; it is repaired too. */
export const NO_CHANGE_ERROR = 'These EditOps change nothing. Implement the instruction; if it targets a source-backed requirement, emit the op that does so and the server will explain the refusal.';

export const REFINEMENT_SYSTEM = refinementSystem(true);
export const LOCAL_REFINEMENT_SYSTEM = refinementSystem(false);

export const REFINEMENT_OUTPUT_SCHEMA = wireSchema(z.toJSONSchema(z.array(EditOpSchema), { reused: 'inline', target: 'draft-2020-12' }));

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
  opts: { client?: StructuredClient; effort?: Effort; signal?: AbortSignal } = {},
): Promise<RefineOutcome> {
  const effort: Effort = opts.effort ?? HOSTED_REQUESTS.refine.effort;
  const modelId = !opts.client && fakeMode() ? MODEL : configuredHostedModel();
  if (opts.signal?.aborted) return { ok: false, errors: ['Refinement cancelled.'], usage: usageFrom({}, effort, 0, 0, modelId) };
  if (!opts.client && fakeMode()) {
    const ops: EditOp[] = [{ op: 'add', target: 'svc.cache', patch: { id: 'svc.cache', kind: 'service', label: 'Cache', provenance: 'proposed' }, baseRevision: model.revision, summary: '+Cache service' }];
    return { ok: true, ops, usage: { ...usageFrom({}, effort, 0, 0, modelId), provider: 'demo' } };
  }
  const client: StructuredClient =
    hostedClient(opts.client);

  const t0 = Date.now();
  const messages: unknown[] = [
    { role: 'user', content: `View: ${view}\n\nCurrent model JSON (revision ${model.revision}):\n${JSON.stringify(model)}\n\nInstruction: ${instruction}` },
  ];
  const system = [{ type: 'text', text: REFINEMENT_SYSTEM, cache_control: { type: 'ephemeral' } }];

  // Per-request gate: exact token count before send; fail closed.
  try {
    const counted = await client.messages.countTokens({ model: modelId, system, messages }, { signal: opts.signal });
    if (counted.input_tokens > CONTEXT_TOKEN_LIMIT) {
      return { ok: false, errors: ['assembled context exceeds the 25k token limit — scope the instruction down'], usage: usageFrom({}, effort, Date.now() - t0, 0, modelId) };
    }
  } catch (e) {
    return { ok: false, errors: [countFailureMessage(e)], usage: usageFrom({}, effort, Date.now() - t0, 0, modelId) };
  }

  let lastErrors: string[] = [];
  const refusals: string[] = [];
  let repairs = 0;
  const billed = newUsageLedger();

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    if (opts.signal?.aborted) { lastErrors = ['Refinement cancelled.']; break; }
    startAttempt(billed, repairs);
    let response: Awaited<ReturnType<StructuredClient['beta']['messages']['create']>>;
    try {
      response = await client.beta.messages.create({
        model: modelId,
        max_tokens: HOSTED_REQUESTS.refine.maxTokens,
        betas: [STRUCTURED_OUTPUTS_BETA],
        system,
        messages,
        output_config: { format: { type: 'json_schema', schema: REFINEMENT_OUTPUT_SCHEMA }, effort },
      }, { signal: opts.signal });
    } catch (e) {
      lastErrors = [`request failed: ${e instanceof Error ? e.message : String(e)}`];
      if (providerRequestStopped(e, billed) || opts.signal?.aborted) break;
      continue;
    }
    captureUsage(billed, response.usage);

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
    } else if (checked.data.length === 0) {
      lastErrors = [EMPTY_OPS_ERROR];
    } else {
      const badBase = checked.data.filter((o) => o.baseRevision !== model.revision);
      if (badBase.length > 0) {
        lastErrors = [`baseRevision must be ${model.revision}`];
      } else {
        const applied = applyEditOps(model, checked.data);
        if (applied.ok && !sameModelContent(applied.model, model)) return { ok: true, ops: checked.data, usage: usageFrom(billed, effort, Date.now() - t0, repairs, modelId) };
        lastErrors = applied.ok ? [NO_CHANGE_ERROR] : applied.errors;
        if (!applied.ok) refusals.push(...applied.errors.filter(isSourceEvidenceRefusal));
      }
    }
    if (attempt < MAX_REPAIRS) {
      repairs++;
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: `These EditOps failed validation — fix them and emit the complete corrected array only:\n- ${lastErrors.join('\n- ')}` });
    }
  }

  // A protected requirement explains a failed request better than the provider's last workaround.
  return { ok: false, errors: refusals.length ? [...new Set(refusals)] : lastErrors, usage: usageFrom(billed, effort, Date.now() - t0, repairs, modelId) };
}

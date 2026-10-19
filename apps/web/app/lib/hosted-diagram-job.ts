import { createHash } from 'node:crypto';
import { isOwnedId, ownedId } from './owned-ids';
import { taskReport, type HostedJobs } from '@archwoven/jobs';
import { sameModelContent, SystemModelSchema, validateModel, type SystemModel, type TaskUsage, type ViewType } from '@archwoven/model';
import { serverDeps, readOrCreateSession, sessionCookie, llmNotConfigured, LLM_NOT_CONFIGURED_COPY, spenderOf, estimateTokens, PROMPT_TOKEN_LIMIT, OVERSIZED_COPY } from './server';
import type { Spender } from './spending';
import { deployMode, privacyForMode } from './mode';
import { hostedJobLimits, runHostedJob, HOSTED_NOT_CONFIGURED_COPY, HOSTED_UNAVAILABLE_COPY, type JobOutcome, type JobRun } from './hosted-runner';
import { secretGate } from '../../lib/secret-gate';
import { readDirectEdit, RequestTooLarge } from '../../lib/direct-edit';

const MAX_MODEL_BYTES = 1_000_000;
/** A diagram plus the operation's own fields. */
export const MAX_DIAGRAM_REQUEST_BYTES = MAX_MODEL_BYTES + 64 * 1024;
export const EXPIRED_MODEL_COPY = 'The server copy of this diagram has expired: it is kept for 24 hours after its last change.';

/**
 * The owner's server copy of a diagram. A copy that no longer reads as a diagram (an older format)
 * is removed and reported as absent, so this browser's copy can replace it.
 */
export async function ownedModel(jobs: HostedJobs, id: string, sessionId: string): Promise<{ owner: 'other' } | { owner: 'absent' } | { owner: 'self'; model: SystemModel }> {
  const state = await jobs.modelState(id, sessionId);
  if (state.owner === 'other') return { owner: 'other' };
  if (state.owner === 'absent') return { owner: 'absent' };
  const parsed = SystemModelSchema.safeParse(state.model);
  if (parsed.success) return { owner: 'self', model: parsed.data };
  await jobs.deleteOwned('model', id, sessionId);
  return { owner: 'absent' };
}
export const STALE_COPY = 'The diagram changed while this request was running, so its result was not applied. Your current diagram is unchanged; try again.';
export const NO_CHANGE_COPY = 'This request did not change the diagram, so nothing was saved.';
const BUSY_COPY = 'You already have a request running. Wait for it to finish, then try again.';
const NETWORK_BUSY_COPY = 'Too many diagrams are being generated from your network right now. Try again in a minute. You can still view, edit and download your diagrams.';
const QUEUE_FULL_COPY = 'Archwoven is busy right now. Try again in a minute. You can still view, edit and download your diagrams.';

/** A diagram sent by the browser is untrusted input: bounded, schema-checked, validated, and at the stated revision. */
export function clientModel(raw: unknown, baseRevision: number): SystemModel | null {
  let size: number;
  try { size = Buffer.byteLength(JSON.stringify(raw) ?? ''); } catch { return null; }
  if (size > MAX_MODEL_BYTES) return null;
  const parsed = SystemModelSchema.safeParse(raw);
  if (!parsed.success || parsed.data.revision !== baseRevision) return null;
  const checked = validateModel(parsed.data);
  return checked.ok ? checked.model : null;
}

const NO_STORE = { 'cache-control': 'private, no-store' };
/** Read a hosted diagram request: 503 when hosting is misconfigured, 413 when too large, 400 when not JSON. */
export async function readDiagramRequest(req: Request, jobs: HostedJobs | 'misconfigured'): Promise<{ body: Record<string, unknown> } | { response: Response }> {
  if (jobs === 'misconfigured') return { response: Response.json({ reason: 'unavailable', message: HOSTED_NOT_CONFIGURED_COPY }, { status: 503, headers: NO_STORE }) };
  try {
    const body = await readDirectEdit(req, MAX_DIAGRAM_REQUEST_BYTES);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { response: Response.json({ error: 'invalid request body' }, { status: 400, headers: NO_STORE }) };
    return { body: body as Record<string, unknown> };
  } catch (error) {
    return { response: error instanceof RequestTooLarge
      ? Response.json({ reason: 'oversized', message: OVERSIZED_COPY }, { status: 413, headers: NO_STORE })
      : Response.json({ error: 'invalid JSON body' }, { status: 400, headers: NO_STORE }) };
  }
}
export const badRequest = (error: string) => Response.json({ error }, { status: 400, headers: NO_STORE });

export type DiagramWork = { ok: true; model: SystemModel; usage: TaskUsage; extra?: Record<string, unknown> } | { ok: false; errors: string[]; usage: TaskUsage };

/**
 * One hosted operation on a diagram the browser holds (refinement, expansion):
 * untrusted-input checks, ownership and an up-to-date revision before any paid
 * work, admission into the shared job lifecycle, and a result saved only over
 * the revision it was based on.
 */
export async function postHostedDiagramJob(req: Request, jobs: HostedJobs | 'misconfigured', op: {
  kind: 'refine' | 'expand';
  view: ViewType;
  modelId: string;
  baseRevision: number;
  rawModel: unknown;
  /** Identifies a repeated request: the same operation on the same revision replays its job. */
  request: unknown[];
  /** User text to scan for secrets and count against the context limit. */
  texts: { label: string; text: string }[];
  /** A reason to refuse before any paid work, or null. */
  precheck?: (model: SystemModel) => string | null;
  run: (model: SystemModel, signal: AbortSignal, spender: Spender) => Promise<DiagramWork>;
}): Promise<Response> {
  const { sessionId, minted } = readOrCreateSession(req);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'private, no-store' };
  if (minted) headers['set-cookie'] = sessionCookie(sessionId);
  if (jobs === 'misconfigured') return Response.json({ reason: 'unavailable', message: HOSTED_NOT_CONFIGURED_COPY }, { status: 503, headers });
  const { modelId, baseRevision } = op;
  if (!/^[0-9a-f-]{36}$/.test(modelId) || !Number.isInteger(baseRevision)) return Response.json({ error: 'A diagram id and its revision are required.' }, { status: 400, headers });
  // A diagram id this session did not create is refused without a Redis command.
  if (!isOwnedId(modelId, sessionId)) return Response.json({ error: 'model not found' }, { status: 404, headers });
  // The provider context is limited; a diagram too large to work on is refused before admission.
  if (estimateTokens(JSON.stringify(op.rawModel ?? null) + op.texts.map(t => t.text).join('')) > PROMPT_TOKEN_LIMIT) return Response.json({ reason: 'oversized', message: OVERSIZED_COPY }, { status: 413, headers });
  const model = clientModel(op.rawModel, baseRevision);
  if (!model) return Response.json({ reason: 'invalid-model', error: 'This diagram could not be read. Reload it, or import a valid JSON export, and try again.' }, { status: 400, headers });

  try {
    // Another visitor's diagram id is refused before any paid work.
    const stored = await ownedModel(jobs, modelId, sessionId);
    if (stored.owner === 'other') return Response.json({ error: 'model not found' }, { status: 404, headers });
    // An expired server copy is put back from the browser first; a paid result is never saved to a missing diagram.
    if (stored.owner === 'absent') return Response.json({ reason: 'expired', message: EXPIRED_MODEL_COPY }, { status: 404, headers });
    // A newer saved revision means this page is behind: send it the latest instead of paying for a refusal.
    const latest = stored.model;
    if (latest.revision !== baseRevision)
      return Response.json({ reason: 'stale-revision', message: 'The diagram changed since you loaded it — here is the latest.', model: latest, revision: latest.revision }, { status: 409, headers });
    const blocked = op.precheck?.(model);
    if (blocked) return Response.json({ errors: [blocked] }, { status: 400, headers });
    const secret = await secretGate(op.texts);
    if (secret) return Response.json({ reason: 'secret-detected', error: secret }, { status: 400, headers });
    if (llmNotConfigured()) return Response.json({ reason: 'llm-not-configured', message: LLM_NOT_CONFIGURED_COPY }, { status: 503, headers });

    const key = `${op.kind}:${createHash('sha256').update(JSON.stringify([modelId, baseRevision, ...op.request])).digest('hex').slice(0, 40)}`;
    const jobId = ownedId(sessionId), limits = hostedJobLimits(), spender = spenderOf(req.headers, sessionId);
    const admitted = await jobs.admit(jobId, sessionId, op.kind, key, limits, spender.network);
    if (admitted.kind === 'replay') return Response.json({ jobId: admitted.jobId, remaining: null, resumable: true }, { status: 202, headers });
    if (admitted.kind === 'busy') return Response.json({ reason: 'busy', jobId: admitted.jobId, message: BUSY_COPY }, { status: 409, headers });
    if (admitted.kind === 'queue-full') return Response.json({ reason: 'busy', message: QUEUE_FULL_COPY }, { status: 503, headers });
    if (admitted.kind === 'network-busy') return Response.json({ reason: 'burst', message: NETWORK_BUSY_COPY, resetAt: Date.now() + 60_000 }, { status: 429, headers });

    const work = async (signal: AbortSignal, { claim }: JobRun): Promise<JobOutcome> => {
      const out = await op.run(model, signal, spender);
      const report = (outcome: 'ok' | 'repaired' | 'failed') => jobs.putOwned('lasttask', jobs.ownerOf(sessionId), sessionId,
        taskReport({ action: op.kind, view: op.view, taskId: jobId, modelId, usage: out.usage, retries: out.usage.repairs, outcome })).catch(() => undefined);
      const fail = async (error: string): Promise<JobOutcome> => { await report('failed'); return { status: 'failed', error }; };
      if (!out.ok) return fail(out.errors.join('; '));
      if (sameModelContent(out.model, model)) return fail(NO_CHANGE_COPY);
      if (signal.aborted) return fail('Cancelled.');
      const changed = { ...out.model, privacy: privacyForMode(deployMode()) };
      // A change saved while inference ran (an edit, undo or another tab's result) wins: the result applies only over its base revision.
      const saved = await jobs.putModel(modelId, sessionId, changed, baseRevision, claim);
      if (saved === 'stale') return fail(STALE_COPY);
      if (saved === 'not-owner') return fail('This diagram is not available.');
      if (saved === 'cancelled') return fail('Cancelled.');
      await jobs.putOwned('result', jobId, sessionId, { ...out.extra, model: changed });
      await report(out.usage.repairs > 0 ? 'repaired' : 'ok');
      return { status: 'succeeded', fields: { modelId, revision: changed.revision } };
    };
    serverDeps.schedule(() => runHostedJob(jobs, jobId, work, limits));
    return Response.json({ jobId, remaining: null, resumable: true }, { status: 202, headers });
  } catch {
    return Response.json({ reason: 'unavailable', message: HOSTED_UNAVAILABLE_COPY }, { status: 503, headers });
  }
}

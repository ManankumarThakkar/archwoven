import { createHash, randomUUID } from 'node:crypto';
import { taskReport, type HostedJobs } from '@archwoven/jobs';
import { applyEditOps, sameModelContent, SystemModelSchema, validateModel, type SystemModel, type ViewType } from '@archwoven/model';
import { serverDeps, readOrCreateSession, sessionCookie, llmNotConfigured, LLM_NOT_CONFIGURED_COPY, spenderOf, estimateTokens, PROMPT_TOKEN_LIMIT, OVERSIZED_COPY } from '../../lib/server';
import { deployMode, privacyForMode } from '../../lib/mode';
import { hostedJobLimits, runHostedJob, HOSTED_NOT_CONFIGURED_COPY, HOSTED_UNAVAILABLE_COPY, type JobOutcome } from '../../lib/hosted-runner';
import { secretGate } from '../../../lib/secret-gate';

const VALID_VIEWS: ViewType[] = ['architecture', 'sequence', 'er', 'component-detail'];
const MAX_MODEL_BYTES = 1_000_000;
export const STALE_COPY = 'The diagram changed while refining, so this result was not applied. Your current diagram is unchanged; try again.';
export const NO_CHANGE_COPY = 'This instruction did not change the diagram, so nothing was saved.';
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

/** Refinement through the shared hosted job lifecycle, on the diagram the browser holds. */
export async function postHostedRefine(req: Request, jobs: HostedJobs | 'misconfigured'): Promise<Response> {
  const { sessionId, minted } = readOrCreateSession(req);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'private, no-store' };
  if (minted) headers['set-cookie'] = sessionCookie(sessionId);
  if (jobs === 'misconfigured') return Response.json({ reason: 'unavailable', message: HOSTED_NOT_CONFIGURED_COPY }, { status: 503, headers });

  let body: { modelId?: unknown; baseRevision?: unknown; instruction?: unknown; view?: unknown; model?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid JSON body' }, { status: 400, headers }); }
  const modelId = typeof body?.modelId === 'string' ? body.modelId : '';
  const baseRevision = Number(body?.baseRevision);
  const instruction = typeof body?.instruction === 'string' ? body.instruction : '';
  if (!/^[0-9a-f-]{36}$/.test(modelId) || !Number.isInteger(baseRevision) || !instruction.trim() || instruction.length > 2000)
    return Response.json({ error: 'modelId, baseRevision and an instruction of up to 2,000 characters are required' }, { status: 400, headers });
  // The provider context is limited; a diagram too large to refine is refused before admission.
  if (estimateTokens(JSON.stringify(body.model ?? null) + instruction) > PROMPT_TOKEN_LIMIT) return Response.json({ reason: 'oversized', message: OVERSIZED_COPY }, { status: 413, headers });
  const model = clientModel(body.model, baseRevision);
  if (!model) return Response.json({ reason: 'invalid-model', error: 'This diagram could not be read. Reload it, or import a valid JSON export, and try again.' }, { status: 400, headers });
  const view: ViewType = VALID_VIEWS.includes(body.view as ViewType) ? body.view as ViewType : 'architecture';
  const localStore = process.env.VERCEL !== '1';

  try {
    // Another visitor's diagram id is refused before any paid work.
    const stored = await jobs.modelState(modelId, sessionId);
    if (stored.owner === 'other') return Response.json({ error: 'model not found' }, { status: 404, headers });
    const local = localStore && serverDeps.store.getRevision(modelId);
    if (local && serverDeps.store.getRevisionOwner(modelId) !== sessionId) return Response.json({ error: 'model not found' }, { status: 404, headers });
    // A newer saved revision means this page is behind: send it the latest instead of paying for a refusal.
    const latest = local || (stored.model && typeof stored.model.revision === 'number' ? stored.model as SystemModel : null);
    if (latest && latest.revision !== baseRevision)
      return Response.json({ reason: 'stale-revision', message: 'The diagram changed since you loaded it — here is the latest.', model: latest, revision: latest.revision }, { status: 409, headers });
    const secret = await secretGate([{ label: 'Your instruction', text: instruction }]);
    if (secret) return Response.json({ reason: 'secret-detected', error: secret }, { status: 400, headers });
    if (llmNotConfigured()) return Response.json({ reason: 'llm-not-configured', message: LLM_NOT_CONFIGURED_COPY }, { status: 503, headers });

    const key = `refine:${createHash('sha256').update(JSON.stringify([modelId, baseRevision, view, instruction])).digest('hex').slice(0, 40)}`;
    const jobId = randomUUID(), limits = hostedJobLimits(), spender = spenderOf(req.headers, sessionId);
    const admitted = await jobs.admit(jobId, sessionId, 'refine', key, limits, spender.network);
    if (admitted.kind === 'replay') return Response.json({ jobId: admitted.jobId, remaining: null, resumable: true }, { status: 202, headers });
    if (admitted.kind === 'busy') return Response.json({ reason: 'busy', jobId: admitted.jobId, message: BUSY_COPY }, { status: 409, headers });
    if (admitted.kind === 'queue-full') return Response.json({ reason: 'busy', message: QUEUE_FULL_COPY }, { status: 503, headers });
    if (admitted.kind === 'network-busy') return Response.json({ reason: 'burst', message: NETWORK_BUSY_COPY, resetAt: Date.now() + 60_000 }, { status: 429, headers });

    const work = async (signal: AbortSignal): Promise<JobOutcome> => {
      const out = await serverDeps.generateRefinement(instruction, model, view, { signal, spender });
      const report = (outcome: 'ok' | 'repaired' | 'failed') => jobs.putOwned('lasttask', jobs.ownerOf(sessionId), sessionId,
        taskReport({ action: 'refine', view, taskId: jobId, modelId, usage: out.usage, retries: out.usage.repairs, outcome })).catch(() => undefined);
      const fail = async (error: string): Promise<JobOutcome> => { await report('failed'); return { status: 'failed', error }; };
      if (!out.ok) return fail(out.errors.join('; '));
      const applied = applyEditOps(model, out.ops);
      if (!applied.ok) return fail(applied.errors.join('; '));
      if (sameModelContent(applied.model, model)) return fail(NO_CHANGE_COPY);
      if (signal.aborted) return fail('Cancelled.');
      const refined = { ...applied.model, privacy: privacyForMode(deployMode()) };
      // An edit saved while inference ran wins: the result applies only over its base revision.
      // A development server's local store holds direct edits, so it decides there; Redis decides elsewhere.
      const local = localStore && serverDeps.store.getRevisionOwner(modelId) === sessionId ? serverDeps.store.getRevision(modelId) : null;
      if (local && local.revision !== baseRevision) return fail(STALE_COPY);
      const saved = await jobs.putModel(modelId, sessionId, refined, local ? null : baseRevision);
      if (saved === 'stale') return fail(STALE_COPY);
      if (saved === 'not-owner') return fail('This diagram is not available.');
      if (local) serverDeps.store.saveRevision(modelId, refined, sessionId);
      await jobs.putOwned('result', jobId, sessionId, { ops: out.ops, model: refined });
      await report(out.usage.repairs > 0 ? 'repaired' : 'ok');
      return { status: 'succeeded', fields: { modelId, revision: refined.revision } };
    };
    serverDeps.schedule(() => runHostedJob(jobs, jobId, work, limits));
    return Response.json({ jobId, remaining: null, resumable: true }, { status: 202, headers });
  } catch {
    return Response.json({ reason: 'unavailable', message: HOSTED_UNAVAILABLE_COPY }, { status: 503, headers });
  }
}

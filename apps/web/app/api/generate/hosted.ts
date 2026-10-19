import { createHash } from 'node:crypto';
import { isOwnedId, ownedId } from '../../lib/owned-ids';
import { taskReport, type HostedJobs } from '@archwoven/jobs';
import { validateModel, type ViewType } from '@archwoven/model';
import { ClarificationSchema } from '@archwoven/llm';
import {
  serverDeps, estimateTokens, PROMPT_TOKEN_LIMIT, readOrCreateSession, sessionCookie,
  OVERSIZED_COPY, llmNotConfigured, LLM_NOT_CONFIGURED_COPY, spenderOf,
} from '../../lib/server';
import { deployMode, privacyForMode } from '../../lib/mode';
import { hostedJobLimits, runHostedJob, HOSTED_NOT_CONFIGURED_COPY, HOSTED_UNAVAILABLE_COPY, HOSTED_STORAGE_FULL_COPY, HOSTED_STORAGE_OVERSIZED_COPY, type JobOutcome, type JobRun } from '../../lib/hosted-runner';
import { parseReply, continuationPrompt, preserveClarification, type ClarificationReply } from '../../lib/clarification';
import { secretGate } from '../../../lib/secret-gate';

const VALID_VIEWS: ViewType[] = ['architecture', 'sequence', 'er', 'component-detail'];
const BUSY_COPY = 'You already have a diagram being generated. Wait for it to finish or cancel it, then try again.';
const QUEUE_FULL_COPY = 'Archwoven is busy right now. Try again in a minute. You can still view, edit and download your diagrams.';
const NETWORK_BUSY_COPY = 'Too many diagrams are being generated from your network right now. Try again in a minute. You can still view, edit and download your diagrams.';
interface StoredClarification { prompt: string; view: ViewType; questions: string[] }

/** Description generation through the shared hosted job lifecycle (Redis + after()). */
export async function postHostedGenerate(req: Request, jobs: HostedJobs | 'misconfigured'): Promise<Response> {
  const { sessionId, minted } = readOrCreateSession(req);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'private, no-store' };
  if (minted) headers['set-cookie'] = sessionCookie(sessionId);
  if (jobs === 'misconfigured') return Response.json({ reason: 'unavailable', message: HOSTED_NOT_CONFIGURED_COPY }, { status: 503, headers });

  let body: { prompt?: string; view?: string; idempotencyKey?: string; clarification?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid JSON body' }, { status: 400, headers }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'invalid request body' }, { status: 400, headers });
  const replyKey = (r: ClarificationReply) => `clarification:${createHash('sha256').update(JSON.stringify(r)).digest('hex')}`;
  // resumable: the job keeps running if the tab closes, so the browser may reconnect to it.
  const accepted = (jobId: string) => Response.json({ jobId, remaining: null, resumable: true }, { status: 202, headers });

  try {
    let context: StoredClarification | undefined, reply: ClarificationReply | null = null;
    if (body.clarification !== undefined) {
      const raw = body.clarification as { jobId?: unknown; answers?: unknown } | null;
      if (!raw || typeof raw.jobId !== 'string') return Response.json({ error: 'A clarification job is required.' }, { status: 400, headers });
      // A job id this session did not create is refused without a Redis command.
      if (!isOwnedId(raw.jobId, sessionId)) return Response.json({ error: 'clarification not found' }, { status: 404, headers });
      const previous = await jobs.read(raw.jobId, sessionId);
      if (!previous) return Response.json({ error: 'clarification not found' }, { status: 404, headers });
      const stored = previous.clarification as StoredClarification | null;
      if (previous.status !== 'clarifying' || !stored) {
        // A completed continuation forgets the description; replaying the same reply still returns its job.
        const replay = parseReply(raw, Array.isArray(raw.answers) ? raw.answers.length : 0);
        const existing = replay && await jobs.replayOf(sessionId, replyKey(replay));
        return existing ? accepted(existing) : Response.json({ error: 'This job has no pending clarification.' }, { status: 409, headers });
      }
      context = stored;
      reply = parseReply(raw, context.questions.length);
      if (!reply) return Response.json({ error: 'Answer at least one question (up to 1,000 characters each), or choose Skip for now.' }, { status: 400, headers });
    }
    const prompt = context && reply ? continuationPrompt(context, reply) : String(body.prompt ?? '');
    const view = context?.view ?? (VALID_VIEWS.includes(body.view as ViewType) ? (body.view as ViewType) : null);
    if (!prompt.trim() || !view) return Response.json({ error: 'prompt and view are required' }, { status: 400, headers });
    if (estimateTokens(prompt) > PROMPT_TOKEN_LIMIT) return Response.json({ reason: 'oversized', message: OVERSIZED_COPY }, { status: 413, headers });
    const secret = await secretGate(reply ? (reply.answers ?? []).map((text, i) => ({ label: `Answer ${i + 1}`, text })) : [{ label: 'Your description', text: prompt }]);
    if (secret) return Response.json({ reason: 'secret-detected', error: secret }, { status: 400, headers });
    if (llmNotConfigured()) return Response.json({ reason: 'llm-not-configured', message: LLM_NOT_CONFIGURED_COPY }, { status: 503, headers });

    const key = reply ? replyKey(reply) : typeof body.idempotencyKey === 'string' && /^[\w:.-]{1,128}$/.test(body.idempotencyKey) ? body.idempotencyKey : undefined;
    const jobId = ownedId(sessionId), limits = hostedJobLimits();
    const spender = spenderOf(req.headers, sessionId);
    const admitted = await jobs.admit(jobId, sessionId, 'generate', key, limits, spender.network);
    if (admitted.kind === 'replay') return accepted(admitted.jobId);
    if (admitted.kind === 'busy') return Response.json({ reason: 'busy', jobId: admitted.jobId, message: BUSY_COPY }, { status: 409, headers });
    if (admitted.kind === 'queue-full') return Response.json({ reason: 'busy', message: QUEUE_FULL_COPY }, { status: 503, headers });
    if (admitted.kind === 'storage-full') return Response.json({ reason: 'storage-full', message: HOSTED_STORAGE_FULL_COPY + ' No AI request was started.' }, { status: 503, headers });
    if (admitted.kind === 'network-busy') return Response.json({ reason: 'burst', message: NETWORK_BUSY_COPY, resetAt: Date.now() + 60_000 }, { status: 429, headers });

    const answered = reply ? context : undefined, answeredBy = reply;
    const work = async (signal: AbortSignal, { claim }: JobRun): Promise<JobOutcome> => {
      const out = await serverDeps.generateModel(prompt, view, { signal, allowClarification: !context, spender });
      const report = (outcome: 'ok' | 'repaired' | 'failed') => jobs.putOwned('lasttask', jobs.ownerOf(sessionId), sessionId,
        taskReport({ action: 'generate', view, taskId: jobId, modelId: jobId, usage: out.usage, retries: out.usage.repairs, outcome }), claim).catch(() => undefined);
      if (!out.ok) { await report('failed'); return { status: 'failed', error: out.errors.join('; ') }; }
      if ('questions' in out) {
        const questions = ClarificationSchema.safeParse({ clarificationQuestions: out.questions });
        if (context || !questions.success) { await report('failed'); return { status: 'failed', error: 'Invalid clarification response. Please retry.' }; }
        await report('ok');
        return { status: 'clarifying', fields: { clarification: JSON.stringify({ prompt, view, questions: questions.data.clarificationQuestions }) } };
      }
      const checked = validateModel(answered && answeredBy ? preserveClarification(out.model, answered, answeredBy) : out.model);
      if (!checked.ok) { await report('failed'); return { status: 'failed', error: checked.errors.join('; ') }; }
      // A job cancelled while its result arrived keeps nothing.
      if (signal.aborted) { await report('failed'); return { status: 'failed', error: 'Cancelled.' }; }
      // Privacy is server-stamped from deploy mode — model self-report never wins.
      const stamped = { ...checked.model, privacy: privacyForMode(deployMode()) };
      // Saved only while this instance still runs the job: a cancel that landed meanwhile keeps nothing.
      const saved = await jobs.putModel(jobId, sessionId, stamped, null, claim);
      if (saved !== 'ok') { await report('failed'); return { status: 'failed', error: saved === 'storage-full' ? HOSTED_STORAGE_FULL_COPY : saved === 'too-large' ? HOSTED_STORAGE_OVERSIZED_COPY : 'Cancelled.' }; }
      await report(out.usage.repairs > 0 ? 'repaired' : 'ok');
      if (answeredBy) await jobs.scrubClarification(answeredBy.jobId).catch(() => undefined);
      return { status: 'succeeded', fields: { modelId: jobId, revision: stamped.revision } };
    };
    serverDeps.schedule(() => runHostedJob(jobs, jobId, work, limits));
    return accepted(jobId);
  } catch {
    // Redis is unreachable or refused the command: nothing was admitted, and no paid work started.
    return Response.json({ reason: 'unavailable', message: HOSTED_UNAVAILABLE_COPY }, { status: 503, headers });
  }
}

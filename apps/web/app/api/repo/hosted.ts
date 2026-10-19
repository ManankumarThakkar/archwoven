import { randomUUID } from 'node:crypto';
import { taskReport, type HostedJobs } from '@archwoven/jobs';
import { validateModel, appendDisclosures } from '@archwoven/model';
import { parseRepoUrl } from '@archwoven/ingest';
import { maskFragmentSecrets } from '@archwoven/llm';
import { serverDeps, readOrCreateSession, sessionCookie, llmNotConfigured, LLM_NOT_CONFIGURED_COPY, spenderOf } from '../../lib/server';
import { deployMode, privacyForMode } from '../../lib/mode';
import { hostedJobLimits, runHostedJob, HOSTED_NOT_CONFIGURED_COPY, HOSTED_UNAVAILABLE_COPY, type JobOutcome, type JobRun } from '../../lib/hosted-runner';
import { readDirectEdit, RequestTooLarge } from '../../../lib/direct-edit';

const BUSY_COPY = 'You already have a request running. Wait for it to finish or cancel it, then try again.';
const QUEUE_FULL_COPY = 'Archwoven is busy right now. Try again in a minute. You can still view, edit and download your diagrams.';
const NETWORK_BUSY_COPY = 'Too many diagrams are being generated from your network right now. Try again in a minute. You can still view, edit and download your diagrams.';
const safeSubdir = (s: string) => /^[\w@.-]+(\/[\w@.-]+)*$/.test(s) && s.split('/').every(seg => seg !== '.' && seg !== '..');
// git's ref-name rules, bounded: no whitespace, control or special characters, '..' or '@{'.
const safeRef = (s: string) => /^[^\s\x00-\x1f\x7f~^:?*[\\]{1,200}$/.test(s) && !s.includes('..') && !s.includes('@{');

/** Public repository import through the shared hosted job lifecycle (Redis + after()). */
export async function postHostedRepo(req: Request, jobs: HostedJobs | 'misconfigured'): Promise<Response> {
  const { sessionId, minted } = readOrCreateSession(req);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'private, no-store' };
  if (minted) headers['set-cookie'] = sessionCookie(sessionId);
  if (jobs === 'misconfigured') return Response.json({ reason: 'unavailable', message: HOSTED_NOT_CONFIGURED_COPY }, { status: 503, headers });

  let body: { url?: unknown; localPath?: unknown; subdir?: unknown; ref?: unknown; idempotencyKey?: unknown };
  try { body = await readDirectEdit(req) as typeof body; }
  catch (error) {
    return error instanceof RequestTooLarge
      ? Response.json({ error: 'This request is too large.' }, { status: 413, headers })
      : Response.json({ error: 'invalid JSON body' }, { status: 400, headers });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'invalid request body' }, { status: 400, headers });
  if (body.localPath !== undefined && body.localPath !== null && body.localPath !== '')
    return Response.json({ error: 'Private repo import from a local path is available in local deployments only.' }, { status: 400, headers });
  // URL validation before admission: a malformed or SSRF-shaped URL never starts a job.
  const parsed = parseRepoUrl(String(body.url ?? ''));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400, headers });
  const subdir = body.subdir !== undefined && body.subdir !== null && body.subdir !== '' ? String(body.subdir) : parsed.subdir;
  if (subdir !== undefined && !safeSubdir(subdir)) return Response.json({ error: 'subdir must be a simple relative path without ".."' }, { status: 400, headers });
  const typedRef = body.ref !== undefined && body.ref !== null && body.ref !== '' ? String(body.ref) : undefined;
  if (typedRef !== undefined && !safeRef(typedRef)) return Response.json({ error: 'invalid ref' }, { status: 400, headers });
  const ref = parsed.ref ?? typedRef;
  if (llmNotConfigured()) return Response.json({ reason: 'llm-not-configured', message: LLM_NOT_CONFIGURED_COPY }, { status: 503, headers });

  try {
    const key = typeof body.idempotencyKey === 'string' && /^[\w:.-]{1,128}$/.test(body.idempotencyKey) ? body.idempotencyKey : undefined;
    const jobId = randomUUID(), limits = hostedJobLimits(), spender = spenderOf(req.headers, sessionId);
    const admitted = await jobs.admit(jobId, sessionId, 'repo', key, limits, spender.network);
    if (admitted.kind === 'replay') return Response.json({ jobId: admitted.jobId, remaining: null, resumable: true }, { status: 202, headers });
    if (admitted.kind === 'busy') return Response.json({ reason: 'busy', jobId: admitted.jobId, message: BUSY_COPY }, { status: 409, headers });
    if (admitted.kind === 'queue-full') return Response.json({ reason: 'busy', message: QUEUE_FULL_COPY }, { status: 503, headers });
    if (admitted.kind === 'network-busy') return Response.json({ reason: 'burst', message: NETWORK_BUSY_COPY, resetAt: Date.now() + 60_000 }, { status: 429, headers });

    const work = async (signal: AbortSignal, { stage, claim }: JobRun): Promise<JobOutcome> => {
      await stage('fetching');
      const ingest = await serverDeps.ingestRepo({ owner: parsed.owner, repo: parsed.repo, ref, subdir }, { signal, onStage: name => { void stage(name); } });
      if (!ingest.ok) return { status: 'failed', error: ingest.message };
      if (signal.aborted) return { status: 'failed', error: 'Cancelled.' };
      // Hosted analysis never sends secret values: mask them first and disclose what was masked. A scanner failure stops the job.
      const masked = await maskFragmentSecrets(ingest.fragment);
      const disclosures = masked.disclosure ? [...ingest.gaps, masked.disclosure] : ingest.gaps;
      if (signal.aborted) return { status: 'failed', error: 'Cancelled.' };
      await stage('designing');
      const out = await serverDeps.assembleRepoModel(masked.fragment, { owner: parsed.owner, repo: parsed.repo, sha: ingest.sha, framework: ingest.framework }, { signal, spender });
      const report = (outcome: 'ok' | 'repaired' | 'failed') => jobs.putOwned('lasttask', jobs.ownerOf(sessionId), sessionId,
        taskReport({ action: 'repo', view: 'architecture', taskId: jobId, modelId: jobId, usage: out.usage, retries: out.usage.repairs, outcome })).catch(() => undefined);
      if (!out.ok) { await report('failed'); return { status: 'failed', error: out.errors.join('; ') }; }
      await stage('validating-output');
      const checked = validateModel(out.model);
      if (!checked.ok) { await report('failed'); return { status: 'failed', error: checked.errors.join('; ') }; }
      // A job cancelled while its result arrived keeps nothing.
      if (signal.aborted) { await report('failed'); return { status: 'failed', error: 'Cancelled.' }; }
      // Ingest disclosures live with the model, so a reload shows exactly what the first load did; privacy is server-stamped.
      const stamped = { ...appendDisclosures(checked.model, disclosures), privacy: privacyForMode(deployMode()) };
      // Saved only while this instance still runs the job: a cancel that landed meanwhile keeps nothing.
      if (await jobs.putModel(jobId, sessionId, stamped, null, claim) !== 'ok') { await report('failed'); return { status: 'failed', error: 'Cancelled.' }; }
      await report(out.usage.repairs > 0 ? 'repaired' : 'ok');
      return { status: 'succeeded', fields: { modelId: jobId, revision: stamped.revision } };
    };
    serverDeps.schedule(() => runHostedJob(jobs, jobId, work, limits));
    return Response.json({ jobId, remaining: null, resumable: true }, { status: 202, headers });
  } catch {
    // Redis is unreachable or refused the command: nothing was admitted, and no paid work started.
    return Response.json({ reason: 'unavailable', message: HOSTED_UNAVAILABLE_COPY }, { status: 503, headers });
  }
}

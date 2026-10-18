import { createHash, randomUUID } from 'node:crypto';
import { openHostedJobs, WAIT_COPY, type HostedJobLimits, type HostedJobs } from '@archwoven/jobs';
import { deployMode } from './mode';
import { JOB_TIMEOUT_COPY } from './job-registry';

/** Waiting plus running stays inside Vercel Hobby's 300 s function limit, with margin. */
export const HOSTED_MAX_DURATION_SECONDS = 300;
export function hostedJobLimits(): HostedJobLimits {
  const parallel = Number(process.env.ARCHWOVEN_MAX_PARALLEL ?? 2);
  const timeout = Number(process.env.ARCHWOVEN_JOB_TIMEOUT_MS ?? 180_000);
  const wait = Number(process.env.ARCHWOVEN_JOB_WAIT_MS ?? 60_000);
  return {
    maxRunning: Number.isSafeInteger(parallel) && parallel > 0 ? parallel : 2,
    maxWaiting: 8,
    maxPerNetwork: 2,
    waitMs: Number.isFinite(wait) && wait > 0 ? Math.min(60_000, Math.ceil(wait)) : 60_000,
    runMs: Number.isFinite(timeout) && timeout > 0 ? Math.min(180_000, Math.ceil(timeout)) : 180_000,
  };
}

export const HOSTED_UNAVAILABLE_COPY = 'AI generation is temporarily unavailable. You can still view, edit and download your diagrams.';
export const HOSTED_NOT_CONFIGURED_COPY = 'AI generation is unavailable: hosted job storage is not configured. You can still view, edit and download your diagrams.';

let cached: { key: string; jobs: HostedJobs } | undefined;
/**
 * Hosted job storage when configured: null keeps the existing single-server
 * SQLite jobs (local mode and development servers); 'misconfigured' refuses
 * work rather than falling back where SQLite cannot be shared (Vercel).
 */
export function hostedJobs(): HostedJobs | 'misconfigured' | null {
  if (deployMode() === 'local') return null;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim(), token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim(), prefix = process.env.ARCHWOVEN_REDIS_PREFIX?.trim();
  const onVercel = process.env.VERCEL === '1';
  if (!url && !token && !prefix) return onVercel ? 'misconfigured' : null;
  const loopback = /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(url ?? '');
  const secret = process.env.ARCHWOVEN_SESSION_SECRET?.trim() ?? '';
  if (!url || !token || !prefix || secret.length < 32 || !(/^https:\/\/[a-z0-9.-]+\.upstash\.io\/?$/.test(url) || (loopback && !onVercel))) return 'misconfigured';
  const key = `${url}|${prefix}|${createHash('sha256').update(`${token}|${secret}`).digest('hex')}`;
  // Owner hashes are keyed by the session secret, so rotating the Redis token keeps jobs reachable.
  try { if (cached?.key !== key) cached = { key, jobs: openHostedJobs({ url, token, prefix, ownerKey: secret }) }; }
  catch { return 'misconfigured'; }
  return cached.jobs;
}

export interface JobOutcome { status: 'succeeded' | 'failed' | 'clarifying'; error?: string; fields?: Record<string, string | number> }

/**
 * Execute one admitted job in the invocation that accepted it: wait for a
 * running slot, run `work` under the job's deadline, abort when the owner
 * cancels, and record the outcome once. Nothing is retried; if this
 * invocation dies, the job reads as failed after its deadline.
 */
export async function runHostedJob(jobs: HostedJobs, jobId: string, work: (signal: AbortSignal) => Promise<JobOutcome>, limits = hostedJobLimits(), { pollMs = 1000, cancelPollMs = 5000 } = {}): Promise<void> {
  const claimant = randomUUID();
  try {
    for (;;) {
      const claim = await jobs.claim(jobId, claimant, limits);
      if (claim.kind === 'claimed') break;
      if (claim.kind === 'wait') { await new Promise(resolve => setTimeout(resolve, pollMs)); continue; }
      await jobs.abandon(jobId, WAIT_COPY);
      return;
    }
  } catch { return; /* Storage is unreachable: the job ends as failed at its deadline, and nothing ran. */ }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(new DOMException('Generation timed out', 'TimeoutError')); }, limits.runMs);
  const watcher = setInterval(() => {
    jobs.cancelRequested(jobId).then(cancelled => { if (cancelled) controller.abort(); }).catch(() => undefined);
  }, cancelPollMs);
  let outcome: JobOutcome;
  try { outcome = await work(controller.signal); }
  catch { outcome = { status: 'failed', error: 'Generation failed. You can retry it.' }; }
  finally { clearTimeout(timer); clearInterval(watcher); }
  if (timedOut) outcome = { status: 'failed', error: JOB_TIMEOUT_COPY };
  await jobs.finish(jobId, claimant, outcome.status, outcome.error ?? '', outcome.fields ?? {}).catch(() => undefined);
}

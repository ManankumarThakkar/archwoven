import { TIERS } from '@archwoven/jobs';
import { serverDeps, readOrCreateSession, tierOf } from '../../../lib/server';
import { slotPosition } from '../../../lib/llm-limiter';
import { jobRegistry } from '../../../lib/job-registry';
import { hostedJobs, HOSTED_NOT_CONFIGURED_COPY, HOSTED_UNAVAILABLE_COPY } from '../../../lib/hosted-runner';

export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { sessionId } = readOrCreateSession(req);
  const { id } = await ctx.params;
  const jobs = hostedJobs();
  if (jobs === 'misconfigured') return Response.json({ error: HOSTED_NOT_CONFIGURED_COPY }, { status: 503 });
  if (jobs) {
    let hosted;
    try { hosted = await jobs.read(id, sessionId); }
    catch { return Response.json({ error: HOSTED_UNAVAILABLE_COPY }, { status: 503 }); }
    if (hosted) return Response.json({ usagePending: hosted.usagePending, questions: hosted.questions, remaining: null, status: hosted.status, stage: hosted.stage, modelId: hosted.modelId ?? id, revision: hosted.revision, queuePosition: hosted.queuePosition, deadlineAt: hosted.deadlineAt, gaps: [], error: hosted.error, pollAfterMs: 1500 }, { headers: { 'cache-control': 'private, no-store' } });
    // Operations not yet moved to hosted jobs (repository imports) still run in a development server's local store.
    if (process.env.VERCEL === '1') return Response.json({ error: 'job not found' }, { status: 404 });
  }
  const job = serverDeps.store.getJob(id);
  if (!job || job.sessionId !== sessionId) return Response.json({ error: 'job not found' }, { status: 404 });
  const revision = job.status === 'succeeded' ? serverDeps.store.getRevision(job.modelId)?.revision ?? null : null;
  const queuePosition = job.status === 'queued' ? slotPosition(id) : null;
  const used = serverDeps.store.creditsUsed(sessionId, new Date().toISOString().slice(0, 10));
  const remaining = process.env.ARCHWOVEN_MODE === 'local' ? null : Math.max(0, TIERS[tierOf(sessionId)].pool - used);
  return Response.json({ usagePending: jobRegistry.has(id), questions: job.clarification?.questions ?? [], remaining, status: job.status, stage: job.stage ?? null, modelId: job.modelId, revision, queuePosition, deadlineAt: jobRegistry.get(id)?.deadlineAt ?? null, gaps: job.gaps ?? [], error: job.error ?? null });
}

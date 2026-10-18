import { refundCredits, WEIGHTS, type Action } from '@archwoven/jobs';
import { serverDeps, readOrCreateSession } from '../../../../lib/server';
import { repoJobRegistry } from '../../../../lib/repo-registry';
import { hostedJobs, HOSTED_NOT_CONFIGURED_COPY, HOSTED_UNAVAILABLE_COPY } from '../../../../lib/hosted-runner';

export const runtime = 'nodejs';

/** Owner-checked cancellation: flips status, refunds the job's reserved weight
 *  exactly once (the registry's `settled` claim), and aborts the in-flight call. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { sessionId } = readOrCreateSession(req);
  const { id } = await ctx.params;
  const jobs = hostedJobs();
  if (jobs === 'misconfigured') return Response.json({ error: HOSTED_NOT_CONFIGURED_COPY }, { status: 503 });
  if (jobs) {
    // Hosted cancellation stops the executor at its next check; usage already spent stays recorded.
    let status;
    try { status = await jobs.cancel(id, sessionId); }
    catch { return Response.json({ error: HOSTED_UNAVAILABLE_COPY }, { status: 503 }); }
    if (status !== 'not-found') return Response.json({ status });
    // Operations not yet moved to hosted jobs (repository imports) still run in a development server's local store.
    if (process.env.VERCEL === '1') return Response.json({ error: 'job not found' }, { status: 404 });
  }
  const job = serverDeps.store.getJob(id);
  if (!job || job.sessionId !== sessionId) return Response.json({ error: 'job not found' }, { status: 404 });
  if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'clarifying') {
    return Response.json({ status: job.status });
  }

  // Only registry-backed jobs have abort/settlement plumbing. Legacy or
  // externally created jobs cannot safely be refunded while still running.
  const entry = repoJobRegistry.get(id);
  if (!entry) return Response.json({ error: 'job is not cancellable' }, { status: 409 });
  if (entry.settled) return Response.json({ status: serverDeps.store.getJob(id)?.status ?? 'cancelled' });
  entry.settled = true;
  serverDeps.store.updateJob(id, { status: 'cancelled' });
  refundCredits(serverDeps.store, sessionId, new Date().toISOString().slice(0, 10), WEIGHTS[job.kind as Action]);
  entry.controller.abort();
  return Response.json({ status: 'cancelled' });
}

import { refundCredits, WEIGHTS, type Action } from '@archwoven/jobs';
import { serverDeps, readOrCreateSession } from '../../../../lib/server';
import { repoJobRegistry } from '../../../../lib/repo-registry';

export const runtime = 'nodejs';

/** Owner-checked cancellation: flips status, refunds the job's reserved weight
 *  exactly once (the registry's `settled` claim), and aborts the in-flight call. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { sessionId } = readOrCreateSession(req);
  const { id } = await ctx.params;
  const job = serverDeps.store.getJob(id);
  if (!job || job.sessionId !== sessionId) return Response.json({ error: 'job not found' }, { status: 404 });
  if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
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

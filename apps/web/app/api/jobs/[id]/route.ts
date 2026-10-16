import { serverDeps, readOrCreateSession } from '../../../lib/server';
import { slotPosition } from '../../../lib/llm-limiter';
import { jobRegistry } from '../../../lib/job-registry';

export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { sessionId } = readOrCreateSession(req);
  const { id } = await ctx.params;
  const job = serverDeps.store.getJob(id);
  if (!job || job.sessionId !== sessionId) return Response.json({ error: 'job not found' }, { status: 404 });
  const revision = job.status === 'succeeded' ? serverDeps.store.getRevision(job.modelId)?.revision ?? null : null;
  const queuePosition = job.status === 'queued' ? slotPosition(id) : null;
  return Response.json({ status: job.status, stage: job.stage ?? null, modelId: job.modelId, revision, queuePosition, deadlineAt: jobRegistry.get(id)?.deadlineAt ?? null, gaps: job.gaps ?? [], error: job.error ?? null });
}

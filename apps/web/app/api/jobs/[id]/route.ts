import { serverDeps } from '../../../lib/server';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = serverDeps.store.getJob(id);
  if (!job) return Response.json({ error: 'job not found' }, { status: 404 });
  const revision = job.status === 'succeeded' ? serverDeps.store.getRevision(job.modelId)?.revision ?? null : null;
  return Response.json({ status: job.status, stage: job.stage ?? null, modelId: job.modelId, revision, error: job.error ?? null });
}

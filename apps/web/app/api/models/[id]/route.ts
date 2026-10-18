import { serverDeps, readOrCreateSession } from '../../../lib/server';
import { hostedJobs, HOSTED_NOT_CONFIGURED_COPY, HOSTED_UNAVAILABLE_COPY } from '../../../lib/hosted-runner';

/** Hosted results live in Redis for 24 hours; Vercel has no local store, development servers keep both. */
const hostedOnly = () => process.env.VERCEL === '1';

export const runtime = 'nodejs';

// The canvas needs the full model once a job succeeds; jobs polling only carries ids.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { sessionId } = readOrCreateSession(req);
  const { id } = await ctx.params;
  const jobs = hostedJobs();
  if (jobs === 'misconfigured') return Response.json({ error: HOSTED_NOT_CONFIGURED_COPY }, { status: 503 });
  if (!hostedOnly() && serverDeps.store.getRevisionOwner(id) === sessionId) {
    const model = serverDeps.store.getRevision(id);
    if (model) return Response.json({ model });
  }
  if (jobs) {
    try {
      const model = await jobs.getOwned('model', id, sessionId);
      if (model) return Response.json({ model });
    } catch { return Response.json({ error: HOSTED_UNAVAILABLE_COPY }, { status: 503 }); }
  }
  return Response.json({ error: 'model not found' }, { status: 404 });
}

// Deletion is honored on request — every revision and job of the diagram, owner only.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { sessionId } = readOrCreateSession(req);
  const { id } = await ctx.params;
  const jobs = hostedJobs();
  if (jobs === 'misconfigured') return Response.json({ error: HOSTED_NOT_CONFIGURED_COPY }, { status: 503 });
  let deleted = false;
  if (jobs) {
    try { deleted = await jobs.deleteOwned('model', id, sessionId); }
    catch { return Response.json({ error: HOSTED_UNAVAILABLE_COPY }, { status: 503 }); }
  }
  if (!hostedOnly() && serverDeps.store.getRevisionOwner(id) === sessionId) { serverDeps.store.deleteModel(id); deleted = true; }
  if (!deleted) return Response.json({ error: 'model not found' }, { status: 404 });
  return Response.json({ deleted: true });
}

import { serverDeps, readOrCreateSession } from '../../../lib/server';
import { hostedJobs, HOSTED_NOT_CONFIGURED_COPY, HOSTED_UNAVAILABLE_COPY } from '../../../lib/hosted-runner';
import { putRestoredModel } from '../../../lib/hosted-model-edit';
import { ownedModel } from '../../../lib/hosted-diagram-job';

export const runtime = 'nodejs';

// The canvas needs the full model once a job succeeds; jobs polling only carries ids.
// With hosted job storage the server copy lives in Redis for 24 hours; otherwise in the local database.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { sessionId } = readOrCreateSession(req);
  const { id } = await ctx.params;
  const jobs = hostedJobs();
  if (jobs === 'misconfigured') return Response.json({ error: HOSTED_NOT_CONFIGURED_COPY }, { status: 503 });
  if (jobs) {
    let stored;
    try { stored = await ownedModel(jobs, id, sessionId); }
    catch { return Response.json({ error: HOSTED_UNAVAILABLE_COPY }, { status: 503 }); }
    if (stored.owner === 'self') return Response.json({ model: stored.model }, { headers: { 'cache-control': 'private, no-store' } });
    // An expired or unreadable copy of one's own diagram can be put back from the browser.
    return Response.json(stored.owner === 'absent' ? { error: 'model not found', reason: 'expired' } : { error: 'model not found' }, { status: 404 });
  }
  if (serverDeps.store.getRevisionOwner(id) === sessionId) {
    const model = serverDeps.store.getRevision(id);
    if (model) return Response.json({ model });
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
  } else if (serverDeps.store.getRevisionOwner(id) === sessionId) { serverDeps.store.deleteModel(id); deleted = true; }
  if (!deleted) return Response.json({ error: 'model not found' }, { status: 404 });
  return Response.json({ deleted: true });
}

// Put this browser's saved copy back after the 24-hour server copy expired (hosted only).
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return putRestoredModel(req, hostedJobs(), (await ctx.params).id);
}

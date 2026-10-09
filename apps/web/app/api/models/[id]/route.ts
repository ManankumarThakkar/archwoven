import { serverDeps, readOrCreateSession } from '../../../lib/server';

export const runtime = 'nodejs';

// The canvas needs the full model once a job succeeds; jobs polling only carries ids.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { sessionId } = readOrCreateSession(req);
  const { id } = await ctx.params;
  if (serverDeps.store.getRevisionOwner(id) !== sessionId) return Response.json({ error: 'model not found' }, { status: 404 });
  const model = serverDeps.store.getRevision(id);
  if (!model) return Response.json({ error: 'model not found' }, { status: 404 });
  return Response.json({ model });
}

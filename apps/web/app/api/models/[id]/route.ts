import { serverDeps } from '../../../lib/server';

export const runtime = 'nodejs';

// The canvas needs the full model once a job succeeds; jobs polling only carries ids.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const model = serverDeps.store.getRevision(id);
  if (!model) return Response.json({ error: 'model not found' }, { status: 404 });
  return Response.json({ model });
}

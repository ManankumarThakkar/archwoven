import { undoTo } from '@archwoven/model';
import { serverDeps, readOrCreateSession, sessionCookie } from '../../../../lib/server';

export const runtime = 'nodejs';

/**
 * Undo is a forward revision (undoTo): the client's ↶ restores content it saw,
 * durably, so a reload or a later refine never silently reverts the user to
 * the pre-undo state. Ownership-checked like every other model route.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { sessionId, minted } = readOrCreateSession(req);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (minted) headers['set-cookie'] = sessionCookie(sessionId);

  const { id } = await ctx.params;
  if (serverDeps.store.getRevisionOwner(id) !== sessionId) return Response.json({ error: 'model not found' }, { status: 404, headers });

  let body: { prevRevision?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400, headers });
  }

  const prevRevision = Number(body.prevRevision);
  if (!Number.isInteger(prevRevision)) return Response.json({ error: 'prevRevision is required' }, { status: 400, headers });

  const latest = serverDeps.store.getRevision(id);
  const prev = serverDeps.store.getRevision(id, prevRevision);
  if (!latest || !prev) return Response.json({ error: 'revision not found' }, { status: 400, headers });

  const undone = undoTo(latest, prev);
  serverDeps.store.saveRevision(id, undone, sessionId);
  return Response.json({ model: undone, revision: undone.revision }, { status: 200, headers });
}

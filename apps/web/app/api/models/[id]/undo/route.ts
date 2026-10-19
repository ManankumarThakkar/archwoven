import { undoTo } from '@archwoven/model';
import { serverDeps, readOrCreateSession, sessionCookie } from '../../../../lib/server';
import { hostedJobs } from '../../../../lib/hosted-runner';
import { postHostedUndo } from '../../../../lib/hosted-model-edit';

export const runtime = 'nodejs';

/**
 * Undo is a forward revision (undoTo): the client's ↶ restores content it saw,
 * durably, so a reload or a later refine never silently reverts the user to
 * the pre-undo state. Ownership-checked like every other model route.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const jobs = hostedJobs();
  if (jobs) return postHostedUndo(req, jobs, (await ctx.params).id);
  const { sessionId, minted } = readOrCreateSession(req);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (minted) headers['set-cookie'] = sessionCookie(sessionId);

  const { id } = await ctx.params;
  if (serverDeps.store.getRevisionOwner(id) !== sessionId) return Response.json({ error: 'model not found' }, { status: 404, headers });

  let body: { prevRevision?: number; baseRevision?: number } | null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400, headers });
  }

  const prevRevision = body?.prevRevision, baseRevision = body?.baseRevision;
  if (!Number.isInteger(prevRevision) || !Number.isInteger(baseRevision)) return Response.json({ error: 'prevRevision and baseRevision are required. Reload the diagram and try again.' }, { status: 400, headers });

  const latest = serverDeps.store.getRevision(id);
  const prev = serverDeps.store.getRevision(id, prevRevision!);
  if (!latest || !prev) return Response.json({ error: 'revision not found' }, { status: 400, headers });
  if (baseRevision !== latest.revision) return Response.json({ reason: 'stale-revision', message: 'The diagram changed elsewhere. Review the latest version before undoing.', model: latest }, { status: 409, headers });

  const undone = undoTo(latest, prev);
  serverDeps.store.saveRevision(id, undone, sessionId);
  return Response.json({ model: undone, revision: undone.revision }, { status: 200, headers });
}

import { applyEditOps } from '@archwoven/model';
import { serverDeps, readOrCreateSession } from '../../../../lib/server';
import { directEditOps, readDirectEdit } from '../../../../../lib/direct-edit';
export const runtime = 'nodejs';
export async function POST(req: Request, ctx: {
    params: Promise<{
        id: string;
    }>;
}) {
    const { sessionId } = readOrCreateSession(req), { id } = await ctx.params;
    if (serverDeps.store.getRevisionOwner(id) !== sessionId)
        return Response.json({ error: 'model not found' }, { status: 404 });
    let body: unknown;
    try {
        body = await readDirectEdit(req);
    }
    catch {
        return Response.json({ error: 'Invalid edit. Use a name up to 500 characters or finite node positions.' }, { status: 400 });
    }
    const latest = serverDeps.store.getRevision(id);
    if (!latest)
        return Response.json({ error: 'model not found' }, { status: 404 });
    if (!body || typeof body !== 'object' || !('baseRevision' in body) || !Number.isInteger(body.baseRevision) || Number(body.baseRevision) < 1)
        return Response.json({ error: 'baseRevision is required' }, { status: 400 });
    if (body.baseRevision !== latest.revision)
        return Response.json({ reason: 'stale-revision', message: 'The diagram changed elsewhere. Review the latest version and try again.', model: latest }, { status: 409 });
    const ops = directEditOps(body, latest);
    if (!ops || req.signal.aborted)
        return Response.json({ error: 'Invalid edit. Choose an existing element, a name of 1–500 characters, or node positions within ±100000.' }, { status: 400 });
    const applied = applyEditOps(latest, ops);
    if (!applied.ok)
        return Response.json({ errors: applied.errors }, { status: 400 });
    serverDeps.store.saveRevision(id, applied.model, sessionId);
    return Response.json({ model: applied.model, revision: applied.model.revision });
}

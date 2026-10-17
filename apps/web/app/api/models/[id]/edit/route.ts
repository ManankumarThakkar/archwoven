import { applyEditOps, closeDetailView, openDetailView, orientArchitecture } from '@archwoven/model';
import { serverDeps, readOrCreateSession } from '../../../../lib/server';
import { detailEdit, directEditOps, orientationEdit, readDirectEdit } from '../../../../../lib/direct-edit';
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
        return Response.json({ error: 'Invalid edit. Choose a name, node positions, or an architecture direction.' }, { status: 400 });
    }
    const latest = serverDeps.store.getRevision(id);
    if (!latest)
        return Response.json({ error: 'model not found' }, { status: 404 });
    if (!body || typeof body !== 'object' || !('baseRevision' in body) || !Number.isInteger(body.baseRevision) || Number(body.baseRevision) < 1)
        return Response.json({ error: 'baseRevision is required' }, { status: 400 });
    if (body.baseRevision !== latest.revision)
        return Response.json({ reason: 'stale-revision', message: 'The diagram changed elsewhere. Review the latest version and try again.', model: latest }, { status: 409 });
    const orientation = orientationEdit(body, latest);
    const detail = orientation ? null : detailEdit(body, latest);
    const ops = orientation || detail ? null : directEditOps(body, latest);
    if ((!ops && !orientation && !detail) || req.signal.aborted)
        return Response.json({ error: 'Invalid edit. Choose an existing element, a name of 1–500 characters, node positions within ±100000, a horizontal/vertical architecture direction, or a component detail view.' }, { status: 400 });
    const applied = orientation ? orientArchitecture(latest, orientation.viewId, orientation.orientation)
        : detail ? (detail.type === 'detail' ? openDetailView(latest, detail.target) : closeDetailView(latest, detail.viewId))
        : applyEditOps(latest, ops!);
    if (!applied.ok)
        return Response.json({ errors: applied.errors }, { status: 400 });
    if (applied.model.revision !== latest.revision) serverDeps.store.saveRevision(id, applied.model, sessionId);
    return Response.json({ model: applied.model, revision: applied.model.revision });
}

import { serverDeps, readOrCreateSession } from '../../../../lib/server';
import { applyDirectEdit, INVALID_EDIT_COPY, readDirectEdit } from '../../../../../lib/direct-edit';
import { hostedJobs } from '../../../../lib/hosted-runner';
import { postHostedEdit } from '../../../../lib/hosted-model-edit';
export const runtime = 'nodejs';
export async function POST(req: Request, ctx: {
    params: Promise<{
        id: string;
    }>;
}) {
    const jobs = hostedJobs();
    if (jobs) return postHostedEdit(req, jobs, (await ctx.params).id);
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
    if (req.signal.aborted)
        return Response.json({ error: INVALID_EDIT_COPY }, { status: 400 });
    const applied = applyDirectEdit(body, latest);
    if (!applied.ok)
        return Response.json(applied.invalid ? { error: applied.errors[0] } : { errors: applied.errors }, { status: 400 });
    if (applied.model.revision !== latest.revision) serverDeps.store.saveRevision(id, applied.model, sessionId);
    return Response.json({ model: applied.model, revision: applied.model.revision });
}

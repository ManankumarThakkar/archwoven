import type { HostedJobs } from '@archwoven/jobs';
import { SystemModelSchema, undoTo, type SystemModel } from '@archwoven/model';
import { readOrCreateSession, sessionCookie } from './server';
import { HOSTED_NOT_CONFIGURED_COPY, HOSTED_UNAVAILABLE_COPY } from './hosted-runner';
import { clientModel, MAX_DIAGRAM_REQUEST_BYTES } from './hosted-diagram-job';
import { applyDirectEdit, readDirectEdit, RequestTooLarge } from '../../lib/direct-edit';

export const EXPIRED_MODEL_COPY = 'The server copy of this diagram has expired: it is kept for 24 hours after its last change.';
const STALE_EDIT_COPY = 'The diagram changed elsewhere. Review the latest version and try again.';
const STALE_UNDO_COPY = 'The diagram changed elsewhere. Review the latest version before undoing.';

type Reply = (body: unknown, status?: number) => Response;
function replier(req: Request): { sessionId: string; reply: Reply } {
  const { sessionId, minted } = readOrCreateSession(req);
  const headers: Record<string, string> = { 'cache-control': 'private, no-store' };
  if (minted) headers['set-cookie'] = sessionCookie(sessionId);
  return { sessionId, reply: (body, status = 200) => Response.json(body, { status, headers }) };
}

async function readBody(req: Request, reply: Reply, maxBytes?: number): Promise<{ body: Record<string, unknown> } | { response: Response }> {
  try {
    const body = await readDirectEdit(req, maxBytes);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { response: reply({ error: 'invalid request body' }, 400) };
    return { body: body as Record<string, unknown> };
  } catch (error) {
    return { response: error instanceof RequestTooLarge ? reply({ error: 'This request is too large.' }, 413) : reply({ error: 'invalid JSON body' }, 400) };
  }
}

/** The owner's saved server copy; another visitor's id and an expired or unreadable copy are answered without detail. */
async function ownedLatest(jobs: HostedJobs, id: string, sessionId: string, reply: Reply): Promise<SystemModel | Response> {
  const state = await jobs.modelState(id, sessionId);
  if (state.owner === 'other') return reply({ error: 'model not found' }, 404);
  const parsed = SystemModelSchema.safeParse(state.model);
  if (state.owner === 'absent' || !parsed.success) return reply({ reason: 'expired', message: EXPIRED_MODEL_COPY }, 404);
  return parsed.data;
}

/** Save `next` over `latest` only if no other change landed in between. */
async function save(jobs: HostedJobs, id: string, sessionId: string, latest: SystemModel, next: SystemModel, reply: Reply, staleCopy: string): Promise<Response> {
  const saved = await jobs.putModel(id, sessionId, next, latest.revision);
  if (saved === 'ok') return reply({ model: next, revision: next.revision });
  if (saved === 'not-owner') return reply({ error: 'model not found' }, 404);
  const current = await ownedLatest(jobs, id, sessionId, reply);
  return current instanceof Response ? current : reply({ reason: 'stale-revision', message: staleCopy, model: current }, 409);
}

/** A direct edit (rename, move, direction, detail view) to the hosted server copy. No AI request is made. */
export async function postHostedEdit(req: Request, jobs: HostedJobs | 'misconfigured', id: string): Promise<Response> {
  const { sessionId, reply } = replier(req);
  if (jobs === 'misconfigured') return reply({ reason: 'unavailable', message: HOSTED_NOT_CONFIGURED_COPY }, 503);
  const read = await readBody(req, reply);
  if ('response' in read) return read.response;
  if (!Number.isInteger(read.body.baseRevision) || Number(read.body.baseRevision) < 1) return reply({ error: 'baseRevision is required' }, 400);
  try {
    const latest = await ownedLatest(jobs, id, sessionId, reply);
    if (latest instanceof Response) return latest;
    if (read.body.baseRevision !== latest.revision) return reply({ reason: 'stale-revision', message: STALE_EDIT_COPY, model: latest }, 409);
    const applied = applyDirectEdit(read.body, latest);
    if (!applied.ok) return reply(applied.invalid ? { error: applied.errors[0] } : { errors: applied.errors }, 400);
    if (applied.model.revision === latest.revision) return reply({ model: latest, revision: latest.revision });
    return await save(jobs, id, sessionId, latest, applied.model, reply, STALE_EDIT_COPY);
  } catch {
    return reply({ reason: 'unavailable', message: HOSTED_UNAVAILABLE_COPY }, 503);
  }
}

/**
 * Undo on the hosted server copy, which keeps only the latest revision: the page sends the earlier
 * version it showed, which is checked as untrusted input and saved as a new forward revision.
 */
export async function postHostedUndo(req: Request, jobs: HostedJobs | 'misconfigured', id: string): Promise<Response> {
  const { sessionId, reply } = replier(req);
  if (jobs === 'misconfigured') return reply({ reason: 'unavailable', message: HOSTED_NOT_CONFIGURED_COPY }, 503);
  const read = await readBody(req, reply, MAX_DIAGRAM_REQUEST_BYTES);
  if ('response' in read) return read.response;
  const { prevRevision, baseRevision, previous } = read.body;
  if (!Number.isInteger(prevRevision) || !Number.isInteger(baseRevision)) return reply({ error: 'prevRevision and baseRevision are required. Reload the diagram and try again.' }, 400);
  try {
    const latest = await ownedLatest(jobs, id, sessionId, reply);
    if (latest instanceof Response) return latest;
    if (baseRevision !== latest.revision) return reply({ reason: 'stale-revision', message: STALE_UNDO_COPY, model: latest }, 409);
    const earlier = Number(prevRevision) < latest.revision ? clientModel(previous, Number(prevRevision)) : null;
    if (!earlier) return reply({ error: 'The earlier version could not be read, so nothing was undone. Reload the diagram and try again.' }, 400);
    // Privacy is server-stamped: an earlier version from the browser cannot change it.
    const undone = { ...undoTo(latest, earlier), privacy: latest.privacy };
    return await save(jobs, id, sessionId, latest, undone, reply, STALE_UNDO_COPY);
  } catch {
    return reply({ reason: 'unavailable', message: HOSTED_UNAVAILABLE_COPY }, 503);
  }
}

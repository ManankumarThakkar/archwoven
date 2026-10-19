import { randomUUID } from 'node:crypto';
import type { HostedJobs } from '@archwoven/jobs';
import { SystemModelSchema, undoTo, type SystemModel } from '@archwoven/model';
import { readOrCreateSession, serverDeps, sessionCookie, spenderOf } from './server';
import { deployMode, privacyForMode } from './mode';
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

/** Browser copies and JSON downloads are far smaller than this; the bound keeps free writes cheap. */
export const MAX_COPY_BYTES = 512 * 1024;
/** Free writes of whole diagrams (restores and imports) per UTC-agnostic day window, bounding shared Redis memory. */
export const COPY_LIMITS = { visitor: 30, network: 60, global: 200, windowSeconds: 86_400 };
const COPY_LIMIT_COPY = 'You have restored or imported many diagrams today. Try again tomorrow; viewing and downloads still work.';
const INVALID_COPY = 'This diagram could not be read. Choose a JSON file downloaded from Archwoven.';

/** A whole diagram sent by the browser (its saved copy, or an imported download): bounded, schema-checked and validated. */
async function readCopy(req: Request, reply: Reply): Promise<{ model: SystemModel } | { response: Response }> {
  const read = await readBody(req, reply, MAX_COPY_BYTES + 4096);
  if ('response' in read) return read;
  if (Object.keys(read.body).some(key => key !== 'model')) return { response: reply({ error: 'Send only the diagram.' }, 400) };
  let size: number;
  try { size = Buffer.byteLength(JSON.stringify(read.body.model) ?? ''); } catch { size = Infinity; }
  if (size > MAX_COPY_BYTES) return { response: reply({ reason: 'oversized', message: 'This diagram is too large to open here (512 KB at most).' }, 413) };
  const raw = read.body.model as { revision?: unknown } | null;
  const model = raw && typeof raw === 'object' && Number.isInteger(raw.revision) ? clientModel(raw, Number(raw.revision)) : null;
  if (!model) return { response: reply({ reason: 'invalid-model', error: INVALID_COPY }, 400) };
  // Privacy is server-stamped from deploy mode: a copy from the browser cannot change it.
  return { model: { ...model, privacy: privacyForMode(deployMode()) } };
}

async function allowCopy(jobs: HostedJobs, req: Request, sessionId: string): Promise<boolean> {
  const { network } = spenderOf(req.headers, sessionId);
  return await jobs.allow('copies', jobs.ownerOf(sessionId), COPY_LIMITS.visitor, COPY_LIMITS.windowSeconds)
    && (!network || await jobs.allow('copies-network', network, COPY_LIMITS.network, COPY_LIMITS.windowSeconds))
    && await jobs.allow('copies-all', 'all', COPY_LIMITS.global, COPY_LIMITS.windowSeconds);
}

/** Put the browser's copy back where the 24-hour server copy has expired. An existing server copy always wins. */
export async function putRestoredModel(req: Request, jobs: HostedJobs | 'misconfigured' | null, id: string): Promise<Response> {
  const { sessionId, reply } = replier(req);
  if (jobs === null) return reply({ error: 'This deployment keeps diagrams on the server; there is nothing to restore.' }, 404);
  if (jobs === 'misconfigured') return reply({ reason: 'unavailable', message: HOSTED_NOT_CONFIGURED_COPY }, 503);
  if (!/^[0-9a-f-]{36}$/.test(id)) return reply({ error: 'A diagram id is required.' }, 400);
  const read = await readCopy(req, reply);
  if ('response' in read) return read.response;
  try {
    const state = await jobs.modelState(id, sessionId);
    if (state.owner === 'other') return reply({ error: 'model not found' }, 404);
    if (state.owner === 'self') return reply({ reason: 'exists', message: 'The server still has this diagram; its copy is shown.', model: state.model }, 409);
    if (!await allowCopy(jobs, req, sessionId)) return reply({ reason: 'burst', message: COPY_LIMIT_COPY }, 429);
    const restored = await jobs.restoreModel(id, sessionId, read.model);
    if (restored === 'not-owner') return reply({ error: 'model not found' }, 404);
    if (restored === 'exists') {
      const current = await jobs.modelState(id, sessionId);
      return reply({ reason: 'exists', message: 'The server still has this diagram; its copy is shown.', model: current.model }, 409);
    }
    return reply({ model: read.model, revision: read.model.revision });
  } catch {
    return reply({ reason: 'unavailable', message: HOSTED_UNAVAILABLE_COPY }, 503);
  }
}

/** Open a JSON download as a new diagram owned by this visitor. */
export async function postImportedModel(req: Request, jobs: HostedJobs | 'misconfigured' | null): Promise<Response> {
  const { sessionId, reply } = replier(req);
  if (jobs === 'misconfigured') return reply({ reason: 'unavailable', message: HOSTED_NOT_CONFIGURED_COPY }, 503);
  const read = await readCopy(req, reply);
  if ('response' in read) return read.response;
  const id = randomUUID();
  if (jobs === null) {
    serverDeps.store.saveRevision(id, read.model, sessionId);
    return reply({ id, model: read.model }, 201);
  }
  try {
    if (!await allowCopy(jobs, req, sessionId)) return reply({ reason: 'burst', message: COPY_LIMIT_COPY }, 429);
    if (await jobs.restoreModel(id, sessionId, read.model) !== 'ok') return reply({ reason: 'unavailable', message: HOSTED_UNAVAILABLE_COPY }, 503);
    return reply({ id, model: read.model }, 201);
  } catch {
    return reply({ reason: 'unavailable', message: HOSTED_UNAVAILABLE_COPY }, 503);
  }
}

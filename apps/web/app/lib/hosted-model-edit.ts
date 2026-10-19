import { isOwnedId, ownedId } from './owned-ids';
import type { HostedJobs } from '@archwoven/jobs';
import { undoTo, type SystemModel } from '@archwoven/model';
import { readOrCreateSession, serverDeps, sessionCookie, spenderOf } from './server';
import { deployMode, privacyForMode } from './mode';
import { HOSTED_NOT_CONFIGURED_COPY, HOSTED_UNAVAILABLE_COPY } from './hosted-runner';
import { clientModel, EXPIRED_MODEL_COPY, ownedModel } from './hosted-diagram-job';
import { applyDirectEdit, readDirectEdit, RequestTooLarge } from '../../lib/direct-edit';

export { EXPIRED_MODEL_COPY } from './hosted-diagram-job';
const STALE_EDIT_COPY = 'The diagram changed elsewhere. Review the latest version and try again.';
const STALE_UNDO_COPY = 'The diagram changed elsewhere. Review the latest version before undoing.';

/** Browser copies and JSON downloads are far smaller than this; the bound keeps free writes cheap and every diagram restorable. */
export const MAX_COPY_BYTES = 512 * 1024;
type Limits = { visitor: number; network: number; global: number; windowSeconds: number };
/** Free whole-diagram writes (restores and imports) per day, bounding shared Redis memory. */
export const COPY_LIMITS: Limits = { visitor: 30, network: 60, global: 200, windowSeconds: 86_400 };
/** Free direct edits and undos per day, bounding shared Redis commands. */
export const EDIT_LIMITS: Limits = { visitor: 300, network: 600, global: 600, windowSeconds: 86_400 };
const LATER = 'Try again tomorrow; viewing and downloads still work.';
const COPY_LIMIT_COPY = { visitor: `You have restored or imported many diagrams today. ${LATER}`, network: `Many diagrams were restored or imported from your network today. ${LATER}`, global: `Archwoven has restored or imported as many diagrams as it can today. ${LATER}` };
const EDIT_LIMIT_COPY = { visitor: `You have made many changes today. ${LATER}`, network: `Many changes were made from your network today. ${LATER}`, global: `Archwoven has saved as many changes as it can today. ${LATER}` };
const INVALID_COPY = 'This diagram could not be read. Choose a JSON file downloaded from Archwoven.';
const TOO_LARGE_COPY = 'This diagram is too large for this deployment (512 KB at most).';

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
    return { response: error instanceof RequestTooLarge ? reply({ reason: 'oversized', message: TOO_LARGE_COPY }, 413) : reply({ error: 'invalid JSON body' }, 400) };
  }
}

const bytes = (value: unknown) => { try { return Buffer.byteLength(JSON.stringify(value) ?? ''); } catch { return Infinity; } };

/** Count one free write for this visitor, their network and everyone; the message names the limit reached, or null. */
async function limitReached(jobs: HostedJobs, req: Request, sessionId: string, bucket: 'copies' | 'edits', limits: Limits, copy: Record<'visitor' | 'network' | 'global', string>): Promise<string | null> {
  const { network } = spenderOf(req.headers, sessionId);
  if (!await jobs.allow(bucket, jobs.ownerOf(sessionId), limits.visitor, limits.windowSeconds)) return copy.visitor;
  if (network && !await jobs.allow(`${bucket}-network`, network, limits.network, limits.windowSeconds)) return copy.network;
  if (!await jobs.allow(`${bucket}-all`, 'all', limits.global, limits.windowSeconds)) return copy.global;
  return null;
}

/** The owner's saved server copy; another visitor's id and an expired or unreadable copy are answered without detail. */
async function ownedLatest(jobs: HostedJobs, id: string, sessionId: string, reply: Reply): Promise<SystemModel | Response> {
  const stored = await ownedModel(jobs, id, sessionId);
  if (stored.owner === 'other') return reply({ error: 'model not found' }, 404);
  if (stored.owner === 'absent') return reply({ reason: 'expired', message: EXPIRED_MODEL_COPY }, 404);
  return stored.model;
}

/** Save `next` over `latest` only if no other change landed in between, within the free edit limits. */
async function save(jobs: HostedJobs, req: Request, id: string, sessionId: string, latest: SystemModel, next: SystemModel, reply: Reply, staleCopy: string): Promise<Response> {
  if (bytes(next) > MAX_COPY_BYTES) return reply({ reason: 'oversized', message: TOO_LARGE_COPY }, 413);
  const limited = await limitReached(jobs, req, sessionId, 'edits', EDIT_LIMITS, EDIT_LIMIT_COPY);
  if (limited) return reply({ reason: 'burst', message: limited }, 429);
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
  if (!isOwnedId(id, sessionId)) return reply({ error: 'model not found' }, 404);
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
    return await save(jobs, req, id, sessionId, latest, applied.model, reply, STALE_EDIT_COPY);
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
  if (!isOwnedId(id, sessionId)) return reply({ error: 'model not found' }, 404);
  const read = await readBody(req, reply, MAX_COPY_BYTES + 4096);
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
    return await save(jobs, req, id, sessionId, latest, undone, reply, STALE_UNDO_COPY);
  } catch {
    return reply({ reason: 'unavailable', message: HOSTED_UNAVAILABLE_COPY }, 503);
  }
}

/** A whole diagram sent by the browser (its saved copy, or an imported download): bounded, schema-checked and validated. */
async function readCopy(req: Request, reply: Reply): Promise<{ model: SystemModel } | { response: Response }> {
  const read = await readBody(req, reply, MAX_COPY_BYTES + 4096);
  if ('response' in read) return read;
  if (Object.keys(read.body).some(key => key !== 'model')) return { response: reply({ error: 'Send only the diagram.' }, 400) };
  if (bytes(read.body.model) > MAX_COPY_BYTES) return { response: reply({ reason: 'oversized', message: TOO_LARGE_COPY }, 413) };
  const raw = read.body.model as { revision?: unknown } | null;
  const model = raw && typeof raw === 'object' && Number.isInteger(raw.revision) ? clientModel(raw, Number(raw.revision)) : null;
  if (!model) return { response: reply({ reason: 'invalid-model', error: INVALID_COPY }, 400) };
  // Privacy is server-stamped from deploy mode: a copy from the browser cannot change it.
  return { model: { ...model, privacy: privacyForMode(deployMode()) } };
}

/** Put the browser's copy back where the 24-hour server copy has expired. An existing server copy always wins. */
export async function putRestoredModel(req: Request, jobs: HostedJobs | 'misconfigured' | null, id: string): Promise<Response> {
  const { sessionId, reply } = replier(req);
  if (jobs === null) return reply({ error: 'This deployment keeps diagrams on the server; there is nothing to restore.' }, 404);
  if (jobs === 'misconfigured') return reply({ reason: 'unavailable', message: HOSTED_NOT_CONFIGURED_COPY }, 503);
  // Only the session that created a diagram id may restore it, so an expired id cannot be claimed by anyone else.
  if (!isOwnedId(id, sessionId)) return reply({ error: 'model not found' }, 404);
  const read = await readCopy(req, reply);
  if ('response' in read) return read.response;
  try {
    const exists = (model: unknown) => reply({ reason: 'exists', message: 'The server still has this diagram; its copy is shown.', model }, 409);
    const stored = await ownedModel(jobs, id, sessionId);
    if (stored.owner === 'other') return reply({ error: 'model not found' }, 404);
    if (stored.owner === 'self') return exists(stored.model);
    const limited = await limitReached(jobs, req, sessionId, 'copies', COPY_LIMITS, COPY_LIMIT_COPY);
    if (limited) return reply({ reason: 'burst', message: limited }, 429);
    const restored = await jobs.restoreModel(id, sessionId, read.model);
    if (restored === 'not-owner') return reply({ error: 'model not found' }, 404);
    if (restored === 'exists') return exists((await jobs.modelState(id, sessionId)).model);
    return reply({ model: read.model, revision: read.model.revision });
  } catch {
    return reply({ reason: 'unavailable', message: HOSTED_UNAVAILABLE_COPY }, 503);
  }
}

/** Open a JSON download as a new diagram owned by this visitor. */
export async function postImportedModel(req: Request, jobs: HostedJobs | 'misconfigured' | null): Promise<Response> {
  const { sessionId, reply } = replier(req);
  if (jobs === 'misconfigured') return reply({ reason: 'unavailable', message: HOSTED_NOT_CONFIGURED_COPY }, 503);
  // Without hosted job storage only a private local deployment may write imports, which have no free-write limit there.
  if (jobs === null && deployMode() !== 'local') return reply({ reason: 'unavailable', message: 'Opening JSON downloads is not available in this deployment.' }, 503);
  const read = await readCopy(req, reply);
  if ('response' in read) return read.response;
  const id = jobs === null ? crypto.randomUUID() : ownedId(sessionId);
  if (jobs === null) {
    serverDeps.store.saveRevision(id, read.model, sessionId);
    return reply({ id, model: read.model }, 201);
  }
  try {
    const limited = await limitReached(jobs, req, sessionId, 'copies', COPY_LIMITS, COPY_LIMIT_COPY);
    if (limited) return reply({ reason: 'burst', message: limited }, 429);
    if (await jobs.restoreModel(id, sessionId, read.model) !== 'ok') return reply({ reason: 'unavailable', message: HOSTED_UNAVAILABLE_COPY }, 503);
    return reply({ id, model: read.model }, 201);
  } catch {
    return reply({ reason: 'unavailable', message: HOSTED_UNAVAILABLE_COPY }, 503);
  }
}

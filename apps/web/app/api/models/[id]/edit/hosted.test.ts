import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Store } from '@archwoven/jobs';
import { validFullModel, type SystemModel, type TaskUsage } from '@archwoven/model';
import { startTestRedis } from '../../../../../../../packages/jobs/src/redis-test-server';
import { serverDeps } from '../../../../lib/server';
import { hostedJobs } from '../../../../lib/hosted-runner';
import { POST as generate } from '../../../generate/route';
import { GET as getModel } from '../route';
import { GET as getQuota } from '../../../quota/route';
import { POST as edit } from './route';
import { POST as undo } from '../undo/route';

const redis = await startTestRedis();
if (!redis && process.env.CI) throw new Error('CI must provide Redis for the hosted editing tests.');
afterAll(async () => { await redis?.close(); });

const usage: TaskUsage = { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low', inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0, latencyMs: 10, repairs: 0, transportRetries: 0, usageComplete: true, attempts: [] };
const scheduled: (() => Promise<void>)[] = [];
const drain = async () => { while (scheduled.length) await scheduled.shift()!(); };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
const sessionOf = (cookie: string) => cookie.split('=')[1]!.split('.')[0]!;
const post = (body: unknown, cookie: string) => ({ method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const editReq = (id: string, cookie: string, body: unknown) => edit(new Request(`http://x/api/models/${id}/edit`, post(body, cookie)), params(id));
const undoReq = (id: string, cookie: string, body: unknown) => undo(new Request(`http://x/api/models/${id}/undo`, post(body, cookie)), params(id));
const saved = async (id: string, cookie: string) => (await (await getModel(new Request('http://x', { headers: { cookie } }), params(id))).json()).model as SystemModel;
const rename = (baseRevision: number, label: string, target = 'gateway.api') => ({ baseRevision, action: { type: 'rename', target, label } });
// Hosted mode keeps diagrams in Redis only: any use of the local database fails the test.
const noLocalStore = new Proxy({}, { get() { throw new Error('hosted diagrams must not use the local database'); } }) as Store;

async function diagram() {
  const started = await generate(new Request('http://localhost/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'A shop where customers order through an API backed by PostgreSQL.', view: 'architecture' }) }));
  const owner = cookieOf(started), { jobId } = await started.json();
  await drain();
  return { owner, id: jobId as string };
}

describe.skipIf(!redis)('hosted direct edits and undo (real Redis)', () => {
  beforeEach(async () => {
    await redis!.flush();
    for (const [key, value] of Object.entries({ ARCHWOVEN_MODE: 'hosted', ARCHWOVEN_FAKE: '0', ANTHROPIC_API_KEY: 'test-key-not-real', UPSTASH_REDIS_REST_URL: redis!.url, UPSTASH_REDIS_REST_TOKEN: redis!.token, ARCHWOVEN_REDIS_PREFIX: 'archwoven-test:', ARCHWOVEN_SESSION_SECRET: 'test-session-secret-0123456789abcdef', VERCEL: '' })) vi.stubEnv(key, value);
    serverDeps.store = noLocalStore;
    serverDeps.schedule = task => { scheduled.push(task); };
    serverDeps.generateModel = async () => ({ ok: true as const, model: validFullModel, usage });
    scheduled.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("saves an edit to the owner's server copy as the next revision, without any AI request", async () => {
    const { owner, id } = await diagram();
    const generateModel = vi.fn(); serverDeps.generateModel = generateModel;
    const response = await editReq(id, owner, rename(1, 'Edge Gateway'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ revision: 2, model: { revision: 2, parentId: 1 } });
    const stored = await saved(id, owner);
    expect(stored.revision).toBe(2);
    expect(stored.nodes.find(n => n.id === 'gateway.api')!.label).toBe('Edge Gateway');
    expect(generateModel).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
  });

  it('opens and closes a component detail view on the server copy', async () => {
    const { owner, id } = await diagram();
    const opened = await (await editReq(id, owner, { baseRevision: 1, action: { type: 'detail', target: 'gateway.api' } })).json();
    expect(opened.model.views.some((v: { id: string }) => v.id === 'detail:gateway.api')).toBe(true);
    const closed = await editReq(id, owner, { baseRevision: 2, action: { type: 'close-detail', viewId: 'detail:gateway.api' } });
    expect((await saved(id, owner)).views.some(v => v.id === 'detail:gateway.api')).toBe(false);
    expect(closed.status).toBe(200);
  });

  it('refuses an edit based on an older revision and sends the latest one', async () => {
    const { owner, id } = await diagram();
    await editReq(id, owner, rename(1, 'Edge Gateway'));
    const stale = await editReq(id, owner, rename(1, 'Other Name'));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ reason: 'stale-revision', model: { revision: 2 } });
    expect((await saved(id, owner)).nodes.find(n => n.id === 'gateway.api')!.label).toBe('Edge Gateway');
  });

  it('lets exactly one of two tabs editing the same revision win', async () => {
    const { owner, id } = await diagram();
    const results = await Promise.all([editReq(id, owner, rename(1, 'Tab A')), editReq(id, owner, rename(1, 'Tab B'))]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await saved(id, owner)).revision).toBe(2);
  });

  it("refuses another visitor's diagram and explains an expired one", async () => {
    const { owner, id } = await diagram();
    const stranger = cookieOf(await getQuota(new Request('http://x')));
    expect((await editReq(id, stranger, rename(1, 'Stolen'))).status).toBe(404);
    expect((await undoReq(id, stranger, { prevRevision: 1, baseRevision: 1, previous: validFullModel })).status).toBe(404);
    const missing = crypto.randomUUID();
    const expired = await editReq(missing, owner, rename(1, 'Gone'));
    expect(expired.status).toBe(404);
    expect(await expired.json()).toMatchObject({ reason: 'expired' });
  });

  it('refuses invalid edits', async () => {
    const { owner, id } = await diagram();
    expect((await editReq(id, owner, rename(1, ''))).status).toBe(400);
    expect((await editReq(id, owner, rename(1, 'X', 'missing.node'))).status).toBe(400);
    expect((await editReq(id, owner, '{')).status).toBe(400);
    expect((await editReq(id, owner, { baseRevision: 1, action: { type: 'rename', target: 'gateway.api', label: 'x'.repeat(70_000) } })).status).toBe(413);
    expect((await saved(id, owner)).revision).toBe(1);
  });

  it('undoes to the content the page showed before, as a new revision', async () => {
    const { owner, id } = await diagram();
    const before = await saved(id, owner);
    await editReq(id, owner, rename(1, 'Edge Gateway'));
    const response = await undoReq(id, owner, { prevRevision: 1, baseRevision: 2, previous: before });
    expect(response.status).toBe(200);
    const undone = (await response.json()).model as SystemModel;
    expect(undone).toMatchObject({ revision: 3, parentId: 2 });
    expect(undone.nodes.find(n => n.id === 'gateway.api')!.label).toBe(before.nodes.find(n => n.id === 'gateway.api')!.label);
    expect((await saved(id, owner)).revision).toBe(3);
  });

  it('treats the undo target from the browser as untrusted input', async () => {
    const { owner, id } = await diagram();
    const before = await saved(id, owner);
    await editReq(id, owner, rename(1, 'Edge Gateway'));
    expect((await undoReq(id, owner, { prevRevision: 1, baseRevision: 2, previous: { title: 'not a diagram' } })).status).toBe(400);
    expect((await undoReq(id, owner, { prevRevision: 2, baseRevision: 2, previous: { ...before, revision: 2 } })).status).toBe(400);
    expect((await undoReq(id, owner, { prevRevision: 1, baseRevision: 2, previous: { ...before, revision: 7 } })).status).toBe(400);
    const claimsPrivate = await undoReq(id, owner, { prevRevision: 1, baseRevision: 2, previous: { ...before, privacy: { classification: 'private', boundary: 'local-only' } } });
    expect((await claimsPrivate.json()).model.privacy).toEqual(before.privacy);
    expect((await undoReq(id, owner, { prevRevision: 1, baseRevision: 3, previous: { ...before, title: 'x'.repeat(1_200_000) } })).status).toBe(413);
  });

  it('refuses an undo when the diagram changed meanwhile', async () => {
    const { owner, id } = await diagram();
    const before = await saved(id, owner);
    await editReq(id, owner, rename(1, 'Edge Gateway'));
    await editReq(id, owner, rename(2, 'Changed In Another Tab'));
    const stale = await undoReq(id, owner, { prevRevision: 1, baseRevision: 2, previous: before });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ reason: 'stale-revision', model: { revision: 3 } });
  });

  it('refuses edits when Redis is unreachable, without falling back to anything else', async () => {
    const { owner, id } = await diagram();
    redis!.setDown(true);
    try { expect((await editReq(id, owner, rename(1, 'Edge Gateway'))).status).toBe(503); }
    finally { redis!.setDown(false); }
  });

  it('keeps diagrams created by hosted jobs out of the local database', async () => {
    const { owner, id } = await diagram();
    const jobs = hostedJobs(); if (!jobs || jobs === 'misconfigured') throw new Error('hosted jobs unavailable');
    expect((await jobs.modelState(id, sessionOf(owner))).owner).toBe('self');
  });
});

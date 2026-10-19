import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Store } from '@archwoven/jobs';
import { validFullModel, type TaskUsage } from '@archwoven/model';
import { startTestRedis } from '../../../../packages/jobs/src/redis-test-server';
import { serverDeps } from '../lib/server';
import { isOwnedId, ownedId } from '../lib/owned-ids';
import { POST as generate } from './generate/route';
import { POST as refine } from './refine/route';
import { GET as getJob } from './jobs/[id]/route';
import { POST as cancelJob } from './jobs/[id]/cancel/route';
import { GET as getResult } from './jobs/[id]/result/route';
import { GET as getModel, DELETE as deleteModel, PUT as restoreModel } from './models/[id]/route';
import { POST as importModel } from './models/route';
import { POST as edit } from './models/[id]/edit/route';
import { POST as undo } from './models/[id]/undo/route';
import { POST as expand } from './models/[id]/expand/route';
import { GET as getQuota } from './quota/route';

const redis = await startTestRedis();
if (!redis && process.env.CI) throw new Error('CI must provide Redis for the owned id tests.');
afterAll(async () => { await redis?.close(); });

const usage: TaskUsage = { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low', inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0, latencyMs: 10, repairs: 0, transportRetries: 0, usageComplete: true, attempts: [] };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
const sessionOf = (cookie: string) => cookie.split('=')[1]!.split('.')[0]!;
const visitor = async () => cookieOf(await getQuota(new Request('http://x')));
const send = (cookie: string, body?: unknown, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const noLocalStore = new Proxy({}, { get() { throw new Error('hosted diagrams must not use the local database'); } }) as Store;

/** Every route that takes a job or diagram id, called for `id` by `cookie`. */
const callsFor = (id: string, cookie: string) => [
  () => getJob(new Request('http://x', send(cookie, undefined, 'GET')), params(id)),
  () => cancelJob(new Request('http://x', send(cookie)), params(id)),
  () => getResult(new Request('http://x', send(cookie, undefined, 'GET')), params(id)),
  () => getModel(new Request('http://x', send(cookie, undefined, 'GET')), params(id)),
  () => deleteModel(new Request('http://x', send(cookie, undefined, 'DELETE')), params(id)),
  () => restoreModel(new Request('http://x', send(cookie, { model: validFullModel }, 'PUT')), params(id)),
  () => edit(new Request('http://x', send(cookie, { baseRevision: 1, action: { type: 'rename', target: 'gateway.api', label: 'X' } })), params(id)),
  () => undo(new Request('http://x', send(cookie, { prevRevision: 1, baseRevision: 2, previous: validFullModel })), params(id)),
  () => expand(new Request('http://x', send(cookie, { baseRevision: 1, target: 'svc.orders', model: validFullModel })), params(id)),
  () => refine(new Request('http://x', send(cookie, { modelId: id, baseRevision: 1, instruction: 'Add a cache', view: 'architecture', model: validFullModel }))),
  () => generate(new Request('http://x', send(cookie, { clarification: { jobId: id, answers: ['Orders are stored in PostgreSQL.'] } }))),
];

describe.skipIf(!redis)('job and diagram ids bound to the visitor session (real Redis)', () => {
  beforeEach(async () => {
    await redis!.flush();
    for (const [key, value] of Object.entries({ ARCHWOVEN_MODE: 'hosted', ARCHWOVEN_FAKE: '0', ANTHROPIC_API_KEY: 'test-key-not-real', UPSTASH_REDIS_REST_URL: redis!.url, UPSTASH_REDIS_REST_TOKEN: redis!.token, ARCHWOVEN_REDIS_PREFIX: 'archwoven-test:', ARCHWOVEN_SESSION_SECRET: 'test-session-secret-0123456789abcdef', VERCEL: '' })) vi.stubEnv(key, value);
    serverDeps.store = noLocalStore;
    serverDeps.schedule = () => undefined;
    serverDeps.generateModel = async () => ({ ok: true as const, model: validFullModel, usage });
  });
  afterEach(() => { vi.unstubAllEnvs(); redis!.setDown(false); });

  it('mints job and diagram ids that belong to the requesting session', async () => {
    const started = await generate(new Request('http://localhost/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'A shop where customers order through an API backed by PostgreSQL.', view: 'architecture' }) }));
    const owner = cookieOf(started), { jobId } = await started.json();
    expect(isOwnedId(jobId, sessionOf(owner))).toBe(true);
    const imported = await (await importModel(new Request('http://x', send(owner, { model: validFullModel })))).json();
    expect(isOwnedId(imported.id, sessionOf(owner))).toBe(true);
  });

  it('refuses ids this session did not create without any Redis command', async () => {
    const cookie = await visitor();
    const foreign = [crypto.randomUUID(), ownedId(sessionOf(await visitor()))];
    redis!.setDown(true); // any Redis command would now answer 503
    for (const id of foreign) for (const call of callsFor(id, cookie)) expect((await call()).status).toBe(404);
    // The visitor's own id does reach Redis, which is down.
    expect((await getModel(new Request('http://x', send(cookie, undefined, 'GET')), params(ownedId(sessionOf(cookie))))).status).toBe(503);
  });

  it("does not let another visitor claim a diagram id whose server copy expired", async () => {
    const owner = await visitor(), id = ownedId(sessionOf(owner));
    expect((await restoreModel(new Request('http://x', send(await visitor(), { model: validFullModel }, 'PUT')), params(id))).status).toBe(404);
    expect((await restoreModel(new Request('http://x', send(owner, { model: validFullModel }, 'PUT')), params(id))).status).toBe(200);
  });
});

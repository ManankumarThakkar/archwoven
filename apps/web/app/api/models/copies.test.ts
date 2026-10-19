import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStore, type Store } from '@archwoven/jobs';
import { validFullModel, type SystemModel } from '@archwoven/model';
import { startTestRedis } from '../../../../../packages/jobs/src/redis-test-server';
import { serverDeps } from '../../lib/server';
import { COPY_LIMITS } from '../../lib/hosted-model-edit';
import { POST as importModel } from './route';
import { GET as getModel, PUT as restoreModel } from './[id]/route';
import { POST as edit } from './[id]/edit/route';
import { GET as getQuota } from '../quota/route';

const redis = await startTestRedis();
if (!redis && process.env.CI) throw new Error('CI must provide Redis for the browser copy tests.');
afterAll(async () => { await redis?.close(); });

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
const visitor = async () => cookieOf(await getQuota(new Request('http://x')));
const body = (value: unknown, cookie: string, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', cookie }, body: typeof value === 'string' ? value : JSON.stringify(value) });
const restore = (id: string, cookie: string, value: unknown) => restoreModel(new Request(`http://x/api/models/${id}`, body(value, cookie, 'PUT')), params(id));
const importing = (cookie: string, value: unknown) => importModel(new Request('http://x/api/models', body(value, cookie)));
const read = async (id: string, cookie: string) => getModel(new Request('http://x', { headers: { cookie } }), params(id));
const edited = (): SystemModel => ({ ...structuredClone(validFullModel) as SystemModel, revision: 4, parentId: 3, title: 'Shop, edited in this browser' });
const noLocalStore = new Proxy({}, { get() { throw new Error('hosted diagrams must not use the local database'); } }) as Store;

describe.skipIf(!redis)('browser copies on hosted deployments (real Redis)', () => {
  beforeEach(async () => {
    await redis!.flush();
    for (const [key, value] of Object.entries({ ARCHWOVEN_MODE: 'hosted', ARCHWOVEN_FAKE: '0', UPSTASH_REDIS_REST_URL: redis!.url, UPSTASH_REDIS_REST_TOKEN: redis!.token, ARCHWOVEN_REDIS_PREFIX: 'archwoven-test:', ARCHWOVEN_SESSION_SECRET: 'test-session-secret-0123456789abcdef', VERCEL: '' })) vi.stubEnv(key, value);
    serverDeps.store = noLocalStore;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('restores an expired diagram from the browser at its revision, and then accepts edits', async () => {
    const owner = await visitor(), id = crypto.randomUUID();
    expect((await read(id, owner)).status).toBe(404);
    const response = await restore(id, owner, { model: edited() });
    expect(response.status).toBe(200);
    expect((await response.json()).model).toMatchObject({ revision: 4, title: 'Shop, edited in this browser' });
    expect((await (await read(id, owner)).json()).model.revision).toBe(4);
    const renamed = await edit(new Request(`http://x/api/models/${id}/edit`, body({ baseRevision: 4, action: { type: 'rename', target: 'gateway.api', label: 'Edge' } }, owner)), params(id));
    expect(renamed.status).toBe(200);
  });

  it('keeps the server copy when one exists, and refuses another visitor', async () => {
    const owner = await visitor(), id = crypto.randomUUID();
    await restore(id, owner, { model: edited() });
    const second = await restore(id, owner, { model: { ...edited(), revision: 9, parentId: 8, title: 'older tab' } });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ reason: 'exists', model: { revision: 4 } });
    expect((await restore(id, await visitor(), { model: edited() })).status).toBe(404);
  });

  it('treats a browser copy as untrusted input', async () => {
    const owner = await visitor(), id = crypto.randomUUID();
    const dangling = { ...edited(), edges: [...validFullModel.edges, { ...validFullModel.edges[0]!, id: 'e.bad', to: 'missing' }] };
    for (const model of [{ title: 'not a diagram' }, dangling]) expect((await restore(id, owner, { model })).status).toBe(400);
    expect((await restore(id, owner, { model: edited(), extra: 1 })).status).toBe(400);
    expect((await restore(id, owner, '{')).status).toBe(400);
    expect((await restore(id, owner, { model: { ...edited(), title: 'x'.repeat(600_000) } })).status).toBe(413);
    expect((await restore('../escape', owner, { model: edited() })).status).toBe(400);
    const claimsPrivate = await restore(id, owner, { model: { ...edited(), privacy: { classification: 'private', boundary: 'local-only' } } });
    expect((await claimsPrivate.json()).model.privacy).toEqual({ classification: 'public', boundary: 'external-allowed' });
  });

  it('imports a JSON download as a new diagram for its owner only', async () => {
    const owner = await visitor();
    const response = await importing(owner, { model: edited() });
    expect(response.status).toBe(201);
    const { id, model } = await response.json();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(model.title).toBe('Shop, edited in this browser');
    expect((await (await read(id, owner)).json()).model.revision).toBe(4);
    expect((await read(id, await visitor())).status).toBe(404);
    expect((await importing(owner, { model: { title: 'nope' } })).status).toBe(400);
  });

  it('limits free copies per visitor so restores and imports cannot fill shared storage', async () => {
    const owner = await visitor();
    for (let i = 0; i < COPY_LIMITS.visitor; i++) expect((await importing(owner, { model: edited() })).status).toBe(201);
    const refused = await importing(owner, { model: edited() });
    expect(refused.status).toBe(429);
    expect((await refused.json()).message).toMatch(/downloads? (still|keep) work/i);
    expect((await restore(crypto.randomUUID(), owner, { model: edited() })).status).toBe(429);
  });

  it('names which limit was reached when shared copies run out', async () => {
    const limit = COPY_LIMITS.global;
    COPY_LIMITS.global = 1;
    try {
      expect((await importing(await visitor(), { model: edited() })).status).toBe(201);
      const refused = await importing(await visitor(), { model: edited() });
      expect(refused.status).toBe(429);
      expect((await refused.json()).message).toMatch(/^Archwoven has restored or imported/);
    } finally { COPY_LIMITS.global = limit; }
  });

  it('refuses copies without falling back when Redis is unreachable', async () => {
    const owner = await visitor();
    redis!.setDown(true);
    try {
      expect((await importing(owner, { model: edited() })).status).toBe(503);
      expect((await restore(crypto.randomUUID(), owner, { model: edited() })).status).toBe(503);
    } finally { redis!.setDown(false); }
  });
});

describe('JSON import without hosted job storage', () => {
  beforeEach(() => { vi.stubEnv('ARCHWOVEN_MODE', 'hosted'); vi.stubEnv('UPSTASH_REDIS_REST_URL', ''); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', ''); vi.stubEnv('ARCHWOVEN_REDIS_PREFIX', ''); vi.stubEnv('VERCEL', ''); serverDeps.store = openStore(':memory:'); });
  afterEach(() => vi.unstubAllEnvs());

  it('is refused on a public single-server deployment, which has no limit for free writes', async () => {
    const response = await importing('aw_sid=someone', { model: edited() });
    expect(response.status).toBe(503);
    expect((await response.json()).message).toMatch(/not available in this deployment/);
  });
});

describe('JSON import in local mode', () => {
  beforeEach(() => { vi.stubEnv('ARCHWOVEN_MODE', 'local'); serverDeps.store = openStore(':memory:'); });
  afterEach(() => vi.unstubAllEnvs());

  it('saves an imported diagram in the local database and needs no browser restore', async () => {
    const owner = 'aw_sid=local-visitor';
    const response = await importing(owner, { model: edited() });
    expect(response.status).toBe(201);
    const { id } = await response.json();
    expect(serverDeps.store.getRevision(id)!.title).toBe('Shop, edited in this browser');
    expect(serverDeps.store.getRevision(id)!.privacy).toEqual({ classification: 'private', boundary: 'local-only' });
    expect((await restore(crypto.randomUUID(), owner, { model: edited() })).status).toBe(404);
  });
});

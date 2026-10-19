import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStore } from '@archwoven/jobs';
import { validFullModel, type EditOp, type SystemModel, type TaskUsage } from '@archwoven/model';
import { startTestRedis } from '../../../../../packages/jobs/src/redis-test-server';
import { serverDeps } from '../../lib/server';
import { POST as generate } from '../generate/route';
import { POST as refine } from './route';
import { GET as getJob } from '../jobs/[id]/route';
import { POST as cancelJob } from '../jobs/[id]/cancel/route';
import { GET as getResult } from '../jobs/[id]/result/route';
import { GET as getModel } from '../models/[id]/route';
import { GET as getQuota } from '../quota/route';
import { POST as editModel } from '../models/[id]/edit/route';
import { POST as undoModel } from '../models/[id]/undo/route';
import { hostedJobs } from '../../lib/hosted-runner';
import { NO_CHANGE_COPY, STALE_COPY } from './hosted';

const redis = await startTestRedis();
if (!redis && process.env.CI) throw new Error('CI must provide Redis for the hosted refinement tests.');
afterAll(async () => { await redis?.close(); });

const usage: TaskUsage = { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low', inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0, latencyMs: 10, repairs: 0, transportRetries: 0, usageComplete: true, attempts: [] };
const rename: EditOp = { op: 'update', target: 'gateway.api', patch: { label: 'Edge Gateway' }, baseRevision: 1, summary: 'Rename the gateway' };
const scheduled: (() => Promise<void>)[] = [];
const drain = async () => { while (scheduled.length) await scheduled.shift()!(); };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (cookie: string) => ({ headers: { cookie } });
const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
const post = (route: (r: Request) => Promise<Response>, url: string, body: unknown, cookie = '') => route(new Request(`http://localhost${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const stranger = async () => cookieOf(await getQuota(new Request('http://x')));

async function diagram(): Promise<{ owner: string; modelId: string }> {
  const started = await post(generate, '/api/generate', { prompt: 'A shop where customers order through an API backed by PostgreSQL.', view: 'architecture' });
  const owner = cookieOf(started), { jobId } = await started.json();
  await drain();
  return { owner, modelId: jobId };
}
const refineBody = (modelId: string, model: unknown = validFullModel, instruction = 'Rename the gateway to Edge Gateway') => ({ modelId, baseRevision: 1, instruction, view: 'architecture', model });

describe.skipIf(!redis)('hosted refinement jobs (real Redis)', () => {
  beforeEach(async () => {
    await redis!.flush();
    for (const [key, value] of Object.entries({ ARCHWOVEN_MODE: 'hosted', ARCHWOVEN_FAKE: '0', ANTHROPIC_API_KEY: 'test-key-not-real', UPSTASH_REDIS_REST_URL: redis!.url, UPSTASH_REDIS_REST_TOKEN: redis!.token, ARCHWOVEN_REDIS_PREFIX: 'archwoven-test:', ARCHWOVEN_SESSION_SECRET: 'test-session-secret-0123456789abcdef', VERCEL: '' })) vi.stubEnv(key, value);
    serverDeps.store = openStore(':memory:');
    serverDeps.schedule = task => { scheduled.push(task); };
    serverDeps.generateModel = async () => ({ ok: true as const, model: validFullModel, usage });
    serverDeps.generateRefinement = async () => ({ ok: true as const, ops: [rename], usage });
    scheduled.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('refines the diagram the browser holds and returns the result to its owner only', async () => {
    const { owner, modelId } = await diagram();
    const started = await post(refine, '/api/refine', refineBody(modelId), owner);
    expect(started.status).toBe(202);
    const { jobId, resumable } = await started.json();
    expect(resumable).toBe(true);
    await drain();
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'succeeded', modelId, revision: 2 });
    const result = await (await getResult(new Request('http://x', as(owner)), params(jobId))).json();
    expect(result.ops).toEqual([rename]);
    expect(result.model.nodes.find((n: { id: string }) => n.id === 'gateway.api').label).toBe('Edge Gateway');
    expect((await (await getModel(new Request('http://x', as(owner)), params(modelId))).json()).model.revision).toBe(2);
    expect(serverDeps.store.getRevision(modelId)!.revision).toBe(2);
    const other = await stranger();
    expect((await getResult(new Request('http://x', as(other)), params(jobId))).status).toBe(404);
    expect((await getJob(new Request('http://x', as(other)), params(jobId))).status).toBe(404);
  });

  it("treats the browser's diagram as untrusted, refusing invalid ones before any paid work", async () => {
    const { owner, modelId } = await diagram();
    const refineCall = vi.fn(); serverDeps.generateRefinement = refineCall;
    const dangling = { ...validFullModel, edges: [...validFullModel.edges, { ...validFullModel.edges[0]!, id: 'e.bad', to: 'missing' }] };
    for (const model of [{ title: 'not a model' }, { ...validFullModel, revision: 7 }, dangling]) {
      const response = await post(refine, '/api/refine', refineBody(modelId, model), owner);
      expect(response.status).toBe(400);
      expect((await response.json()).reason).toBe('invalid-model');
    }
    expect((await post(refine, '/api/refine', { ...refineBody(modelId), modelId: '../other' }, owner)).status).toBe(400);
    expect(scheduled).toHaveLength(0); expect(refineCall).not.toHaveBeenCalled();
  });

  it("refuses another visitor's diagram id before any paid work", async () => {
    const { modelId } = await diagram();
    const refineCall = vi.fn(); serverDeps.generateRefinement = refineCall;
    expect((await post(refine, '/api/refine', refineBody(modelId), await stranger())).status).toBe(404);
    expect(scheduled).toHaveLength(0); expect(refineCall).not.toHaveBeenCalled();
  });

  it('keeps an edit saved while inference ran, and discards the late result', async () => {
    const { owner, modelId } = await diagram();
    serverDeps.generateRefinement = async () => {
      const edited = structuredClone(validFullModel) as SystemModel; edited.revision = 2; edited.parentId = 1; edited.nodes[0]!.label = 'Edited meanwhile';
      serverDeps.store.saveRevision(modelId, edited, owner.split('=')[1]!.split('.')[0]!);
      return { ok: true as const, ops: [rename], usage };
    };
    const { jobId } = await (await post(refine, '/api/refine', refineBody(modelId), owner)).json();
    await drain();
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'failed', error: STALE_COPY });
    expect(serverDeps.store.getRevision(modelId)!.nodes[0]!.label).toBe('Edited meanwhile');
    expect((await (await getModel(new Request('http://x', as(owner)), params(modelId))).json()).model.revision).toBe(2);
    expect((await getResult(new Request('http://x', as(owner)), params(jobId))).status).toBe(404);
  });

  it('refines after a direct edit on a development server, whose local store holds the latest revision', async () => {
    const { owner, modelId } = await diagram();
    const edited = structuredClone(validFullModel) as SystemModel; edited.revision = 2; edited.parentId = 1; edited.nodes[0]!.label = 'Renamed directly';
    serverDeps.store.saveRevision(modelId, edited, owner.split('=')[1]!.split('.')[0]!);
    serverDeps.generateRefinement = async () => ({ ok: true as const, ops: [{ ...rename, baseRevision: 2 }], usage });
    const { jobId } = await (await post(refine, '/api/refine', { ...refineBody(modelId, edited), baseRevision: 2 }, owner)).json();
    await drain();
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'succeeded', revision: 3 });
    expect((await (await getModel(new Request('http://x', as(owner)), params(modelId))).json()).model.revision).toBe(3);
  });

  it('refuses a refinement of an outdated revision before any paid work, returning the latest diagram', async () => {
    const owner = await stranger(), modelId = crypto.randomUUID();
    const jobs = hostedJobs(); if (!jobs || jobs === 'misconfigured') throw new Error('hosted jobs unavailable');
    const latest = { ...structuredClone(validFullModel), revision: 3, parentId: 2 };
    await jobs.putModel(modelId, owner.split('=')[1]!.split('.')[0]!, latest, null);
    const refineCall = vi.fn(); serverDeps.generateRefinement = refineCall;
    const stale = await post(refine, '/api/refine', refineBody(modelId), owner);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ reason: 'stale-revision', revision: 3, model: { revision: 3 } });
    expect(scheduled).toHaveLength(0); expect(refineCall).not.toHaveBeenCalled();
  });

  it('still refines a diagram recorded before revisions were tracked', async () => {
    const owner = await stranger(), modelId = crypto.randomUUID();
    const jobs = hostedJobs(); if (!jobs || jobs === 'misconfigured') throw new Error('hosted jobs unavailable');
    await jobs.putOwned('model', modelId, owner.split('=')[1]!.split('.')[0]!, validFullModel);
    const { jobId } = await (await post(refine, '/api/refine', refineBody(modelId), owner)).json();
    await drain();
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'succeeded', revision: 2 });
  });

  it('refuses an oversized request before admitting it', async () => {
    const { owner, modelId } = await diagram();
    const big = structuredClone(validFullModel); big.title = 'word '.repeat(30_000);
    const response = await post(refine, '/api/refine', refineBody(modelId, big), owner);
    expect(response.status).toBe(413);
    expect(scheduled).toHaveLength(0);
  });

  it('reports an instruction that changes nothing, and a provider failure, without touching the diagram', async () => {
    const { owner, modelId } = await diagram();
    serverDeps.generateRefinement = async () => ({ ok: true as const, ops: [{ ...rename, patch: { label: 'API Gateway' } }], usage });
    const unchanged = (await (await post(refine, '/api/refine', refineBody(modelId, validFullModel, 'Keep the name'), owner)).json()).jobId;
    await drain();
    expect(await (await getJob(new Request('http://x', as(owner)), params(unchanged))).json()).toMatchObject({ status: 'failed', error: NO_CHANGE_COPY });
    serverDeps.generateRefinement = async () => ({ ok: false as const, errors: ['request failed: Connection error.'], usage: { ...usage, usageComplete: false } });
    const broken = (await (await post(refine, '/api/refine', refineBody(modelId, validFullModel, 'Add a cache'), owner)).json()).jobId;
    await drain();
    expect(await (await getJob(new Request('http://x', as(owner)), params(broken))).json()).toMatchObject({ status: 'failed' });
    expect(serverDeps.store.getRevision(modelId)!.revision).toBe(1);
  });

  it('starts one job for repeated submissions and refuses a second request while one runs', async () => {
    const { owner, modelId } = await diagram();
    const refineCall = vi.fn(async () => ({ ok: true as const, ops: [rename], usage })); serverDeps.generateRefinement = refineCall;
    const first = await (await post(refine, '/api/refine', refineBody(modelId), owner)).json();
    const repeated = await post(refine, '/api/refine', refineBody(modelId), owner);
    expect(repeated.status).toBe(202);
    expect((await repeated.json()).jobId).toBe(first.jobId);
    const other = await post(refine, '/api/refine', refineBody(modelId, validFullModel, 'Add a cache'), owner);
    expect(other.status).toBe(409);
    expect((await other.json()).message).toMatch(/already have a request running/);
    await drain();
    expect(refineCall).toHaveBeenCalledTimes(1);
  });

  it('cancels a running refinement, leaving the diagram unchanged', async () => {
    const { owner, modelId } = await diagram();
    let signal: AbortSignal | undefined;
    serverDeps.generateRefinement = (_i, _m, _v, opts) => new Promise(resolve => {
      signal = opts?.signal;
      opts?.signal?.addEventListener('abort', () => resolve({ ok: false as const, errors: ['Refinement cancelled.'], usage }));
    });
    const { jobId } = await (await post(refine, '/api/refine', refineBody(modelId), owner)).json();
    const running = scheduled.shift()!();
    while (!signal) await new Promise(r => setTimeout(r, 5));
    await cancelJob(new Request('http://x', { method: 'POST', ...as(owner) }), params(jobId));
    await running;
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'cancelled' });
    expect(serverDeps.store.getRevision(modelId)!.revision).toBe(1);
  }, 15_000);

  it('refines a diagram the server no longer holds (its 24-hour copy expired) from the browser copy', async () => {
    const owner = await stranger(), modelId = crypto.randomUUID();
    const started = await post(refine, '/api/refine', refineBody(modelId), owner);
    expect(started.status).toBe(202);
    const { jobId } = await started.json();
    await drain();
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'succeeded', modelId, revision: 2 });
    expect((await (await getModel(new Request('http://x', as(owner)), params(modelId))).json()).model.revision).toBe(2);
  });

  it('on Vercel, says that server-side edits and undo are not available yet instead of failing obscurely', async () => {
    vi.stubEnv('VERCEL', '1');
    for (const route of [editModel, undoModel]) {
      const response = await route(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), params(crypto.randomUUID()));
      expect(response.status).toBe(503);
      expect((await response.json()).error).toMatch(/not available in this deployment yet/);
    }
  });
});

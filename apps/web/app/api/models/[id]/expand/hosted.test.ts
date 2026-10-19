import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStore } from '@archwoven/jobs';
import { validFullModel, type SystemModel, type TaskUsage } from '@archwoven/model';
import { startTestRedis } from '../../../../../../../packages/jobs/src/redis-test-server';
import { serverDeps } from '../../../../lib/server';
import { POST as generate } from '../../../generate/route';
import { POST as expand } from './route';
import { GET as getJob } from '../../../jobs/[id]/route';
import { POST as cancelJob } from '../../../jobs/[id]/cancel/route';
import { GET as getResult } from '../../../jobs/[id]/result/route';
import { GET as getQuota } from '../../../quota/route';
import { STALE_COPY } from '../../../../lib/hosted-diagram-job';
import { hostedJobs } from '../../../../lib/hosted-runner';

const redis = await startTestRedis();
if (!redis && process.env.CI) throw new Error('CI must provide Redis for the hosted expansion tests.');
afterAll(async () => { await redis?.close(); });

const usage: TaskUsage = { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low', inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0, latencyMs: 10, repairs: 0, transportRetries: 0, usageComplete: true, attempts: [] };
const scheduled: (() => Promise<void>)[] = [];
const drain = async () => { while (scheduled.length) await scheduled.shift()!(); };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (cookie: string) => ({ headers: { cookie } });
const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
const sessionOf = (cookie: string) => cookie.split('=')[1]!.split('.')[0]!;
const json = (body: unknown, cookie = '') => ({ method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const expanded = (): SystemModel => { const m = structuredClone(validFullModel) as SystemModel; m.revision = 2; m.parentId = 1; m.nodes.push({ id: 'svc.orders.validator', kind: 'component', label: 'Order Validator', provenance: 'inferred', evidence: [] } as never); return m; };

async function diagram() {
  const started = await generate(new Request('http://localhost/api/generate', json({ prompt: 'A shop where customers order through an API backed by PostgreSQL.', view: 'architecture' })));
  const owner = cookieOf(started), { jobId } = await started.json();
  await drain();
  return { owner, modelId: jobId as string };
}
const expandReq = (modelId: string, cookie: string, body: Record<string, unknown> = {}) =>
  expand(new Request(`http://localhost/api/models/${modelId}/expand`, json({ baseRevision: 1, target: 'svc.orders', hint: 'validation first', model: validFullModel, ...body }, cookie)), params(modelId));

describe.skipIf(!redis)('hosted expansion jobs (real Redis)', () => {
  beforeEach(async () => {
    await redis!.flush();
    for (const [key, value] of Object.entries({ ARCHWOVEN_MODE: 'hosted', ARCHWOVEN_FAKE: '0', ANTHROPIC_API_KEY: 'test-key-not-real', UPSTASH_REDIS_REST_URL: redis!.url, UPSTASH_REDIS_REST_TOKEN: redis!.token, ARCHWOVEN_REDIS_PREFIX: 'archwoven-test:', ARCHWOVEN_SESSION_SECRET: 'test-session-secret-0123456789abcdef', VERCEL: '' })) vi.stubEnv(key, value);
    serverDeps.store = openStore(':memory:');
    serverDeps.schedule = task => { scheduled.push(task); };
    serverDeps.generateModel = async () => ({ ok: true as const, model: validFullModel, usage });
    serverDeps.expandComponent = async () => ({ ok: true as const, model: expanded(), usage });
    scheduled.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("expands the diagram the browser holds and returns the result to its owner only", async () => {
    const { owner, modelId } = await diagram();
    let seen: { target?: string; hint?: string } = {};
    serverDeps.expandComponent = async (_m, target, hint) => { seen = { target, hint }; return { ok: true as const, model: expanded(), usage }; };
    const started = await expandReq(modelId, owner);
    expect(started.status).toBe(202);
    const { jobId } = await started.json();
    await drain();
    expect(seen).toEqual({ target: 'svc.orders', hint: 'validation first' });
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'succeeded', modelId, revision: 2 });
    expect((await (await getResult(new Request('http://x', as(owner)), params(jobId))).json()).model.nodes.some((n: { label: string }) => n.label === 'Order Validator')).toBe(true);
    expect(serverDeps.store.getRevision(modelId)!.revision).toBe(2);
    expect((await (await getQuota(new Request('http://x', as(owner)))).json()).lastTask).toMatchObject({ action: 'expand', id: jobId });
    const stranger = cookieOf(await getQuota(new Request('http://x')));
    expect((await getResult(new Request('http://x', as(stranger)), params(jobId))).status).toBe(404);
  });

  it('refuses invalid input, another visitor, an outdated revision and a component that cannot expand, before any paid work', async () => {
    const { owner, modelId } = await diagram();
    const call = vi.fn(); serverDeps.expandComponent = call;
    expect((await expandReq(modelId, owner, { model: { title: 'nope' } })).status).toBe(400);
    expect((await expandReq(modelId, owner, { hint: 'x'.repeat(301) })).status).toBe(400);
    expect((await expandReq(modelId, owner, { extra: true })).status).toBe(400);
    expect((await expandReq(modelId, owner, { target: 'svc.missing' })).status).toBe(400);
    expect((await expandReq(modelId, cookieOf(await getQuota(new Request('http://x'))))).status).toBe(404);
    const newer = structuredClone(validFullModel) as SystemModel; newer.revision = 2; newer.parentId = 1; newer.nodes[0]!.label = 'Renamed';
    serverDeps.store.saveRevision(modelId, newer, sessionOf(owner));
    const stale = await expandReq(modelId, owner);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ reason: 'stale-revision', revision: 2 });
    expect(scheduled).toHaveLength(0); expect(call).not.toHaveBeenCalled();
  });

  it('keeps an edit saved while inference ran, and discards the late expansion', async () => {
    const { owner, modelId } = await diagram();
    serverDeps.expandComponent = async () => {
      const edited = structuredClone(validFullModel) as SystemModel; edited.revision = 2; edited.parentId = 1; edited.nodes[0]!.label = 'Edited meanwhile';
      serverDeps.store.saveRevision(modelId, edited, sessionOf(owner));
      return { ok: true as const, model: expanded(), usage };
    };
    const { jobId } = await (await expandReq(modelId, owner)).json();
    await drain();
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'failed', error: STALE_COPY });
    expect(serverDeps.store.getRevision(modelId)!.nodes[0]!.label).toBe('Edited meanwhile');
  });

  it('starts one job for repeated submissions and can be cancelled without changing the diagram', async () => {
    const { owner, modelId } = await diagram();
    let signal: AbortSignal | undefined;
    serverDeps.expandComponent = (_m, _t, _h, opts) => new Promise(resolve => {
      signal = opts?.signal;
      opts?.signal?.addEventListener('abort', () => resolve({ ok: false as const, errors: ['Expansion cancelled.'], usage }));
    });
    const { jobId } = await (await expandReq(modelId, owner)).json();
    expect((await (await expandReq(modelId, owner)).json()).jobId).toBe(jobId);
    const running = scheduled.shift()!();
    while (!signal) await new Promise(r => setTimeout(r, 5));
    await cancelJob(new Request('http://x', { method: 'POST', ...as(owner) }), params(jobId));
    await running;
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'cancelled' });
    expect(serverDeps.store.getRevision(modelId)!.revision).toBe(1);
  }, 15_000);

  it('keeps the diagram unchanged when the expansion is cancelled while its result returns', async () => {
    const { owner, modelId } = await diagram();
    let release!: () => void, started!: () => void;
    const analysing = new Promise<void>(r => { release = r; }), inFlight = new Promise<void>(r => { started = r; });
    serverDeps.expandComponent = async () => { started(); await analysing; return { ok: true as const, model: expanded(), usage }; };
    const { jobId } = await (await expandReq(modelId, owner)).json();
    const running = scheduled.shift()!();
    await inFlight;
    await cancelJob(new Request('http://x', { method: 'POST', ...as(owner) }), params(jobId));
    release();
    await running;
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'cancelled' });
    expect(serverDeps.store.getRevision(modelId)!.revision).toBe(1);
    expect((await getResult(new Request('http://x', as(owner)), params(jobId))).status).toBe(404);
  });

  it('where the server holds only its Redis copy, keeps a revision saved during inference', async () => {
    const owner = cookieOf(await getQuota(new Request('http://x'))), modelId = crypto.randomUUID();
    const jobs = hostedJobs(); if (!jobs || jobs === 'misconfigured') throw new Error('hosted jobs unavailable');
    await jobs.putModel(modelId, sessionOf(owner), validFullModel, null);
    serverDeps.expandComponent = async () => {
      const newer = structuredClone(validFullModel) as SystemModel; newer.revision = 2; newer.parentId = 1;
      await jobs.putModel(modelId, sessionOf(owner), newer, 1);
      return { ok: true as const, model: expanded(), usage };
    };
    const { jobId } = await (await expandReq(modelId, owner)).json();
    await drain();
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'failed', error: STALE_COPY });
  });

  it('answers malformed JSON with 400 and an oversized body with 413', async () => {
    const { owner, modelId } = await diagram();
    const malformed = await expand(new Request(`http://localhost/api/models/${modelId}/expand`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: owner }, body: '{' }), params(modelId));
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get('cache-control')).toContain('no-store');
  });

  it('refuses an oversized request body before reading a diagram from it', async () => {
    const { owner, modelId } = await diagram();
    const response = await expandReq(modelId, owner, { model: { ...validFullModel, title: 'x'.repeat(1_200_000) } });
    expect(response.status).toBe(413);
    expect(scheduled).toHaveLength(0);
  });
});

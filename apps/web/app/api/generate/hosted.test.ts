import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStore, EXPIRED_COPY } from '@archwoven/jobs';
import { validFullModel, type TaskUsage } from '@archwoven/model';
import { startTestRedis } from '../../../../../packages/jobs/src/redis-test-server';
import { serverDeps } from '../../lib/server';
import { hostedJobs, runHostedJob } from '../../lib/hosted-runner';
import { POST } from './route';
import { GET as getJob } from '../jobs/[id]/route';
import { POST as cancelJob } from '../jobs/[id]/cancel/route';
import { GET as getModel } from '../models/[id]/route';
import { GET as getQuota } from '../quota/route';

const redis = await startTestRedis();
if (!redis && process.env.CI) throw new Error('CI must provide Redis for the hosted job route tests.');
afterAll(async () => { await redis?.close(); });

const usage: TaskUsage = { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0, latencyMs: 10, repairs: 0, transportRetries: 0, usageComplete: true, attempts: [] };
const scheduled: (() => Promise<void>)[] = [];
const drain = async () => { while (scheduled.length) await scheduled.shift()!(); };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, cookie = '') => POST(new Request('http://localhost/api/generate', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const as = (cookie: string) => ({ headers: { cookie } });
const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
const prompt = { prompt: 'A shop where customers order through an API backed by PostgreSQL.', view: 'architecture' };

describe.skipIf(!redis)('hosted description jobs (real Redis)', () => {
  beforeEach(async () => {
    await redis!.flush(); redis!.setDown(false);
    for (const [key, value] of Object.entries({ ARCHWOVEN_MODE: 'hosted', ARCHWOVEN_FAKE: '0', ANTHROPIC_API_KEY: 'test-key-not-real', UPSTASH_REDIS_REST_URL: redis!.url, UPSTASH_REDIS_REST_TOKEN: redis!.token, ARCHWOVEN_REDIS_PREFIX: 'archwoven-test:', ARCHWOVEN_SESSION_SECRET: 'test-session-secret-0123456789abcdef', VERCEL: '' })) vi.stubEnv(key, value);
    serverDeps.store = openStore(':memory:');
    serverDeps.schedule = task => { scheduled.push(task); };
    serverDeps.generateModel = async () => ({ ok: true as const, model: validFullModel, usage });
    scheduled.length = 0;
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

  it('answers promptly with an owner-bound job, runs it after the response, and shows the result only to its owner', async () => {
    const started = await post({ ...prompt, idempotencyKey: 'k1' });
    expect(started.status).toBe(202);
    const owner = cookieOf(started), { jobId } = await started.json();
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'queued', usagePending: true });
    await drain();
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'succeeded', modelId: jobId, revision: validFullModel.revision, usagePending: false });
    expect((await (await getModel(new Request('http://x', as(owner)), params(jobId))).json()).model.title).toBe(validFullModel.title);
    expect((await (await getQuota(new Request('http://x', as(owner)))).json()).lastTask).toMatchObject({ id: jobId, action: 'generate', outcome: 'ok' });
    const stranger = cookieOf(await getQuota(new Request('http://x')));
    expect((await getJob(new Request('http://x', as(stranger)), params(jobId))).status).toBe(404);
    expect((await getModel(new Request('http://x', as(stranger)), params(jobId))).status).toBe(404);
    expect((await cancelJob(new Request('http://x', { method: 'POST', ...as(stranger) }), params(jobId))).status).toBe(404);
    // A forged, unsigned copy of the owner's id is a different visitor.
    expect((await getJob(new Request('http://x', as(owner.split('.')[0]!)), params(jobId))).status).toBe(404);
  });

  it('starts one job for repeated submissions and one active job per visitor', async () => {
    const generate = vi.fn(async () => ({ ok: true as const, model: validFullModel, usage }));
    serverDeps.generateModel = generate;
    const first = await post({ ...prompt, idempotencyKey: 'k1' }), owner = cookieOf(first), { jobId } = await first.json();
    const repeated = await post({ ...prompt, idempotencyKey: 'k1' }, owner);
    expect(repeated.status).toBe(202);
    expect((await repeated.json()).jobId).toBe(jobId);
    const busy = await post({ ...prompt, idempotencyKey: 'k2' }, owner);
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ reason: 'busy', jobId, message: expect.stringContaining('already have a diagram being generated') });
    await drain();
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await post({ ...prompt, idempotencyKey: 'k2' }, owner)).status).toBe(202);
  });

  it('starts a new job when a failed request is retried with the same input', async () => {
    serverDeps.generateModel = async () => ({ ok: false as const, errors: ['provider failed'], usage });
    const first = await post({ ...prompt, idempotencyKey: 'same' }), owner = cookieOf(first), { jobId } = await first.json();
    await drain();
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'failed', pollAfterMs: 1500 });
    serverDeps.generateModel = async () => ({ ok: true as const, model: validFullModel, usage });
    const retry = await post({ ...prompt, idempotencyKey: 'same' }, owner);
    expect(retry.status).toBe(202);
    const body = await retry.json();
    expect(body).toMatchObject({ resumable: true });
    expect(body.jobId).not.toBe(jobId);
  });

  it('limits active jobs per network, explaining it to visitors who drop their cookies', async () => {
    serverDeps.schedule = () => undefined; // jobs stay active
    const from = (address: string) => POST(new Request('http://localhost/api/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': address }, body: JSON.stringify(prompt) }));
    expect((await from('203.0.113.9')).status).toBe(202);
    expect((await from('203.0.113.9')).status).toBe(202);
    const third = await from('203.0.113.9');
    expect(third.status).toBe(429);
    expect((await third.json()).message).toMatch(/your network/);
    expect((await from('198.51.100.7')).status).toBe(202);
  });

  it('reads and cancels jobs only from hosted storage once it is configured', async () => {
    const owner = cookieOf(await getQuota(new Request('http://x')));
    const sessionId = owner.split('=')[1]!.split('.')[0]!;
    serverDeps.store.createJob({ id: 'repo-job-1', modelId: 'repo-job-1', kind: 'repo', sessionId });
    expect((await getJob(new Request('http://x', as(owner)), params('repo-job-1'))).status).toBe(404);
    expect((await cancelJob(new Request('http://x', { method: 'POST', ...as(owner) }), params('repo-job-1'))).status).toBe(404);
    expect(serverDeps.store.getJob('repo-job-1')!.status).toBe('queued');
  });

  it('lets only one of two competing instances run the paid work', async () => {
    const generate = vi.fn(async () => ({ ok: true as const, model: validFullModel, usage }));
    serverDeps.generateModel = generate;
    await post(prompt);
    const run = scheduled.shift()!;
    // A second instance trying to execute the same accepted job finds it already claimed.
    await Promise.all([run(), run()]);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('cancels a running job, aborting the provider call and saving nothing', async () => {
    let signal: AbortSignal | undefined;
    serverDeps.generateModel = (_p, _v, opts) => new Promise(resolve => {
      signal = opts?.signal;
      opts?.signal?.addEventListener('abort', () => resolve({ ok: false as const, errors: ['Generation cancelled.'], usage }));
    });
    const started = await post(prompt), owner = cookieOf(started), { jobId } = await started.json();
    const jobs = hostedJobs(); if (!jobs || jobs === 'misconfigured') throw new Error('hosted jobs unavailable');
    const running = runHostedJob(jobs, jobId, async s => { const out = await serverDeps.generateModel(prompt.prompt, 'architecture', { signal: s }); return out.ok ? { status: 'succeeded' } : { status: 'failed', error: out.errors.join('; ') }; }, undefined, { pollMs: 10, cancelPollMs: 10 });
    scheduled.length = 0;
    while (!signal) await new Promise(r => setTimeout(r, 5));
    expect((await (await cancelJob(new Request('http://x', { method: 'POST', ...as(owner) }), params(jobId))).json()).status).toBe('cancelled');
    await running;
    expect(signal.aborted).toBe(true);
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'cancelled', usagePending: false });
    expect((await getModel(new Request('http://x', as(owner)), params(jobId))).status).toBe(404);
  });

  it('saves nothing when the job is cancelled while the provider answer arrives', async () => {
    let release!: () => void, started!: () => void;
    const answering = new Promise<void>(r => { release = r; }), inFlight = new Promise<void>(r => { started = r; });
    serverDeps.generateModel = async () => { started(); await answering; return { ok: true as const, model: validFullModel, usage }; };
    const response = await post(prompt), owner = cookieOf(response), { jobId } = await response.json();
    const running = scheduled.shift()!();
    await inFlight;
    await cancelJob(new Request('http://x', { method: 'POST', ...as(owner) }), params(jobId));
    release();
    await running;
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'cancelled' });
    expect((await getModel(new Request('http://x', as(owner)), params(jobId))).status).toBe(404);
  });

  it('reports a job whose executor died as failed once its deadline passes, without running it again', async () => {
    const started = await post(prompt), owner = cookieOf(started), { jobId } = await started.json();
    scheduled.length = 0; // the accepting instance crashed before running anything
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 241_000);
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'failed', error: EXPIRED_COPY, usagePending: false });
    vi.useRealTimers();
    expect((await post({ ...prompt, idempotencyKey: 'retry' }, owner)).status).toBe(202);
  });

  it('refuses new work clearly when Redis is unreachable or not configured, and starts nothing', async () => {
    const generate = vi.fn(); serverDeps.generateModel = generate;
    redis!.setDown(true);
    const down = await post(prompt);
    expect(down.status).toBe(503);
    expect((await down.json()).message).toMatch(/temporarily unavailable\. You can still view and download/);
    redis!.setDown(false);
    vi.stubEnv('ARCHWOVEN_SESSION_SECRET', 'short');
    const misconfigured = await post(prompt);
    expect(misconfigured.status).toBe(503);
    expect((await misconfigured.json()).message).toMatch(/not configured/);
    expect(scheduled).toHaveLength(0); expect(generate).not.toHaveBeenCalled();
  });

  it('asks clarifying questions, continues once, and forgets the description afterwards', async () => {
    serverDeps.generateModel = async (_p, _v, opts) => opts?.allowClarification
      ? { ok: true as const, questions: ['Who writes posts?'], usage }
      : { ok: true as const, model: validFullModel, usage };
    const started = await post({ prompt: 'A blog.', view: 'architecture' }), owner = cookieOf(started), { jobId } = await started.json();
    await drain();
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ status: 'clarifying', questions: ['Who writes posts?'] });
    const continued = await post({ clarification: { jobId, skip: true } }, owner);
    expect(continued.status).toBe(202);
    const next = (await continued.json()).jobId;
    await drain();
    expect(await (await getJob(new Request('http://x', as(owner)), params(next))).json()).toMatchObject({ status: 'succeeded' });
    expect((await (await post({ clarification: { jobId, skip: true } }, owner)).json()).jobId).toBe(next);
    expect(await (await getJob(new Request('http://x', as(owner)), params(jobId))).json()).toMatchObject({ questions: [] });
  });
});

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStore } from '@archwoven/jobs';
import { validFullModel, type TaskUsage } from '@archwoven/model';
import type { Fragment } from '@archwoven/extract';
import { startTestRedis } from '../../../../../packages/jobs/src/redis-test-server';
import { serverDeps } from '../../lib/server';
import { POST as importRepo } from './route';
import { GET as getJob } from '../jobs/[id]/route';
import { POST as cancelJob } from '../jobs/[id]/cancel/route';
import { GET as getModel } from '../models/[id]/route';
import { GET as getQuota } from '../quota/route';
import { hostedJobs } from '../../lib/hosted-runner';

const redis = await startTestRedis();
if (!redis && process.env.CI) throw new Error('CI must provide Redis for the hosted repository tests.');
afterAll(async () => { await redis?.close(); });

const SHA = '0123456789abcdef0123456789abcdef01234567';
const KEY = ['sk_', 'live_'].join('') + 'Z9'.repeat(12);
const usage: TaskUsage = { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low', inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0, latencyMs: 10, repairs: 0, transportRetries: 0, usageComplete: true, attempts: [] };
const fragment = (): Fragment => ({
  nodes: [{ id: 'svc.api', kind: 'service', label: 'API', provenance: 'source-supported', evidence: [{ path: 'main.py', lines: [1, 2], repo: 'foo/bar', commit: SHA, note: `configures ${KEY}` }] }],
  edges: [], endpoints: [], gaps: [],
});
const okIngest = () => ({ ok: true as const, sha: SHA, framework: 'fastapi', fragment: fragment(), gaps: ['No database detected.'], filesScanned: 3 });
const scheduled: (() => Promise<void>)[] = [];
const drain = async () => { while (scheduled.length) await scheduled.shift()!(); };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (cookie: string) => ({ headers: { cookie } });
const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
const post = (body: unknown, cookie = '') => importRepo(new Request('http://localhost/api/repo', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const job = async (jobId: string, cookie: string) => (await getJob(new Request('http://x', as(cookie)), params(jobId))).json();

describe.skipIf(!redis)('hosted repository import jobs (real Redis)', () => {
  beforeEach(async () => {
    await redis!.flush();
    for (const [key, value] of Object.entries({ ARCHWOVEN_MODE: 'hosted', ARCHWOVEN_FAKE: '0', ANTHROPIC_API_KEY: 'test-key-not-real', UPSTASH_REDIS_REST_URL: redis!.url, UPSTASH_REDIS_REST_TOKEN: redis!.token, ARCHWOVEN_REDIS_PREFIX: 'archwoven-test:', ARCHWOVEN_SESSION_SECRET: 'test-session-secret-0123456789abcdef', VERCEL: '' })) vi.stubEnv(key, value);
    serverDeps.store = openStore(':memory:');
    serverDeps.schedule = task => { scheduled.push(task); };
    serverDeps.ingestRepo = async () => okIngest();
    serverDeps.assembleRepoModel = async () => ({ ok: true as const, model: validFullModel, usage });
    scheduled.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('imports a repository as a resumable job, shows its stages, and keeps the diagram for its owner only', async () => {
    const stages: string[] = [];
    let sent = '';
    serverDeps.ingestRepo = async (parsed, opts) => {
      expect(parsed).toEqual({ owner: 'foo', repo: 'bar', ref: 'main', subdir: 'api' });
      opts?.onStage?.('fetching');
      let seen = '';
      for (let i = 0; i < 50 && seen !== 'fetching'; i++) { await new Promise(r => setTimeout(r, 5)); seen = (await job(jobId, owner)).stage; }
      stages.push(seen);
      return okIngest();
    };
    serverDeps.assembleRepoModel = async (frag, meta) => {
      sent = JSON.stringify(frag);
      expect(meta).toEqual({ owner: 'foo', repo: 'bar', sha: SHA, framework: 'fastapi' });
      stages.push((await job(jobId, owner)).stage);
      return { ok: true as const, model: validFullModel, usage };
    };
    const started = await post({ url: 'https://github.com/foo/bar/tree/main/api', idempotencyKey: 'repo-1' });
    expect(started.status).toBe(202);
    const owner = cookieOf(started), body = await started.json(), jobId = body.jobId as string;
    expect(body).toEqual({ jobId, remaining: null, resumable: true });
    expect(started.headers.get('cache-control')).toContain('no-store');
    await drain();

    expect(stages).toEqual(['fetching', 'designing']);
    expect(sent).not.toContain(KEY);
    expect(sent).toContain('[REDACTED:Stripe key]');
    expect(await job(jobId, owner)).toMatchObject({ status: 'succeeded', modelId: jobId, revision: 1 });
    const saved = await (await getModel(new Request('http://x', as(owner)), params(jobId))).json();
    expect(saved.model.openQuestions.map((q: { text: string }) => q.text)).toEqual(expect.arrayContaining([
      'No database detected.',
      'Masked 1 likely secret (1 Stripe key) before analysis; their values were never sent to the AI provider.',
    ]));
    expect(saved.model.privacy).toEqual({ classification: 'public', boundary: 'external-allowed' });
    // Redis holds the diagram for the hosted deployment; a development server also keeps it locally for editing.
    const jobs = hostedJobs(); if (!jobs || jobs === 'misconfigured') throw new Error('hosted jobs unavailable');
    expect((await jobs.modelState(jobId, owner.split('=')[1]!.split('.')[0]!)).model).toMatchObject({ revision: 1 });
    expect(serverDeps.store.getRevision(jobId)!.revision).toBe(1);
    expect((await (await getQuota(new Request('http://x', as(owner)))).json()).lastTask).toMatchObject({ action: 'repo', id: jobId });

    const stranger = cookieOf(await getQuota(new Request('http://x')));
    expect((await getJob(new Request('http://x', as(stranger)), params(jobId))).status).toBe(404);
    expect((await getModel(new Request('http://x', as(stranger)), params(jobId))).status).toBe(404);
  });

  it('refuses a malformed request before admitting any work', async () => {
    const ingest = vi.fn(); serverDeps.ingestRepo = ingest;
    expect((await post({ url: 'https://evil.example/foo/bar' })).status).toBe(400);
    expect((await post({ localPath: '/home/user/private' })).status).toBe(400);
    expect((await post({ url: 'https://github.com/foo/bar', subdir: '../etc' })).status).toBe(400);
    expect((await post({ url: 'https://github.com/foo/bar', ref: 'x'.repeat(300) })).status).toBe(400);
    expect((await post({ url: 'https://github.com/foo/bar', ref: 'main..evil' })).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect((await post({ url: 'https://github.com/foo/bar', padding: 'x'.repeat(70_000) })).status).toBe(413);
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect((await post({ url: 'https://github.com/foo/bar' })).status).toBe(503);
    expect(scheduled).toHaveLength(0); expect(ingest).not.toHaveBeenCalled();
  });

  it('accepts branch names that git allows, such as ones with + or @', async () => {
    let seen: string | undefined;
    serverDeps.ingestRepo = async parsed => { seen = parsed.ref; return okIngest(); };
    const response = await post({ url: 'https://github.com/foo/bar', ref: 'release/v1+build@2' });
    expect(response.status).toBe(202);
    await drain();
    expect(seen).toBe('release/v1+build@2');
  });

  it('starts one job for repeated submissions and refuses a second import while one runs', async () => {
    const first = await post({ url: 'https://github.com/foo/bar', idempotencyKey: 'same' });
    const owner = cookieOf(first), { jobId } = await first.json();
    expect((await (await post({ url: 'https://github.com/foo/bar', idempotencyKey: 'same' }, owner)).json()).jobId).toBe(jobId);
    const other = await post({ url: 'https://github.com/foo/other', idempotencyKey: 'different' }, owner);
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ reason: 'busy', jobId });
    expect(scheduled).toHaveLength(1);
  });

  it('cancels an import while fetching, without analysis or a saved diagram', async () => {
    let signal: AbortSignal | undefined;
    const assemble = vi.fn(); serverDeps.assembleRepoModel = assemble;
    serverDeps.ingestRepo = (_p, opts) => new Promise(resolve => {
      signal = opts?.signal;
      opts?.signal?.addEventListener('abort', () => resolve({ ok: false as const, reason: 'cancelled', message: 'Import cancelled.' } as never));
    });
    const started = await post({ url: 'https://github.com/foo/bar' });
    const owner = cookieOf(started), { jobId } = await started.json();
    const running = scheduled.shift()!();
    while (!signal) await new Promise(r => setTimeout(r, 5));
    await cancelJob(new Request('http://x', { method: 'POST', ...as(owner) }), params(jobId));
    await running;
    expect(await job(jobId, owner)).toMatchObject({ status: 'cancelled', usagePending: false });
    expect(assemble).not.toHaveBeenCalled();
    expect((await getModel(new Request('http://x', as(owner)), params(jobId))).status).toBe(404);
  }, 15_000);

  it('saves nothing when the import is cancelled while its analysis returns', async () => {
    let release!: () => void;
    const analysing = new Promise<void>(r => { release = r; });
    let started!: () => void;
    const inFlight = new Promise<void>(r => { started = r; });
    serverDeps.assembleRepoModel = async () => { started(); await analysing; return { ok: true as const, model: validFullModel, usage }; };
    const response = await post({ url: 'https://github.com/foo/bar' });
    const owner = cookieOf(response), { jobId } = await response.json();
    const running = scheduled.shift()!();
    await inFlight;
    // The provider answers right after the cancel, before the executor's next cancellation check.
    await cancelJob(new Request('http://x', { method: 'POST', ...as(owner) }), params(jobId));
    release();
    await running;
    expect(await job(jobId, owner)).toMatchObject({ status: 'cancelled' });
    expect((await getModel(new Request('http://x', as(owner)), params(jobId))).status).toBe(404);
    expect(serverDeps.store.getRevision(jobId)).toBeNull();
  });

  it('reports a repository that cannot be fetched without calling the AI provider', async () => {
    const assemble = vi.fn(); serverDeps.assembleRepoModel = assemble;
    serverDeps.ingestRepo = async () => ({ ok: false as const, reason: 'not-found', message: 'Repository not found or private.' } as never);
    const started = await post({ url: 'https://github.com/foo/bar' });
    const owner = cookieOf(started), { jobId } = await started.json();
    await drain();
    expect(await job(jobId, owner)).toMatchObject({ status: 'failed', error: 'Repository not found or private.' });
    expect(assemble).not.toHaveBeenCalled();
  });

  it('stops before analysis when secret scanning fails', async () => {
    const assemble = vi.fn(); serverDeps.assembleRepoModel = assemble;
    serverDeps.ingestRepo = async () => ({ ...okIngest(), fragment: { get nodes(): never { throw new Error('scanner unavailable'); } } as never });
    const started = await post({ url: 'https://github.com/foo/bar' });
    const owner = cookieOf(started), { jobId } = await started.json();
    await drain();
    expect((await job(jobId, owner)).status).toBe('failed');
    expect(assemble).not.toHaveBeenCalled();
  });

  it('refuses work without admitting anything when Redis is unreachable', async () => {
    redis!.setDown(true);
    try {
      const response = await post({ url: 'https://github.com/foo/bar' });
      expect(response.status).toBe(503);
      expect(scheduled).toHaveLength(0);
    } finally { redis!.setDown(false); }
  });
});

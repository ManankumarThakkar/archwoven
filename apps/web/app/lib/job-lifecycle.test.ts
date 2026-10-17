import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStore } from '@archwoven/jobs';
import { validFullModel } from '@archwoven/model';
import { serverDeps } from './server';
import { repoJobRegistry } from './repo-registry';
import { resetSlots } from './llm-limiter';
import { POST as GENERATE } from '../api/generate/route';
import { POST as REPO } from '../api/repo/route';
import { POST as CANCEL } from '../api/jobs/[id]/cancel/route';
import { GET } from '../api/jobs/[id]/route';

const usage = { provider: 'anthropic' as const, transportRetries: 0, usageComplete: true, attempts: [], model: 'claude-opus-5-5', effort: 'medium' as const, inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0, latencyMs: 1, repairs: 0 };
const success = () => ({ ok: true as const, model: structuredClone(validFullModel), usage });
const day = () => new Date().toISOString().slice(0, 10);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const req = (path: string, body?: object) => new Request(`http://localhost/api/${path}`, { method: body ? 'POST' : 'GET', headers: { cookie: 'aw_sid=lifecycle', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = async (kind: 'generate' | 'repo') => {
  const response = kind === 'generate' ? await GENERATE(req('generate', { prompt: 'shop', view: 'architecture' })) : await REPO(req('repo', { url: 'https://github.com/example/app' }));
  expect(response.status).toBe(202);
  return (await response.json()).jobId as string;
};
beforeEach(() => {
  serverDeps.store = openStore(':memory:'); repoJobRegistry.clear(); resetSlots(2);
  serverDeps.generateModel = async () => success();
  serverDeps.ingestRepo = async () => ({ ok: true, sha: 'abc', framework: 'generic', fragment: { nodes: [], edges: [], endpoints: [], gaps: [] }, gaps: [], filesScanned: 1 });
  serverDeps.assembleRepoModel = async () => success();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('bounded cancellable generation jobs', () => {
  it.each(['generate', 'repo'] as const)('%s persistence failures settle and refund instead of leaving running jobs', async (kind) => {
    for (const method of ['saveRevision', 'logCall'] as const) {
      vi.spyOn(serverDeps.store, method).mockImplementationOnce(() => { throw new Error(`${method} unavailable`); });
      const id = await post(kind);
      await delay(5);
      expect(serverDeps.store.getJob(id)?.status).toBe('failed');
      expect(serverDeps.store.getJob(id)?.error).toContain(`${method} unavailable`);
      expect(serverDeps.store.creditsUsed('lifecycle', day())).toBe(0);
      expect(repoJobRegistry.has(id)).toBe(false);
      expect(serverDeps.store.listCalls('lifecycle')).toHaveLength(method === 'saveRevision' ? 1 : 2);
      expect(serverDeps.store.lastTask('lifecycle')).toMatchObject({ id, outcome: 'failed', inputTokens: 10 });
      vi.restoreAllMocks();
    }
  });
  it('description cancellation aborts its controller, refunds once and rejects a late successful model', async () => {
    let release!: () => void; let signal: AbortSignal | undefined;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    serverDeps.generateModel = async (_prompt, _view, opts) => { signal = opts?.signal; await waiting; return success(); };
    const id = await post('generate');
    try {
      expect((await CANCEL(req(`jobs/${id}/cancel`, {}), ctx(id))).status).toBe(200);
      expect(signal?.aborted).toBe(true);
      expect((await (await GET(req(`jobs/${id}`), ctx(id))).json()).usagePending).toBe(true);
      expect(serverDeps.store.getJob(id)?.status).toBe('cancelled');
      expect(serverDeps.store.creditsUsed('lifecycle', day())).toBe(0);
    } finally { release(); await delay(5); }
    expect(serverDeps.store.getRevision(id)).toBeNull();
    expect(serverDeps.store.getJob(id)?.status).toBe('cancelled');
    await CANCEL(req(`jobs/${id}/cancel`, {}), ctx(id));
    expect(serverDeps.store.creditsUsed('lifecycle', day())).toBe(0);
    expect(serverDeps.store.listCalls('lifecycle')).toHaveLength(1);
    expect((await (await GET(req(`jobs/${id}`), ctx(id))).json()).usagePending).toBe(false);
  });

  it.each(['generate', 'repo'] as const)('%s timeout fails/refunds once and a noncooperative late result cannot save a model', async (kind) => {
    vi.stubEnv('ARCHWOVEN_JOB_TIMEOUT_MS', '15');
    serverDeps.generateModel = async () => { await delay(60); return success(); };
    serverDeps.assembleRepoModel = async () => { await delay(60); return success(); };
    const id = await post(kind);
    await delay(25);
    try {
      expect(serverDeps.store.getJob(id)?.status).toBe('failed');
      expect(serverDeps.store.getJob(id)?.error).toMatch(/timed out/i);
      expect(serverDeps.store.creditsUsed('lifecycle', day())).toBe(0);
    } finally { await delay(60); }
    expect(serverDeps.store.getRevision(id)).toBeNull();
    expect(serverDeps.store.getJob(id)?.status).toBe('failed');
    expect(serverDeps.store.listCalls('lifecycle')).toHaveLength(1);
  });

  it('polling exposes a running deadline but queued jobs do not spend their execution budget', async () => {
    resetSlots(1); let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    serverDeps.generateModel = async () => { await waiting; return success(); };
    const running = await post('generate');
    const queued = await post('generate');
    try {
      const active = await (await GET(req(`jobs/${running}`), ctx(running))).json();
      const pending = await (await GET(req(`jobs/${queued}`), ctx(queued))).json();
      expect(active.deadlineAt).toBeGreaterThan(Date.now());
      expect(pending.deadlineAt).toBeNull();
      expect(pending.status).toBe('queued');
    } finally { release(); await delay(10); }
  });

  it('cancels a queued description without ever invoking its provider work', async () => {
    resetSlots(1); let release!: () => void; let requests = 0;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    serverDeps.generateModel = async () => { requests++; await waiting; return success(); };
    await post('generate'); const queued = await post('generate');
    try {
      expect((await CANCEL(req(`jobs/${queued}/cancel`, {}), ctx(queued))).status).toBe(200);
    } finally { release(); await delay(10); }
    expect(requests).toBe(1);
    expect(serverDeps.store.getJob(queued)?.status).toBe('cancelled');
    expect(serverDeps.store.getRevision(queued)).toBeNull();
  });
});


it('cancelled clarification work cannot resurrect questions or double-refund',async()=>{
  let release!:()=>void;const waiting=new Promise<void>(r=>{release=r;});
  serverDeps.generateModel=async()=>{await waiting;return {ok:true as const,questions:['Persist orders?'],usage};};
  const id=await post('generate');
  try{await CANCEL(req(`jobs/${id}/cancel`,{}),ctx(id));}finally{release();await delay(5);}
  const job=serverDeps.store.getJob(id)!;
  expect(job.status).toBe('cancelled');expect(job.clarification).toBeUndefined();expect(repoJobRegistry.has(id)).toBe(false);
  expect(serverDeps.store.getRevision(id)).toBeNull();expect(serverDeps.store.creditsUsed('lifecycle',day())).toBe(0);
  expect(serverDeps.store.listCalls('lifecycle')).toHaveLength(1);
});

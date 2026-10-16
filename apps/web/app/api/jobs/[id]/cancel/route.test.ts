import { beforeEach, describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import { serverDeps } from '../../../../lib/server';
import { resetSlots } from '../../../../lib/llm-limiter';
import { repoJobRegistry } from '../../../../lib/repo-registry';
import { POST } from './route';

const usage = { model: 'claude-opus-5-5', effort: 'medium' as const, inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5, latencyMs: 10, repairs: 0 };
const day = () => new Date().toISOString().slice(0, 10);

const cancelReq = (id: string, cookie = 'aw_sid=test-sess') =>
  new Request(`http://localhost/api/jobs/${id}/cancel`, { method: 'POST', headers: { cookie } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  serverDeps.store = openStore(':memory:');
  serverDeps.generateModel = async () => ({ ok: true as const, model: validFullModel, usage });
  repoJobRegistry.clear();
  resetSlots(2);
});

describe('POST /api/jobs/:id/cancel', () => {
  it('unknown job → 404', async () => {
    expect((await POST(cancelReq('nope'), ctx('nope'))).status).toBe(404);
  });

  it('cancelling a queued repo job marks it cancelled, refunds weight 2, aborts the controller', async () => {
    serverDeps.store.createJob({ id: 'j1', modelId: 'j1', kind: 'repo', sessionId: 'test-sess' });
    serverDeps.store.addCreditsUsed('test-sess', day(), 2); // simulate accepted reservation
    const controller = new AbortController();
    repoJobRegistry.set('j1', { controller, settled: false });
    let aborted = false;
    controller.signal.addEventListener('abort', () => { aborted = true; });

    const res = await POST(cancelReq('j1'), ctx('j1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'cancelled' });
    expect(serverDeps.store.getJob('j1')!.status).toBe('cancelled');
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(0);
    expect(aborted).toBe(true);
  });

  it('second cancel is idempotent — no double refund', async () => {
    serverDeps.store.createJob({ id: 'j2', modelId: 'j2', kind: 'repo', sessionId: 'test-sess' });
    serverDeps.store.addCreditsUsed('test-sess', day(), 2);
    repoJobRegistry.set('j2', { controller: new AbortController(), settled: false });
    await POST(cancelReq('j2'), ctx('j2'));
    const again = await POST(cancelReq('j2'), ctx('j2'));
    expect(again.status).toBe(200);
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(0);
  });

  it('other session gets 404, job stays untouched', async () => {
    serverDeps.store.createJob({ id: 'j3', modelId: 'j3', kind: 'repo', sessionId: 'test-sess' });
    serverDeps.store.addCreditsUsed('test-sess', day(), 2);
    repoJobRegistry.set('j3', { controller: new AbortController(), settled: false });
    const res = await POST(cancelReq('j3', 'aw_sid=mallory'), ctx('j3'));
    expect(res.status).toBe(404);
    expect(serverDeps.store.getJob('j3')!.status).toBe('queued');
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(2);
  });

  it('unregistered legacy work is not cancellable — 409, no unsafe refund (C1)', async () => {
    // No registered controller/settlement boundary: refund-then-complete would grant free work.
    serverDeps.store.createJob({ id: 'g1', modelId: 'g1', kind: 'generate', sessionId: 'test-sess' });
    serverDeps.store.addCreditsUsed('test-sess', day(), 1);
    const res = await POST(cancelReq('g1'), ctx('g1'));
    expect(res.status).toBe(409);
    expect(serverDeps.store.getJob('g1')!.status).toBe('queued');
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(1);
  });

  it('terminal repo job → 200 with its terminal status, no refund', async () => {
    serverDeps.store.createJob({ id: 'j4', modelId: 'j4', kind: 'repo', sessionId: 'test-sess' });
    serverDeps.store.addCreditsUsed('test-sess', day(), 2);
    serverDeps.store.updateJob('j4', { status: 'succeeded' });
    const res = await POST(cancelReq('j4'), ctx('j4'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'succeeded' });
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(2);
  });
});

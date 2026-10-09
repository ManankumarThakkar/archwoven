import { beforeEach, describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import { serverDeps } from '../../../../lib/server';
import { resetSlots } from '../../../../lib/llm-limiter';
import { POST } from './route';

const usage = { model: 'claude-opus-5-5', effort: 'medium' as const, inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5, latencyMs: 10, repairs: 0 };
const day = () => new Date().toISOString().slice(0, 10);

const cancelReq = (id: string, cookie = 'aw_sid=test-sess') =>
  new Request(`http://localhost/api/jobs/${id}/cancel`, { method: 'POST', headers: { cookie } });

beforeEach(() => {
  serverDeps.store = openStore(':memory:');
  serverDeps.generateModel = async () => ({ ok: true as const, model: validFullModel, usage });
  resetSlots(2);
});

describe('POST /api/jobs/:id/cancel', () => {
  it('unknown job → 404', async () => {
    const res = await POST(cancelReq('nope'), { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });

  it('cancelling a queued job marks it cancelled and refunds its reservation', async () => {
    serverDeps.store.createJob({ id: 'j1', modelId: 'j1', kind: 'generate', sessionId: 'test-sess' });
    serverDeps.store.addCreditsUsed('test-sess', day(), 1); // simulate accepted reservation
    const res = await POST(cancelReq('j1'), { params: Promise.resolve({ id: 'j1' }) });
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ status: 'cancelled' });
    expect(serverDeps.store.getJob('j1')!.status).toBe('cancelled');
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(0);
  });

  it('second cancel is idempotent — no double refund', async () => {
    serverDeps.store.createJob({ id: 'j2', modelId: 'j2', kind: 'generate', sessionId: 'test-sess' });
    serverDeps.store.addCreditsUsed('test-sess', day(), 1);
    await POST(cancelReq('j2'), { params: Promise.resolve({ id: 'j2' }) });
    const again = await POST(cancelReq('j2'), { params: Promise.resolve({ id: 'j2' }) });
    expect(again.status).toBe(200);
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(0);
  });

  it('other session gets 404, job stays untouched', async () => {
    serverDeps.store.createJob({ id: 'j3', modelId: 'j3', kind: 'generate', sessionId: 'test-sess' });
    serverDeps.store.addCreditsUsed('test-sess', day(), 1);
    const res = await POST(cancelReq('j3', 'aw_sid=mallory'), { params: Promise.resolve({ id: 'j3' }) });
    expect(res.status).toBe(404);
    expect(serverDeps.store.getJob('j3')!.status).toBe('queued');
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(1);
  });
});


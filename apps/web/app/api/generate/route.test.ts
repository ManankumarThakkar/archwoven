import { beforeEach, describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import { serverDeps } from '../../lib/server';
import { GET } from '../jobs/[id]/route';
import { POST } from './route';

const usage = { model: 'claude-opus-5-5', effort: 'medium' as const, inputTokens: 1000, cacheWriteTokens: 5000, cacheReadTokens: 10000, outputTokens: 1500, latencyMs: 500, repairs: 0 };

const req = (body: unknown, cookie = 'aw_sid=test-sess') =>
  new Request('http://localhost/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });

async function waitJob(id: string) {
  for (let i = 0; i < 100; i++) {
    const job = serverDeps.store.getJob(id);
    if (job && job.status !== 'queued' && job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`job ${id} never settled`);
}

beforeEach(() => {
  serverDeps.store = openStore(':memory:');
  serverDeps.generateModel = async () => ({ ok: true as const, model: validFullModel, usage });
});

describe('POST /api/generate', () => {
  it('happy path: 202 jobId → job reaches done, revision saved, 1 credit spent', async () => {
    const res = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'k1' }));
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    const job = await waitJob(jobId);
    expect(job.status).toBe('succeeded');
    expect(serverDeps.store.getRevision(jobId)).not.toBeNull();
    expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBe(1);
  });

  it('duplicate idempotencyKey returns the same job and charges once', async () => {
    const a = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'dup' }));
    const { jobId: id1 } = (await a.json()) as { jobId: string };
    await waitJob(id1);
    const b = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'dup' }));
    const { jobId: id2 } = (await b.json()) as { jobId: string };
    expect(id2).toBe(id1);
    expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBe(1);
  });

  it('credits exhausted → 429 with friendly reset copy', async () => {
    process.env.ARCHWOVEN_BURST_WINDOW_SEC = '0.05'; // isolate the daily-credit gate from the 5/min burst gate
    try {
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 60));
        const res = await POST(req({ prompt: `p${i}`, view: 'architecture', idempotencyKey: `k${i}` }));
        expect(res.status, `gen ${i + 1}`).toBe(202);
        const { jobId } = (await res.json()) as { jobId: string };
        await waitJob(jobId);
      }
      await new Promise((r) => setTimeout(r, 60));
      const res = await POST(req({ prompt: 'one too many', view: 'architecture', idempotencyKey: 'k99' }));
      expect(res.status).toBe(429);
      const body = (await res.json()) as { reason: string; message: string; resetAt: number };
      expect(body.reason).toBe('credits-exhausted');
      expect(body.message).toMatch(/resets in \d+h \d+m/);
      expect(body.message).toMatch(/GitHub/);
    } finally {
      delete process.env.ARCHWOVEN_BURST_WINDOW_SEC;
    }
  });

  it('oversized prompt → 413 scope-down copy, no model call', async () => {
    let called = false;
    serverDeps.generateModel = async () => {
      called = true;
      return { ok: true as const, model: validFullModel, usage };
    };
    const res = await POST(req({ prompt: 'x'.repeat(100_001), view: 'architecture', idempotencyKey: 'big' }));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { message: string }).message).toMatch(/one system or flow/);
    expect(called).toBe(false);
  });

  it('provider failure → job.failed, credits NOT spent, prompt preserved in error', async () => {
    serverDeps.generateModel = async () => ({ ok: false as const, errors: ['provider exploded'], usage });
    const res = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'fail' }));
    const { jobId } = (await res.json()) as { jobId: string };
    const job = await waitJob(jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toContain('provider exploded');
    expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBe(0);
  });

  it('mints the session cookie when absent', async () => {
    const res = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'fresh' }, ''));
    expect(res.headers.get('set-cookie')).toMatch(/aw_sid=/);
  });
});

describe('GET /api/jobs/:id', () => {
  it('returns stage for polling', async () => {
    const res = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'poll' }));
    const { jobId } = (await res.json()) as { jobId: string };
    await waitJob(jobId);
    const jobRes = await GET(new Request(`http://localhost/api/jobs/${jobId}`), { params: Promise.resolve({ id: jobId }) });
    const body = (await jobRes.json()) as { status: string; modelId: string; revision: number };
    expect(body.status).toBe('succeeded');
    expect(body.modelId).toBe(jobId);
    expect(body.revision).toBe(validFullModel.revision);
  });
});

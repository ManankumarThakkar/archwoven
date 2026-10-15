import { beforeEach, describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import { NOT_FOUND_OR_PRIVATE_COPY } from '@archwoven/ingest';
import type { Fragment } from '@archwoven/extract';
import { serverDeps } from '../../lib/server';
import { resetSlots } from '../../lib/llm-limiter';
import { POST } from './route';
import { POST as CANCEL } from '../jobs/[id]/cancel/route';
import { GET } from '../jobs/[id]/route';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const usage = { model: 'claude-opus-5-5', effort: 'medium' as const, inputTokens: 1000, cacheWriteTokens: 5000, cacheReadTokens: 10000, outputTokens: 1500, latencyMs: 500, repairs: 0 };

// §15: quotas compile out in local mode (reserve → Infinity → JSON null); credit assertions are hosted-only.
const QUOTA = process.env.ARCHWOVEN_MODE !== 'local';
const hostedOnly = QUOTA ? it : it.skip;

const frag: Fragment = {
  nodes: [{ id: 'svc.api', kind: 'service', label: 'API', provenance: 'source-supported', evidence: [{ path: 'main.py', lines: [1, 2], repo: 'foo/bar', commit: SHA }] }],
  edges: [], endpoints: [], gaps: ['no database detected'],
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};

const req = (body: unknown, cookie = 'aw_sid=test-sess') =>
  new Request('http://localhost/api/repo', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });

const cancelReq = (id: string, cookie = 'aw_sid=test-sess') =>
  new Request(`http://localhost/api/jobs/${id}/cancel`, { method: 'POST', headers: { cookie } });

const getReq = (id: string, cookie = 'aw_sid=test-sess') =>
  new Request(`http://localhost/api/jobs/${id}`, { headers: { cookie } });

const okIngest = { ok: true as const, sha: SHA, framework: 'fastapi', fragment: frag, gaps: [], filesScanned: 42 };

async function waitJob(id: string, until?: (s: string) => boolean) {
  for (let i = 0; i < 200; i++) {
    const job = serverDeps.store.getJob(id);
    if (job && (until ? until(job.status) : job.status !== 'queued' && job.status !== 'running')) return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`job ${id} never settled`);
}

const day = () => new Date().toISOString().slice(0, 10);

beforeEach(() => {
  serverDeps.store = openStore(':memory:');
  serverDeps.ingestRepo = async () => okIngest;
  serverDeps.ingestLocal = async () => okIngest;
  // mirrors the real assembleRepoModel's server-side evidence pinning
  serverDeps.assembleRepoModel = async () => {
    const m = structuredClone(validFullModel);
    for (const x of [...m.nodes, ...m.edges]) for (const ev of x.evidence) { ev.commit = SHA; ev.repo = 'foo/bar'; }
    return { ok: true as const, model: m, usage };
  };
  resetSlots(2);
});

describe('POST /api/repo', () => {
  it('happy path: 202 → succeeded, revision saved with pinned sha, 2 credits spent at accept', async () => {
    const res = await POST(req({ url: 'https://github.com/foo/bar', idempotencyKey: 'k1' }));
    expect(res.status).toBe(202);
    const { jobId, remaining } = (await res.json()) as { jobId: string; remaining: number };
    expect(remaining).toBe(QUOTA ? 4 : null); // pool 6 − weight 2, charged at accept (hosted)
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(QUOTA ? 2 : 0);
    const job = await waitJob(jobId);
    expect(job.status).toBe('succeeded');
    const rev = serverDeps.store.getRevision(jobId) as { nodes: { evidence: { commit?: string }[] }[] };
    expect(rev.nodes.flatMap((n) => n.evidence).every((e) => e.commit === SHA)).toBe(true);
  });

  hostedOnly('quota: 4th repo of the day blocked at pool 6 / weight 2 with §15 copy', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await POST(req({ url: 'https://github.com/foo/bar' }));
      expect(r.status).toBe(202);
      const { jobId } = (await r.json()) as { jobId: string };
      await waitJob(jobId);
    }
    const blocked = await POST(req({ url: 'https://github.com/foo/bar' }));
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { reason: string; message: string };
    expect(body.reason).toBe('credits-exhausted');
    expect(body.message).toMatch(/resets in/i);
  });

  it('SSRF-shaped URL → 400 before any quota reservation', async () => {
    const res = await POST(req({ url: 'http://169.254.169.254/latest/meta-data' }));
    expect(res.status).toBe(400);
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(0);
  });

  it('traversal-shaped URL → 400 before quota', async () => {
    const res = await POST(req({ url: 'https://github.com/foo/bar/tree/main/../../etc' }));
    expect(res.status).toBe(400);
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(0);
  });

  it('ingest not-found-or-private → job failed with the non-inferring copy, credits refunded', async () => {
    serverDeps.ingestRepo = async () => ({ ok: false as const, reason: 'not-found-or-private', message: NOT_FOUND_OR_PRIVATE_COPY });
    const res = await POST(req({ url: 'https://github.com/foo/gone' }));
    const { jobId } = (await res.json()) as { jobId: string };
    const job = await waitJob(jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toBe(NOT_FOUND_OR_PRIVATE_COPY);
    expect(job.error).not.toMatch(/does not exist/i);
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(0);
  });

  it('assemble failure with tokens spent → failed, refunded, call still metered', async () => {
    serverDeps.assembleRepoModel = async () => ({ ok: false as const, errors: ['schema drift'], usage });
    const res = await POST(req({ url: 'https://github.com/foo/bar' }));
    const { jobId } = (await res.json()) as { jobId: string };
    const job = await waitJob(jobId);
    expect(job.status).toBe('failed');
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(0);
    const calls = serverDeps.store.listCalls('test-sess');
    expect(calls.length).toBe(1);
    expect(calls[0]!.outcome).toBe('failed');
    expect(calls[0]!.outputTokens).toBe(usage.outputTokens);
  });

  it('duplicate idempotencyKey returns the same job and charges once', async () => {
    const a = await POST(req({ url: 'https://github.com/foo/bar', idempotencyKey: 'dup' }));
    const { jobId: id1 } = (await a.json()) as { jobId: string };
    await waitJob(id1);
    const b = await POST(req({ url: 'https://github.com/foo/bar', idempotencyKey: 'dup' }));
    const { jobId: id2 } = (await b.json()) as { jobId: string };
    expect(id2).toBe(id1);
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(QUOTA ? 2 : 0);
  });

  it('cancel mid-job: status cancelled, credits refunded, assemble aborted', async () => {
    const gate = deferred();
    let sawAbort = false;
    serverDeps.assembleRepoModel = (_f, _m, opts) =>
      new Promise((_res, rej) => {
        opts?.signal?.addEventListener('abort', () => { sawAbort = true; rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
        void gate.promise;
      });
    const res = await POST(req({ url: 'https://github.com/foo/bar' }));
    const { jobId } = (await res.json()) as { jobId: string };
    for (let i = 0; i < 200; i++) {
      if (serverDeps.store.getJob(jobId)?.stage === 'designing') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const c = await CANCEL(cancelReq(jobId), { params: Promise.resolve({ id: jobId }) });
    expect(c.status).toBe(200);
    const job = await waitJob(jobId, (s) => s === 'cancelled');
    expect(job.status).toBe('cancelled');
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(0);
    await new Promise((r) => setTimeout(r, 30));
    expect(sawAbort).toBe(true);
    gate.resolve();
  });

  it('a cancelled job is never overwritten by the job body finishing late', async () => {
    let releaseIngest!: () => void;
    const ingesting = new Promise<void>((r) => { releaseIngest = r; });
    serverDeps.ingestRepo = async (_p, opts) => {
      await ingesting;
      if (opts?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return okIngest;
    };
    const res = await POST(req({ url: 'https://github.com/foo/bar' }));
    const { jobId } = (await res.json()) as { jobId: string };
    for (let i = 0; i < 200; i++) {
      if (serverDeps.store.getJob(jobId)?.stage === 'fetching') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    await CANCEL(cancelReq(jobId), { params: Promise.resolve({ id: jobId }) });
    releaseIngest(); // ingest completes AFTER the cancel — the body must not resurrect the job
    await new Promise((r) => setTimeout(r, 80));
    expect(serverDeps.store.getJob(jobId)!.status).toBe('cancelled');
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(0);
  });

  it('cancel before the job body starts → body never runs, status stays cancelled', async () => {
    resetSlots(1);
    let releaseFirst!: () => void;
    const first = new Promise<void>((r) => { releaseFirst = r; });
    serverDeps.assembleRepoModel = () => first.then(() => ({ ok: true as const, model: structuredClone(validFullModel), usage }));
    const a = await POST(req({ url: 'https://github.com/foo/bar' })); // holds the only slot
    const { jobId: aId } = (await a.json()) as { jobId: string };
    const b = await POST(req({ url: 'https://github.com/foo/baz' })); // stays queued
    const { jobId: bId } = (await b.json()) as { jobId: string };
    await CANCEL(cancelReq(bId), { params: Promise.resolve({ id: bId }) });
    releaseFirst();
    await waitJob(aId);
    await new Promise((r) => setTimeout(r, 80));
    expect(serverDeps.store.getJob(bId)!.status).toBe('cancelled');
  });

  it('tokens spent before a cancel are still metered (I1)', async () => {
    serverDeps.assembleRepoModel = (_f, _m, opts) =>
      new Promise((res) => {
        opts?.signal?.addEventListener('abort', () => res({ ok: false as const, errors: ['cancelled'], usage })); // mirrors the loop-top abort return
      });
    const res = await POST(req({ url: 'https://github.com/foo/bar' }));
    const { jobId } = (await res.json()) as { jobId: string };
    for (let i = 0; i < 200; i++) {
      if (serverDeps.store.getJob(jobId)?.stage === 'designing') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    await CANCEL(cancelReq(jobId), { params: Promise.resolve({ id: jobId }) });
    await new Promise((r) => setTimeout(r, 80));
    expect(serverDeps.store.getJob(jobId)!.status).toBe('cancelled');
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(0);
    const calls = serverDeps.store.listCalls('test-sess');
    expect(calls.length).toBe(1); // tokens hit call_log even though the job was cancelled
    expect(calls[0]!.outputTokens).toBe(usage.outputTokens);
  });

  it('cancel after success is a no-op — no double refund', async () => {
    const res = await POST(req({ url: 'https://github.com/foo/bar' }));
    const { jobId } = (await res.json()) as { jobId: string };
    await waitJob(jobId);
    const c = await CANCEL(cancelReq(jobId), { params: Promise.resolve({ id: jobId }) });
    expect(c.status).toBe(200);
    expect(serverDeps.store.getJob(jobId)!.status).toBe('succeeded');
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(QUOTA ? 2 : 0);
  });

  it('poll surfaces ingest gaps on the succeeded job', async () => {
    serverDeps.ingestRepo = async () => ({ ...okIngest, gaps: ['no database detected', 'submodule(s) skipped'] });
    const res = await POST(req({ url: 'https://github.com/foo/bar' }));
    const { jobId } = (await res.json()) as { jobId: string };
    await waitJob(jobId);
    const poll = await GET(getReq(jobId), { params: Promise.resolve({ id: jobId }) });
    expect((await poll.json()).gaps).toEqual(['no database detected', 'submodule(s) skipped']);
  });

  it('ownership: another session cannot cancel or read the job', async () => {
    const gate = deferred();
    serverDeps.assembleRepoModel = (_f, _m, opts) =>
      new Promise((_res, rej) => {
        opts?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        void gate.promise;
      });
    const res = await POST(req({ url: 'https://github.com/foo/bar' }));
    const { jobId } = (await res.json()) as { jobId: string };
    const other = await CANCEL(cancelReq(jobId, 'aw_sid=mallory'), { params: Promise.resolve({ id: jobId }) });
    expect(other.status).toBe(404);
    expect(serverDeps.store.getJob(jobId)!.status).not.toBe('cancelled');
    const read = await GET(getReq(jobId, 'aw_sid=mallory'), { params: Promise.resolve({ id: jobId }) });
    expect(read.status).toBe(404);
    const mine = await CANCEL(cancelReq(jobId), { params: Promise.resolve({ id: jobId }) });
    expect(mine.status).toBe(200);
    expect((await waitJob(jobId)).status).toBe('cancelled');
  });
});

describe('POST /api/repo localPath (§8 private import)', () => {
  it('hosted mode: localPath → 400 before any ingest runs', async () => {
    const prevMode = process.env.ARCHWOVEN_MODE;
    delete process.env.ARCHWOVEN_MODE; // force hosted regardless of suite mode
    try {
      let localCalled = false;
      serverDeps.ingestLocal = async () => { localCalled = true; return okIngest; };
      const res = await POST(req({ localPath: '/home/user/private-shop', idempotencyKey: 'lp-hosted' }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/local deployments only/i);
      expect(localCalled).toBe(false);
    } finally {
      if (prevMode !== undefined) process.env.ARCHWOVEN_MODE = prevMode;
    }
  });

  it('local mode: clone path → job succeeds, privacy stamped, evidence pinned to the clone', async () => {
    const prevMode = process.env.ARCHWOVEN_MODE;
    process.env.ARCHWOVEN_MODE = 'local';
    try {
      let seenDir = '';
      serverDeps.ingestLocal = async (dir) => { seenDir = dir; return okIngest; };
      serverDeps.assembleRepoModel = async (_f, meta) => {
        const m = structuredClone(validFullModel);
        for (const x of [...m.nodes, ...m.edges]) for (const ev of x.evidence) { ev.commit = meta.sha; ev.repo = `${meta.owner}/${meta.repo}`; }
        return { ok: true as const, model: m, usage };
      };
      const res = await POST(req({ localPath: '/home/user/private-shop', idempotencyKey: 'lp-local' }));
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(202);
      const { jobId } = (await res.json()) as { jobId: string };
      const job = await waitJob(jobId);
      expect(job.status).toBe('succeeded');
      expect(seenDir).toContain('private-shop');
      const model = serverDeps.store.getRevision(jobId)! as { privacy: { classification: string; boundary: string }; nodes: { evidence: { repo?: string }[] }[] };
      expect(model.privacy).toEqual({ classification: 'private', boundary: 'local-only' });
      const evs = model.nodes.flatMap((n) => n.evidence);
      expect(evs.every((e) => e.repo === 'local/private-shop')).toBe(true);
    } finally {
      if (prevMode === undefined) delete process.env.ARCHWOVEN_MODE; else process.env.ARCHWOVEN_MODE = prevMode;
    }
  });

  it('local mode: missing directory → job fails with not-a-directory', async () => {
    const prevMode = process.env.ARCHWOVEN_MODE;
    process.env.ARCHWOVEN_MODE = 'local';
    try {
      serverDeps.ingestLocal = async (dir) => {
        const { existsSync, statSync } = await import('node:fs');
        return existsSync(dir) && statSync(dir).isDirectory() ? okIngest : { ok: false as const, reason: 'not-a-directory', message: 'no such directory' };
      };
      const res = await POST(req({ localPath: '/nope/ghost', idempotencyKey: 'lp-ghost' }));
      const { jobId } = (await res.json()) as { jobId: string };
      const job = await waitJob(jobId);
      expect(job.status).toBe('failed');
      expect(job.error).toMatch(/directory/i);
    } finally {
      if (prevMode === undefined) delete process.env.ARCHWOVEN_MODE; else process.env.ARCHWOVEN_MODE = prevMode;
    }
  });
});

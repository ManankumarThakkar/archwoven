import { beforeEach, describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import { NOT_FOUND_OR_PRIVATE_COPY } from '@archwoven/ingest';
import type { Fragment } from '@archwoven/extract';
import { assembleRepoModel, type StructuredClient } from '@archwoven/llm';
import petclinic from '../../../../../packages/llm/src/fixtures/petclinic-schema-drift.json';
import { serverDeps } from '../../lib/server';
import { resetSlots } from '../../lib/llm-limiter';
import { POST } from './route';
import { POST as CANCEL } from '../jobs/[id]/cancel/route';
import { GET } from '../jobs/[id]/route';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const usage = { provider: 'anthropic' as const, transportRetries: 0, usageComplete: true, attempts: [], model: 'claude-opus-5-5', effort: 'medium' as const, inputTokens: 1000, cacheWriteTokens: 5000, cacheReadTokens: 10000, outputTokens: 1500, latencyMs: 500, repairs: 0 };

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

// Only the paid model transport is replaced: exercise the real assembly,
// validator, repair loop, route persistence, metering and refunds together.
function petclinicClient(repairSucceeds: boolean): StructuredClient {
  let attempt = 0;
  return {
    messages: { countTokens: async () => ({ input_tokens: 500 }) },
    beta: { messages: { create: async () => ({
      content: [{ type: 'text', text: JSON.stringify(attempt++ === 0 || !repairSucceeds ? petclinic.invalidModel : petclinic.repairedModel) }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1200, cache_creation_input_tokens: 900, cache_read_input_tokens: 100, output_tokens: 800 },
    }) } },
  };
}

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
  it.each([true, false])('PetClinic schema repair succeeds=%s: real assembly persists or fails with correct metering and credits', async (repairSucceeds) => {
    serverDeps.ingestRepo = async () => ({ ...okIngest, framework: 'spring-boot', fragment: petclinic.fragment as Fragment, gaps: petclinic.fragment.gaps });
    const client = petclinicClient(repairSucceeds);
    serverDeps.assembleRepoModel = (fragment, meta, opts) => assembleRepoModel(fragment, meta, { ...opts, client });
    const res = await POST(req({ url: 'https://github.com/spring-projects/spring-petclinic' }));
    expect(res.status).toBe(202);
    const { jobId } = await res.json() as { jobId: string };
    const job = await waitJob(jobId);
    expect(job.status).toBe(repairSucceeds ? 'succeeded' : 'failed');
    const revision = serverDeps.store.getRevision(jobId);
    if (repairSucceeds) {
      expect(revision).toMatchObject({
        title: 'Spring PetClinic',
        privacy: QUOTA
          ? { classification: 'public', boundary: 'external-allowed' }
          : { classification: 'private', boundary: 'local-only' },
      });
      const poll = await GET(getReq(jobId), { params: Promise.resolve({ id: jobId }) });
      expect((await poll.json()).gaps).toEqual(['No deployment descriptor detected']);
    } else {
      expect(revision).toBeNull();
      expect(job.error).toContain('views.0.type');
      expect(job.error).toContain('visibility');
    }
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(repairSucceeds && QUOTA ? 2 : 0);
    const calls = serverDeps.store.listCalls('test-sess');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject(repairSucceeds
      ? { outcome: 'repaired', retries: 1, inputTokens: 2400, cacheWriteTokens: 1800, cacheReadTokens: 200, outputTokens: 1600 }
      : { outcome: 'failed', retries: 2, inputTokens: 3600, cacheWriteTokens: 2700, cacheReadTokens: 300, outputTokens: 2400 });
    expect(calls[0]!.costUsd).toBeGreaterThan(0);
    // Repeated cancellation after settlement cannot refund successful work or
    // double-refund a failed job.
    await CANCEL(cancelReq(jobId), { params: Promise.resolve({ id: jobId }) });
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(repairSucceeds && QUOTA ? 2 : 0);
  });

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
    expect(body.message).toMatch(/reset in \d+h \d+m/);
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

  it('reanalyzes the same repository after an old extraction failure and charges only successful work', async () => {
    const body = { url: 'https://github.com/foo/bar', idempotencyKey: 'retry-old-extractor' };
    serverDeps.ingestRepo = async () => ({ ok: false, reason: 'unsupported', message: 'No Spring Boot or FastAPI constructs found — M3 supports those two frameworks.' });
    const first = await POST(req(body));
    const { jobId: oldId } = await first.json() as { jobId: string };
    expect((await waitJob(oldId)).status).toBe('failed');
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(0);
    serverDeps.ingestRepo = async () => okIngest;
    const retry = await POST(req(body));
    expect(retry.status).toBe(202);
    const { jobId: newId } = await retry.json() as { jobId: string };
    expect(newId).not.toBe(oldId);
    expect((await waitJob(newId)).status).toBe('succeeded');
    expect(serverDeps.store.getJob(oldId)?.status).toBe('failed');
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(QUOTA ? 2 : 0);
    expect(serverDeps.store.listCalls('test-sess')).toHaveLength(1);
    const again = await POST(req(body));
    expect((await again.json()).jobId).toBe(newId);
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

  it('meters a valid model returned after cancellation without saving a revision or refunding twice', async () => {
    const started = deferred();
    const finish = deferred();
    serverDeps.assembleRepoModel = async () => {
      started.resolve();
      await finish.promise; // provider completes despite cancellation
      return { ok: true, model: structuredClone(validFullModel), usage: { ...usage, repairs: 1 } };
    };
    const res = await POST(req({ url: 'https://github.com/foo/bar' }));
    const { jobId } = await res.json() as { jobId: string };
    await started.promise;
    await CANCEL(cancelReq(jobId), { params: Promise.resolve({ id: jobId }) });
    expect(serverDeps.store.getJob(jobId)!.status).toBe('cancelled');
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(0);
    finish.resolve();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(serverDeps.store.getJob(jobId)!.status).toBe('cancelled');
    expect(serverDeps.store.getRevision(jobId)).toBeNull();
    expect(serverDeps.store.listCalls('test-sess')).toEqual([
      expect.objectContaining({ outcome: 'failed', retries: 1, inputTokens: 1000, cacheWriteTokens: 5000, cacheReadTokens: 10000, outputTokens: 1500 }),
    ]);
    await CANCEL(cancelReq(jobId), { params: Promise.resolve({ id: jobId }) });
    expect(serverDeps.store.creditsUsed('test-sess', day())).toBe(0);
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

  it('saves ingest disclosures into the model so a reload shows the same warnings', async () => {
    serverDeps.ingestRepo = async () => ({ ...okIngest, gaps: ['Skipped 1 binary file: docs/a.png.', 'no database detected', 'Is inventory held in Postgres or a dedicated service?'] });
    const res = await POST(req({ url: 'https://github.com/foo/bar' }));
    const { jobId } = (await res.json()) as { jobId: string };
    await waitJob(jobId);
    const saved = serverDeps.store.getRevision(jobId)!;
    const texts = saved.openQuestions.map(q => q.text);
    for (const g of ['Skipped 1 binary file: docs/a.png.', 'no database detected', 'Is inventory held in Postgres or a dedicated service?']) expect(texts.filter(t => t === g)).toHaveLength(1);
    expect(new Set(saved.openQuestions.map(q => q.id)).size).toBe(saved.openQuestions.length);
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

describe('POST /api/repo local folder paths', () => {
  const inLocalMode = async (fn: () => Promise<void>) => {
    const prevMode = process.env.ARCHWOVEN_MODE;
    process.env.ARCHWOVEN_MODE = 'local';
    try { await fn(); } finally { if (prevMode === undefined) delete process.env.ARCHWOVEN_MODE; else process.env.ARCHWOVEN_MODE = prevMode; }
  };

  it.each(['code/project', './project', '../project', '~other/project'])('refuses the relative path %j before any job or filesystem access', (path) => inLocalMode(async () => {
    let touched = false;
    serverDeps.ingestLocal = async () => { touched = true; return okIngest; };
    const res = await POST(req({ localPath: path, idempotencyKey: `rel-${path}` }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('Enter the full path to a git clone on this machine, for example /Users/you/code/project or ~/code/project.');
    expect(touched).toBe(false);
    expect(serverDeps.store.listCalls('test-sess')).toEqual([]);
  }));

  it('expands ~ to the home folder of the machine running Archwoven', () => inLocalMode(async () => {
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    let seenDir = '';
    serverDeps.ingestLocal = async (dir) => { seenDir = dir; return okIngest; };
    const res = await POST(req({ localPath: '  ~/code/private-shop  ', idempotencyKey: 'tilde' }));
    expect(res.status).toBe(202);
    await waitJob(((await res.json()) as { jobId: string }).jobId);
    expect(seenDir).toBe(join(homedir(), 'code/private-shop'));
  }));

  it('reports no credit count when replaying a local job', () => inLocalMode(async () => {
    const first = await POST(req({ localPath: '/home/user/private-shop', idempotencyKey: 'replay' }));
    await waitJob(((await first.json()) as { jobId: string }).jobId);
    const again = await POST(req({ localPath: '/home/user/private-shop', idempotencyKey: 'replay' }));
    expect(((await again.json()) as { remaining: unknown }).remaining).toBeNull();
  }));
});

describe('repository secrets are masked before hosted analysis', () => {
  const KEY = ['sk_', 'live_'].join('') + 'Z9'.repeat(12);
  const secretFragment = (): Fragment => ({
    nodes: [{ id: 'svc.api', kind: 'service', label: 'API', provenance: 'source-supported', evidence: [{ path: 'main.py', lines: [1, 2], repo: 'foo/bar', commit: SHA, note: `configures ${KEY}` }] }],
    edges: [], endpoints: [], gaps: [],
  });

  it('sends the provider a masked fragment and records the disclosure with the model', async () => {
    const prev = process.env.ARCHWOVEN_MODE; delete process.env.ARCHWOVEN_MODE;
    try {
      let sent = '';
      serverDeps.ingestRepo = async () => ({ ...okIngest, fragment: secretFragment() });
      const base = serverDeps.assembleRepoModel;
      serverDeps.assembleRepoModel = async (fragment, meta, opts) => { sent = JSON.stringify(fragment); return base(fragment, meta, opts); };
      const res = await POST(req({ url: 'https://github.com/foo/bar', idempotencyKey: 'masked' }));
      const { jobId } = (await res.json()) as { jobId: string };
      expect((await waitJob(jobId)).status).toBe('succeeded');
      expect(sent).not.toContain(KEY);
      expect(sent).toContain('[REDACTED:Stripe key]');
      expect(serverDeps.store.getRevision(jobId)!.openQuestions.map(q => q.text)).toContain('Masked 1 likely secret (1 Stripe key) before analysis; their values were never sent to the AI provider.');
    } finally { if (prev !== undefined) process.env.ARCHWOVEN_MODE = prev; }
  });

  it('leaves local analysis untouched', async () => {
    const prev = process.env.ARCHWOVEN_MODE; process.env.ARCHWOVEN_MODE = 'local';
    try {
      let sent = '';
      serverDeps.ingestLocal = async () => ({ ...okIngest, fragment: secretFragment() });
      const base = serverDeps.assembleRepoModel;
      serverDeps.assembleRepoModel = async (fragment, meta, opts) => { sent = JSON.stringify(fragment); return base(fragment, meta, opts); };
      const res = await POST(req({ localPath: '/home/user/private-shop', idempotencyKey: 'local-unmasked' }));
      const { jobId } = (await res.json()) as { jobId: string };
      await waitJob(jobId);
      expect(sent).toContain(KEY);
    } finally { if (prev === undefined) delete process.env.ARCHWOVEN_MODE; else process.env.ARCHWOVEN_MODE = prev; }
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { validFullModel, type EditOp } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import { serverDeps } from '../../lib/server';
import { POST } from './route';

const usage = { provider: 'anthropic' as const, transportRetries: 0, usageComplete: true, attempts: [], model: 'claude-opus-5-5', effort: 'low' as const, inputTokens: 2000, cacheWriteTokens: 0, cacheReadTokens: 1800, outputTokens: 120, latencyMs: 400, repairs: 0 };

// Quotas compile out in local mode (reserve → Infinity → JSON null); credit assertions are hosted-only.
const QUOTA = process.env.ARCHWOVEN_MODE !== 'local';

const addCacheOp: EditOp = {
  op: 'add',
  target: 'svc.cache',
  patch: { id: 'svc.cache', kind: 'service', label: 'Cache', provenance: 'proposed' },
  baseRevision: validFullModel.revision,
  summary: '+Cache service',
};

const req = (body: unknown) =>
  new Request('http://localhost/api/refine', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'aw_sid=test-sess' },
    body: JSON.stringify(body),
  });

const reqAs = (body: unknown, cookie: string) =>
  new Request('http://localhost/api/refine', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  serverDeps.store = openStore(':memory:');
  serverDeps.store.saveRevision('m1', validFullModel, 'test-sess');
  serverDeps.generateRefinement = async () => ({ ok: true as const, ops: [addCacheOp], usage });
});

describe('POST /api/refine', () => {
  it('rejects a late refinement when a direct edit has advanced the revision', async () => {
    serverDeps.generateRefinement = async () => {
      const changed = structuredClone(validFullModel); changed.revision=2; changed.parentId=1; changed.nodes[0]!.label='Directly renamed';
      serverDeps.store.saveRevision('m1',changed,'test-sess'); return {ok:true,ops:[addCacheOp],usage};
    };
    const response=await POST(req({modelId:'m1',baseRevision:1,instruction:'add cache'}));
    expect(response.status).toBe(409);expect(serverDeps.store.getRevision('m1')?.revision).toBe(2);
    expect(serverDeps.store.getRevision('m1')?.nodes[0]!.label).toBe('Directly renamed');
  });
  it('a cancelled request cannot persist a late successful refinement', async () => {
    const controller = new AbortController();
    serverDeps.generateRefinement = async (_instruction, _model, _view, opts) => {
      expect(opts?.signal).toBeDefined();
      controller.abort();
      return { ok: true, ops: [addCacheOp], usage };
    };
    const request = new Request(req({ modelId: 'm1', baseRevision: validFullModel.revision, instruction: 'add a cache' }), { signal: controller.signal });
    const res = await POST(request);
    expect(res.status).toBe(502);
    expect(serverDeps.store.getRevision('m1')?.revision).toBe(validFullModel.revision);
    expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBe(0);
    expect(serverDeps.store.listCalls('test-sess')).toHaveLength(1);
  });
  it('happy: applies ops, commits revision+1, charges 0.25, returns remaining', async () => {
    const res = await POST(req({ modelId: 'm1', baseRevision: validFullModel.revision, instruction: 'add a cache' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ops: EditOp[]; model: { revision: number }; revision: number; remaining: number };
    expect(body.ops).toHaveLength(1);
    expect(body.revision).toBe(validFullModel.revision + 1);
    expect(body.model.revision).toBe(validFullModel.revision + 1);
    if (QUOTA) expect(body.remaining).toBeCloseTo(5.75); else expect(body.remaining).toBeNull();
    expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBeCloseTo(QUOTA ? 0.25 : 0);
    expect(serverDeps.store.getRevision('m1')?.revision).toBe(validFullModel.revision + 1);
  });

  it('stale baseRevision → 409 with rebase payload carrying the latest revision', async () => {
    const res = await POST(req({ modelId: 'm1', baseRevision: validFullModel.revision + 99, instruction: 'add a cache' }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string; model: { revision: number; nodes: unknown[] }; revision: number };
    expect(body.reason).toBe('stale-revision');
    expect(body.revision).toBe(validFullModel.revision);
    expect(body.model.nodes).toEqual(validFullModel.nodes);
  });

  it('unknown modelId → 404, no model call', async () => {
    let called = false;
    serverDeps.generateRefinement = async () => {
      called = true;
      return { ok: true as const, ops: [], usage };
    };
    const res = await POST(req({ modelId: 'nope', baseRevision: 1, instruction: 'x' }));
    expect(res.status).toBe(404);
    expect(called).toBe(false);
  });

  it('refinement failure → 502, reserved credit refunded, prior revision preserved', async () => {
    serverDeps.generateRefinement = async () => ({ ok: false as const, errors: ['provider exploded'], usage });
    const res = await POST(req({ modelId: 'm1', baseRevision: validFullModel.revision, instruction: 'x' }));
    expect(res.status).toBe(502);
    expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBe(0);
    expect(serverDeps.store.getRevision('m1')?.revision).toBe(validFullModel.revision);
    // the failed attempt was still metered
    expect(serverDeps.store.todayCost()).toBeGreaterThan(0);
  });

  it('another session cannot refine your model', async () => {
    let called = false;
    serverDeps.generateRefinement = async () => {
      called = true;
      return { ok: true as const, ops: [addCacheOp], usage };
    };
    const res = await POST(reqAs({ modelId: 'm1', baseRevision: validFullModel.revision, instruction: 'x' }, 'aw_sid=mallory'));
    expect(res.status).toBe(404);
    expect(called).toBe(false);
  });
});

describe('refinements that change nothing', () => {
  it('saves no revision, refunds the credit and explains', async () => {
    const same: EditOp = { op: 'update', target: 'gateway.api', patch: { label: validFullModel.nodes.find(n => n.id === 'gateway.api')!.label }, baseRevision: validFullModel.revision, summary: 'no-op' };
    serverDeps.generateRefinement = async () => ({ ok: true as const, ops: [same], usage });
    const res = await POST(req({ modelId: 'm1', baseRevision: 1, instruction: 'make it nicer' }));
    expect(res.status).toBe(422);
    expect((await res.json()).message).toBe('This instruction did not change the diagram, so nothing was saved and no credit was used.');
    expect(serverDeps.store.getRevision('m1')?.revision).toBe(1);
    expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBe(0);
    expect(serverDeps.store.listCalls('test-sess')).toHaveLength(1);
  });
});

it('retains provider usage and refunds a refinement when saving fails', async () => {
  const save = serverDeps.store.saveRevision;
  serverDeps.store.saveRevision = () => { throw new Error('save unavailable'); };
  try {
    const res = await POST(req({ modelId: 'm1', baseRevision: 1, instruction: 'add cache', view: 'sequence' }));
    expect(res.status).toBe(500);
    expect(serverDeps.store.lastTask('test-sess')).toMatchObject({ action: 'refine', modelId: 'm1', view: 'sequence', outcome: 'failed', inputTokens: 2000 });
    expect(serverDeps.store.listCalls('test-sess')).toHaveLength(1);
    expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBe(0);
  } finally { serverDeps.store.saveRevision = save; }
});

describe('secrets in refinement instructions (hosted)', () => {
  it('refuses before any credit or provider call', async () => {
    const prev = process.env.ARCHWOVEN_MODE; delete process.env.ARCHWOVEN_MODE;
    try {
      let called = false;
      serverDeps.generateRefinement = async () => { called = true; return { ok: true as const, ops: [addCacheOp], usage }; };
      const key = ['sk_', 'live_'].join('') + 'Z9'.repeat(12);
      const res = await POST(req({ modelId: 'm1', baseRevision: 1, instruction: `Add a payments service using ${key}` }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.reason).toBe('secret-detected');
      expect(body.error).toMatch(/^Your instruction contains what looks like a Stripe key on line 1\./);
      expect(called).toBe(false);
      expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBe(0);
    } finally { if (prev !== undefined) process.env.ARCHWOVEN_MODE = prev; }
  });
});

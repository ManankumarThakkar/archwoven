import { beforeEach, describe, expect, it } from 'vitest';
import { validFullModel, type EditOp } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import { serverDeps } from '../../lib/server';
import { POST } from './route';

const usage = { model: 'claude-opus-5-5', effort: 'low' as const, inputTokens: 2000, cacheWriteTokens: 0, cacheReadTokens: 1800, outputTokens: 120, latencyMs: 400, repairs: 0 };

// §15: quotas compile out in local mode (reserve → Infinity → JSON null); credit assertions are hosted-only.
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
    // the failed attempt was still metered (§11)
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

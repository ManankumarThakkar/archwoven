import { beforeEach, describe, expect, it } from 'vitest';
import { validFullModel, type EditOp } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import { serverDeps } from '../../lib/server';
import { POST } from './route';

const usage = { model: 'claude-opus-5-5', effort: 'low' as const, inputTokens: 2000, cacheWriteTokens: 0, cacheReadTokens: 1800, outputTokens: 120, latencyMs: 400, repairs: 0 };

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
  it('happy: applies ops, commits revision+1, charges 0.25, returns remaining', async () => {
    const res = await POST(req({ modelId: 'm1', baseRevision: validFullModel.revision, instruction: 'add a cache' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ops: EditOp[]; model: { revision: number }; revision: number; remaining: number };
    expect(body.ops).toHaveLength(1);
    expect(body.revision).toBe(validFullModel.revision + 1);
    expect(body.model.revision).toBe(validFullModel.revision + 1);
    expect(body.remaining).toBeCloseTo(5.75);
    expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBeCloseTo(0.25);
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

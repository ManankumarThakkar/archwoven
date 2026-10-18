import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyExpansion, internalsOf, validFullModelExtended, type SystemModel } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import { serverDeps } from '../../../../lib/server';
import { POST } from './route';

// Quotas compile out in local mode; credit assertions are hosted-only.
const QUOTA = process.env.ARCHWOVEN_MODE !== 'local';
const ctx = { params: Promise.resolve({ id: 'm1' }) };
const day = () => new Date().toISOString().slice(0, 10);
const usage = { provider: 'anthropic' as const, transportRetries: 0, usageComplete: true, attempts: [], model: 'claude-opus-5-5', effort: 'low' as const, inputTokens: 900, cacheWriteTokens: 0, cacheReadTokens: 700, outputTokens: 150, latencyMs: 300, repairs: 0 };
const expansion = {
  internals: [{ key: 'intake', label: 'Order Intake' }, { key: 'payments', label: 'Payments' }, { key: 'store', label: 'Order Store' }],
  links: [
    { from: 'gateway.api', to: 'intake', type: 'sync' }, { from: 'intake', to: 'payments', type: 'sync' },
    { from: 'payments', to: 'external.stripe', type: 'sync' }, { from: 'intake', to: 'store', type: 'data' },
    { from: 'store', to: 'datastore.postgres', type: 'data' },
  ],
};
const request = (body: unknown, cookie = 'aw_sid=owner', init: RequestInit = {}) => new Request('http://localhost/api/models/m1/expand', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: typeof body === 'string' ? body : JSON.stringify(body), ...init });
let calls: { model: SystemModel; target: string; hint: string }[];

beforeEach(() => {
  serverDeps.store = openStore(':memory:');
  serverDeps.store.saveRevision('m1', validFullModelExtended, 'owner');
  calls = [];
  serverDeps.expandComponent = vi.fn(async (model: SystemModel, target: string, hint: string) => {
    calls.push({ model, target, hint });
    const r = applyExpansion(model, target, expansion);
    return r.ok ? { ok: true as const, model: r.model, usage } : { ok: false as const, errors: r.errors, usage };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/models/:id/expand', () => {
  it('saves the expanded model, charges a refinement credit and meters the call', async () => {
    const res = await POST(request({ baseRevision: 1, target: 'svc.orders', hint: 'payments first' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revision).toBe(2);
    expect(internalsOf(body.model, 'svc.orders')).toHaveLength(3);
    expect(serverDeps.store.getRevision('m1')).toEqual(body.model);
    expect(calls).toEqual([{ model: validFullModelExtended, target: 'svc.orders', hint: 'payments first' }]);
    if (QUOTA) expect(body.remaining).toBeCloseTo(5.75); else expect(body.remaining).toBeNull();
    expect(serverDeps.store.creditsUsed('owner', day())).toBeCloseTo(QUOTA ? 0.25 : 0);
    expect(serverDeps.store.listCalls('owner')).toHaveLength(1);
  });

  it.each([
    ['not JSON', '{'],
    ['no target', { baseRevision: 1 }],
    ['a non-string target', { baseRevision: 1, target: 7 }],
    ['no base revision', { target: 'svc.orders' }],
    ['a hint over 300 characters', { baseRevision: 1, target: 'svc.orders', hint: 'x'.repeat(301) }],
    ['a non-string hint', { baseRevision: 1, target: 'svc.orders', hint: ['x'] }],
    ['extra fields', { baseRevision: 1, target: 'svc.orders', internals: [] }],
  ])('rejects %s before any credit or provider call', async (_name, body) => {
    expect((await POST(request(body), ctx)).status).toBe(400);
    expect(calls).toEqual([]);
    expect(serverDeps.store.creditsUsed('owner', day())).toBe(0);
  });

  it.each([
    ['an ER entity', 'entity.order', /entity/],
    ['an unknown component', 'svc.missing', /unknown/],
  ])('refuses %s before any credit or provider call', async (_name, target, message) => {
    const res = await POST(request({ baseRevision: 1, target }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).errors.join(' ')).toMatch(message);
    expect(calls).toEqual([]);
    expect(serverDeps.store.creditsUsed('owner', day())).toBe(0);
  });

  it('refuses a second expansion of the same component', async () => {
    await POST(request({ baseRevision: 1, target: 'svc.orders' }), ctx);
    const res = await POST(request({ baseRevision: 2, target: 'svc.orders' }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).errors.join(' ')).toMatch(/already has inferred internals/);
    expect(calls).toHaveLength(1);
  });

  it('hides another owner\'s model', async () => {
    expect((await POST(request({ baseRevision: 1, target: 'svc.orders' }, 'aw_sid=other'), ctx)).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it('rejects a stale base revision with the latest model and no charge', async () => {
    const latest = structuredClone(validFullModelExtended); latest.revision = 2; latest.parentId = 1;
    serverDeps.store.saveRevision('m1', latest, 'owner');
    const res = await POST(request({ baseRevision: 1, target: 'svc.orders' }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).model.revision).toBe(2);
    expect(calls).toEqual([]);
    expect(serverDeps.store.creditsUsed('owner', day())).toBe(0);
  });

  it('refunds and saves nothing when the provider fails', async () => {
    serverDeps.expandComponent = vi.fn(async () => ({ ok: false as const, errors: ['Order Service\'s link e.orders-pg is not covered'], usage: { ...usage, repairs: 2 } }));
    const res = await POST(request({ baseRevision: 1, target: 'svc.orders' }), ctx);
    expect(res.status).toBe(502);
    expect((await res.json()).errors).toEqual(['Order Service\'s link e.orders-pg is not covered']);
    expect(serverDeps.store.getRevision('m1')?.revision).toBe(1);
    expect(serverDeps.store.creditsUsed('owner', day())).toBe(0);
    expect(serverDeps.store.listCalls('owner')).toHaveLength(1);
  });

  it('refunds and keeps the newer diagram when another edit lands during inference', async () => {
    serverDeps.expandComponent = vi.fn(async (model: SystemModel, target: string) => {
      const changed = structuredClone(validFullModelExtended); changed.revision = 2; changed.parentId = 1; changed.nodes[0]!.label = 'Edited meanwhile';
      serverDeps.store.saveRevision('m1', changed, 'owner');
      const r = applyExpansion(model, target, expansion);
      return r.ok ? { ok: true as const, model: r.model, usage } : { ok: false as const, errors: r.errors, usage };
    });
    const res = await POST(request({ baseRevision: 1, target: 'svc.orders' }), ctx);
    expect(res.status).toBe(409);
    expect(serverDeps.store.getRevision('m1')?.nodes[0]!.label).toBe('Edited meanwhile');
    expect(internalsOf(serverDeps.store.getRevision('m1')!, 'svc.orders')).toEqual([]);
    expect(serverDeps.store.creditsUsed('owner', day())).toBe(0);
  });

  it('refunds and saves nothing when the request is cancelled during inference', async () => {
    const controller = new AbortController();
    serverDeps.expandComponent = vi.fn(async (model: SystemModel, target: string) => {
      controller.abort();
      const r = applyExpansion(model, target, expansion);
      return r.ok ? { ok: true as const, model: r.model, usage } : { ok: false as const, errors: r.errors, usage };
    });
    const res = await POST(request({ baseRevision: 1, target: 'svc.orders' }, 'aw_sid=owner', { signal: controller.signal }), ctx);
    expect(res.status).toBe(502);
    expect(serverDeps.store.getRevision('m1')?.revision).toBe(1);
    expect(serverDeps.store.creditsUsed('owner', day())).toBe(0);
  });

  it.runIf(QUOTA)('explains a missing provider key without charging', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const res = await POST(request({ baseRevision: 1, target: 'svc.orders' }), ctx);
    expect(res.status).toBe(503);
    expect(calls).toEqual([]);
  });
});

it('retains usage under the expansion action and refunds when saving fails', async () => {
  const save = serverDeps.store.saveRevision;
  serverDeps.store.saveRevision = () => { throw new Error('save unavailable'); };
  try {
    const res = await POST(request({ baseRevision: 1, target: 'svc.orders' }), ctx);
    expect(res.status).toBe(500);
    expect(serverDeps.store.lastTask('owner')).toMatchObject({ action: 'expand', modelId: 'm1', view: 'component-detail', outcome: 'failed', inputTokens: 900 });
    expect(serverDeps.store.listCalls('owner')).toHaveLength(1);
    expect(serverDeps.store.creditsUsed('owner', day())).toBe(0);
  } finally { serverDeps.store.saveRevision = save; }
});

describe('secrets in expansion hints (hosted)', () => {
  it('refuses before any credit or provider call', async () => {
    const prev = process.env.ARCHWOVEN_MODE; delete process.env.ARCHWOVEN_MODE;
    try {
      const url = ['postgres', '://admin:', 'S3cr3tPassw0rd', '@db.internal:5432/app'].join('');
      const res = await POST(request({ baseRevision: 1, target: 'svc.orders', hint: `it connects to ${url}` }), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/^Your hint contains what looks like a database connection string on line 1\./);
      expect(calls).toEqual([]);
      expect(serverDeps.store.creditsUsed('owner', day())).toBe(0);
    } finally { if (prev !== undefined) process.env.ARCHWOVEN_MODE = prev; }
  });
});

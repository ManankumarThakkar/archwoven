import { describe, expect, it } from 'vitest';
import { inspectorFor } from './inspector';
import type { SystemModel } from '@archwoven/model';

const model: SystemModel = {
  schemaVersion: '1',
  revision: 1,
  title: 'Shop',
  requirements: [],
  openQuestions: [
    { id: 'oq-1', text: 'Is inventory held in Postgres or a dedicated service?', blockedBy: 'svc.orders' },
    { id: 'oq-2', text: 'Which payment provider?' },
  ],
  nodes: [
    { id: 'svc.orders', kind: 'service', label: 'Orders', provenance: 'user-specified', evidence: [{ repo: 'acme/shop', commit: 'abc1234', path: 'src/orders/OrdersService.java', lines: [10, 42] }] },
    { id: 'svc.cache', kind: 'service', label: 'Cache', provenance: 'proposed', evidence: [] },
  ],
  edges: [{ id: 'e.orders-cache', from: 'svc.orders', to: 'svc.cache', type: 'sync', label: 'cache lookup', provenance: 'inferred', evidence: [] }],
  views: [{ id: 'v.arch', type: 'architecture', nodes: ['svc.orders', 'svc.cache'], edges: ['e.orders-cache'] }],
  privacy: { classification: 'private', boundary: 'local-only' },
  boundaries: [], guidedViews: [],
};

describe('inspectorFor', () => {
  it('node → label, kind, provenance, role blurb, evidence links', () => {
    const p = inspectorFor(model, 'svc.orders');
    expect(p).not.toBeNull();
    expect(p!.kind).toBe('node');
    expect(p!.label).toBe('Orders');
    expect(p!.provenance).toBe('user-specified');
    expect(p!.role).toMatch(/service/i);
    expect(p!.evidence[0]).toMatchObject({ label: 'OrdersService.java:10-42', href: 'https://github.com/acme/shop/blob/abc1234/src/orders/OrdersService.java#L10' });
  });

  it('proposed vs source-supported are distinct in the payload (scenario 6)', () => {
    expect(inspectorFor(model, 'svc.cache')!.provenance).toBe('proposed');
    expect(inspectorFor(model, 'svc.cache')!.evidence).toHaveLength(0);
    expect(inspectorFor(model, 'svc.orders')!.provenance).toBe('user-specified');
  });

  it('node carries the open questions that block it', () => {
    expect(inspectorFor(model, 'svc.orders')!.gaps).toEqual(['Is inventory held in Postgres or a dedicated service?']);
    expect(inspectorFor(model, 'svc.cache')!.gaps).toEqual([]);
  });

  it('edge → endpoints, type, provenance', () => {
    const p = inspectorFor(model, 'e.orders-cache');
    expect(p!.kind).toBe('edge');
    expect(p!.endpoints).toEqual({ from: 'svc.orders', to: 'svc.cache' });
    expect(p!.type).toBe('sync');
  });

  it('unknown id → null', () => {
    expect(inspectorFor(model, 'nope')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { SystemModel } from '@archwoven/model';
import { passportFor } from './passport';

const model: SystemModel = {
  schemaVersion: '1',
  revision: 1,
  title: 'Shop',
  requirements: [],
  openQuestions: [],
  nodes: [
    { id: 'svc.orders', kind: 'service', label: 'Orders', provenance: 'user-specified', evidence: [{ repo: 'acme/shop', commit: 'abc1234', path: 'src/orders/OrdersService.java', lines: [10, 42] }] },
    { id: 'db.cache', kind: 'datastore', label: 'Cache Store', provenance: 'proposed', evidence: [] },
  ],
  edges: [
    { id: 'e.lookup', from: 'svc.orders', to: 'db.cache', type: 'sync', label: 'cache lookup', provenance: 'inferred', evidence: [{ repo: 'acme/shop', commit: 'def5678', path: 'src/orders/CacheClient.ts', lines: [3, 9] }, { note: 'design doc' }] },
    { id: 'e.bare', from: 'svc.orders', to: 'db.cache', type: 'data', provenance: 'proposed', evidence: [] },
  ],
  views: [{ id: 'v.arch', type: 'architecture', nodes: ['svc.orders', 'db.cache'], edges: ['e.lookup', 'e.bare'] }],
  privacy: { classification: 'private', boundary: 'local-only' },
  boundaries: [], guidedViews: [],
};

describe('passportFor', () => {
  it('edge → endpoint labels, edge label, kind, provenance, evidence count', () => {
    const p = passportFor(model, 'e.lookup');
    expect(p).not.toBeNull();
    expect(p!.fromLabel).toBe('Orders');
    expect(p!.toLabel).toBe('Cache Store');
    expect(p!.edgeLabel).toBe('cache lookup');
    expect(p!.edgeKind).toBe('sync');
    expect(p!.provenance).toBe('inferred');
    expect(p!.evidenceCount).toBe(2);
  });

  it('unlabeled edge falls back to its kind', () => {
    expect(passportFor(model, 'e.bare')!.edgeLabel).toBe('data');
    expect(passportFor(model, 'e.bare')!.evidenceCount).toBe(0);
  });

  it('unknown edge id → null', () => {
    expect(passportFor(model, 'nope')).toBeNull();
  });

  it('node id → null (passport is edges-only)', () => {
    expect(passportFor(model, 'svc.orders')).toBeNull();
  });

  it('never leaks evidence paths or commit SHAs (§5 privacy)', () => {
    const json = JSON.stringify(passportFor(model, 'e.lookup'));
    expect(json).not.toContain('src/');
    expect(json).not.toContain('OrdersService');
    expect(json).not.toContain('CacheClient');
    expect(json).not.toContain('abc1234');
    expect(json).not.toContain('def5678');
    expect(json).not.toContain('acme/shop');
    expect(json).not.toContain('path');
    expect(json).not.toContain('commit');
  });
});

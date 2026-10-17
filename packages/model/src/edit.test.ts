import { describe, expect, it } from 'vitest';
import { applyEditOps, undoTo } from './edit';
import type { EditOp, SystemModel } from './schema';

const mkModel = (): SystemModel => ({
  schemaVersion: '1',
  revision: 1,
  title: 'Shop',
  requirements: [],
  openQuestions: [],
  nodes: [
    { id: 'svc.api', kind: 'service', label: 'API', provenance: 'user-specified', evidence: [] },
    { id: 'svc.orders', kind: 'service', label: 'Orders', provenance: 'user-specified', evidence: [] },
    { id: 'datastore.db', kind: 'datastore', label: 'DB', provenance: 'inferred', evidence: [] },
  ],
  edges: [
    { id: 'e.api-orders', from: 'svc.api', to: 'svc.orders', type: 'sync', provenance: 'user-specified', evidence: [] },
    { id: 'e.orders-db', from: 'svc.orders', to: 'datastore.db', type: 'data', provenance: 'inferred', evidence: [] },
  ],
  views: [{ id: 'v.arch', type: 'architecture', nodes: ['svc.api', 'svc.orders', 'datastore.db'], edges: ['e.api-orders', 'e.orders-db'] }],
  privacy: { classification: 'public', boundary: 'external-allowed' },
  boundaries: [], guidedViews: [],
  layout: { 'svc.api': { x: 0, y: 0 }, 'svc.orders': { x: 100, y: 0 }, 'datastore.db': { x: 200, y: 50 } },
});

const op = (o: Omit<EditOp, 'baseRevision' | 'summary'>): EditOp => ({ baseRevision: 1, summary: 't', ...o });

describe('applyEditOps', () => {
  it('rejects unsupported prototype layout keys without losing the requested position silently', () => {
    const model=mkModel();model.nodes.push({id:'__proto__',kind:'service',label:'Prototype service',provenance:'user-specified',evidence:[]});
    const result=applyEditOps(model,[op({op:'move',target:'__proto__',patch:{x:20,y:30}})]);
    expect(result.ok).toBe(false);if(result.ok)return;
    expect(result.errors.join(' ')).toContain('unsupported layout key');
  });
  it('adds node + edge: revision+1, parentId=old, untouched layout preserved', async () => {
    const m = mkModel();
    const r = applyEditOps(m, [
      op({ op: 'add', target: 'svc.payments', patch: { id: 'svc.payments', kind: 'service', label: 'Payments', provenance: 'proposed' } }),
      op({ op: 'add', target: 'e.orders-payments', patch: { id: 'e.orders-payments', from: 'svc.orders', to: 'svc.payments', type: 'sync', provenance: 'proposed' } }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.model.revision).toBe(2);
    expect(r.model.parentId).toBe(1);
    expect(r.model.nodes.map((n) => n.id)).toContain('svc.payments');
    expect(r.model.edges.map((e) => e.id)).toContain('e.orders-payments');
    expect(r.model.layout?.['svc.api']).toEqual({ x: 0, y: 0 });
  });

  it('rejects removing a node still referenced by an edge; original model unchanged', () => {
    const m = mkModel();
    const r = applyEditOps(m, [op({ op: 'remove', target: 'svc.orders', patch: {} })]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('e.api-orders');
    expect(m.revision).toBe(1);
    expect(m.nodes).toHaveLength(3);
  });

  it('stale baseRevision → stale-revision error, nothing applied', () => {
    const r = applyEditOps(mkModel(), [
      { op: 'update', target: 'svc.api', patch: { label: 'X' }, baseRevision: 99, summary: 't' },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('stale-revision');
  });

  it('move touches layout only — nodes and edges byte-identical', () => {
    const m = mkModel();
    const r = applyEditOps(m, [op({ op: 'move', target: 'svc.api', patch: { x: 50, y: 60 } })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.model.nodes).toEqual(m.nodes);
    expect(r.model.edges).toEqual(m.edges);
    expect(r.model.layout?.['svc.api']).toEqual({ x: 50, y: 60 });
    expect(r.model.layout?.['svc.orders']).toEqual({ x: 100, y: 0 });
  });

  it('update label preserves layout of every node (scenario 8)', () => {
    const m = mkModel();
    const r = applyEditOps(m, [op({ op: 'update', target: 'svc.orders', patch: { label: 'Orders Service' } })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.model.nodes.find((n) => n.id === 'svc.orders')?.label).toBe('Orders Service');
    expect(r.model.layout).toEqual(m.layout);
    expect(r.model.revision).toBe(2);
  });

  it('atomic: a bad op after good ops applies nothing', () => {
    const m = mkModel();
    const r = applyEditOps(m, [
      op({ op: 'update', target: 'svc.api', patch: { label: 'Renamed' } }),
      op({ op: 'update', target: 'svc.ghost', patch: { label: 'X' } }),
    ]);
    expect(r.ok).toBe(false);
    expect(m.nodes.find((n) => n.id === 'svc.api')?.label).toBe('API');
  });
});

describe('undoTo', () => {
  it('restores the previous model with revision bookkeeping for the undo strip', () => {
    const prev = mkModel();
    const curr = { ...mkModel(), revision: 2, parentId: 1 };
    const undone = undoTo(curr, prev);
    expect(undone.revision).toBe(3); // undo is itself a forward revision
    expect(undone.parentId).toBe(2);
    expect(undone.nodes).toEqual(prev.nodes);
    expect(undone.layout).toEqual(prev.layout);
  });
});

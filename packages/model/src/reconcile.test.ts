import { describe, expect, it } from 'vitest';
import { applyEditOps, undoTo } from './edit';
import { validFullModel, validFullModelExtended } from './fixtures';
import { SystemModelSchema, type EditOp, type SystemModel } from './schema';
import { validateModel } from './validate';

/* Extended fixture: roots [actor.user, entity.user]; terminals [external.stripe, datastore.postgres, datastore.redis, entity.user, entity.product];
 * requiredEdges [actor.user→gateway.api sync]; requiredPaths [actor.user→datastore.postgres]; boundary b.core wraps gateway/orders/catalog;
 * chapter gv.happy focus user/gateway/orders; architecture mainPath user→gateway→orders; sequence 1 user→gw, 2 gw→orders,
 * 3 orders→stripe (alt covers 3,4), 4 stripe→orders, 5 orders→gw. No source-supported elements. */
const base = (): SystemModel => structuredClone(validFullModelExtended);
const op = (m: SystemModel, o: Omit<EditOp, 'baseRevision' | 'summary'>): EditOp => ({ ...o, baseRevision: m.revision, summary: 'test' });
const removeAll = (m: SystemModel, node: string): EditOp[] => [
  ...m.edges.filter(e => e.from === node || e.to === node).map(e => op(m, { op: 'remove', target: e.id, patch: {} })),
  op(m, { op: 'remove', target: node, patch: {} }),
];
const ok = (r: ReturnType<typeof applyEditOps>): SystemModel => { if (!r.ok) throw new Error(r.errors.join('; ')); return r.model; };
const refused = (r: ReturnType<typeof applyEditOps>): string => { expect(r.ok).toBe(false); return r.ok ? '' : r.errors.join('\n'); };
const sourceBacked = (m: SystemModel, ...ids: string[]) => { for (const x of [...m.nodes, ...m.edges]) if (ids.includes(x.id)) x.provenance = 'source-supported'; return m; };

describe('adding sources and sinks on checked models', () => {
  it('lets a new sink join the allowed terminals', () => {
    const m = base();
    const next = ok(applyEditOps(m, [
      op(m, { op: 'add', target: 'ds.cache', patch: { id: 'ds.cache', kind: 'datastore', label: 'Cache', provenance: 'proposed' } }),
      op(m, { op: 'add', target: 'e.catalog-cache', patch: { id: 'e.catalog-cache', from: 'svc.catalog', to: 'ds.cache', type: 'data', provenance: 'proposed' } }),
    ]));
    expect(next.semanticChecks!.allowedTerminals).toEqual(['external.stripe', 'datastore.postgres', 'datastore.redis', 'entity.user', 'entity.product', 'ds.cache']);
    expect(next.semanticChecks!.allowedRoots).toEqual(['actor.user', 'entity.user']);
  });

  it('lets a new source join the allowed roots', () => {
    const m = base();
    const next = ok(applyEditOps(m, [
      op(m, { op: 'add', target: 'actor.admin', patch: { id: 'actor.admin', kind: 'actor', label: 'Admin', provenance: 'proposed' } }),
      op(m, { op: 'add', target: 'e.admin-api', patch: { id: 'e.admin-api', from: 'actor.admin', to: 'gateway.api', type: 'sync', provenance: 'proposed' } }),
    ]));
    expect(next.semanticChecks!.allowedRoots).toEqual(['actor.user', 'entity.user', 'actor.admin']);
    expect(next.semanticChecks!.allowedTerminals).not.toContain('actor.admin');
  });

  it('lists an unconnected new component in both', () => {
    const m = base();
    const next = ok(applyEditOps(m, [op(m, { op: 'add', target: 'svc.audit', patch: { id: 'svc.audit', kind: 'service', label: 'Audit', provenance: 'proposed' } })]));
    expect(next.semanticChecks!.allowedRoots).toContain('svc.audit');
    expect(next.semanticChecks!.allowedTerminals).toContain('svc.audit');
  });

  it('does not create checks on a model that has none', () => {
    const m = structuredClone(validFullModel);
    const next = ok(applyEditOps(m, [op(m, { op: 'add', target: 'svc.audit', patch: { id: 'svc.audit', kind: 'service', label: 'Audit', provenance: 'proposed' } })]));
    expect(next.semanticChecks ?? null).toBeNull();
  });

  it('leaves an inactive (empty) list empty', () => {
    const m = base();
    m.semanticChecks!.allowedRoots = [];
    const next = ok(applyEditOps(m, [op(m, { op: 'add', target: 'svc.audit', patch: { id: 'svc.audit', kind: 'service', label: 'Audit', provenance: 'proposed' } })]));
    expect(next.semanticChecks!.allowedRoots).toEqual([]);
    expect(next.semanticChecks!.allowedTerminals).toContain('svc.audit');
  });
});

describe('removing components and links', () => {
  it('removes a sequence participant with its messages, renumbers them and drops an emptied fragment', () => {
    const m = base();
    const next = ok(applyEditOps(m, removeAll(m, 'external.stripe')));
    expect(next.views.find(v => v.id === 'view.sequence')!.sequence).toEqual({
      participants: ['actor.user', 'gateway.api', 'svc.orders'],
      messages: [
        { seq: 1, from: 'actor.user', to: 'gateway.api', label: 'POST /orders', kind: 'call' },
        { seq: 2, from: 'gateway.api', to: 'svc.orders', label: 'createOrder', kind: 'call' },
        { seq: 3, from: 'svc.orders', to: 'gateway.api', label: 'order confirmation', kind: 'return' },
      ],
    });
    expect(next.semanticChecks!.allowedTerminals).not.toContain('external.stripe');
  });

  it('cascades a component removal through checks, chapters, boundaries, main path and sequence', () => {
    const m = base();
    const next = ok(applyEditOps(m, removeAll(m, 'gateway.api')));
    expect(next.semanticChecks!.requiredEdges).toEqual([]);
    expect(next.semanticChecks!.requiredPaths).toEqual([]);
    expect(next.semanticChecks!.allowedRoots).toEqual(['actor.user', 'entity.user', 'svc.orders', 'svc.catalog']);
    expect(next.semanticChecks!.allowedTerminals).toContain('actor.user');
    expect(next.guidedViews).toEqual([{ ...m.guidedViews[0]!, focus: ['actor.user', 'svc.orders'] }]);
    expect(next.boundaries).toEqual([{ id: 'b.core', label: 'Core platform', wraps: ['svc.orders', 'svc.catalog'] }]);
    expect(next.views.find(v => v.id === 'view.architecture')!.mainPath ?? null).toBeNull();
    expect(next.views.find(v => v.id === 'view.sequence')!.sequence).toEqual({
      participants: ['actor.user', 'svc.orders', 'external.stripe'],
      messages: [
        { seq: 1, from: 'svc.orders', to: 'external.stripe', label: 'charge', kind: 'call', fragment: { type: 'alt', covers: [1, 2] } },
        { seq: 2, from: 'external.stripe', to: 'svc.orders', label: 'payment result', kind: 'return' },
      ],
    });
    expect(validateModel(JSON.parse(JSON.stringify(next))).ok).toBe(true);
  });

  it('follows the request when a generated required link is removed', () => {
    const m = base();
    const next = ok(applyEditOps(m, [op(m, { op: 'remove', target: 'e.user-api', patch: {} })]));
    expect(next.semanticChecks!.requiredEdges).toEqual([]);
    expect(next.semanticChecks!.requiredPaths).toEqual([]);
    expect(next.semanticChecks!.allowedRoots).toContain('gateway.api');
    expect(next.semanticChecks!.allowedTerminals).toContain('actor.user');
    expect(next.views.find(v => v.id === 'view.architecture')!.mainPath ?? null).toBeNull();
  });

  it('keeps root checking active when the only listed root is removed', () => {
    const m = base();
    m.semanticChecks!.allowedRoots = ['actor.user'];
    m.nodes = m.nodes.filter(n => n.kind !== 'entity');
    m.edges = m.edges.filter(e => !e.id.startsWith('er.'));
    m.views = m.views.filter(v => v.type !== 'er');
    m.semanticChecks!.allowedTerminals = m.semanticChecks!.allowedTerminals.filter(id => !id.startsWith('entity.'));
    const next = ok(applyEditOps(m, removeAll(m, 'actor.user')));
    expect(next.semanticChecks!.allowedRoots).toEqual(['gateway.api']);
  });

  it('keeps a required path that is still reachable another way', () => {
    const m = base();
    const next = ok(applyEditOps(m, [op(m, { op: 'remove', target: 'e.orders-pg', patch: {} })]));
    expect(next.semanticChecks!.requiredPaths).toEqual([{ from: 'actor.user', to: 'datastore.postgres' }]);
  });

  it('keeps an edge requirement in step when its link is retyped', () => {
    const m = base();
    const next = ok(applyEditOps(m, [op(m, { op: 'update', target: 'e.user-api', patch: { type: 'async' } })]));
    expect(next.semanticChecks!.requiredEdges).toEqual([{ from: 'actor.user', to: 'gateway.api', type: 'async' }]);
  });

  it('keeps a still-valid main path and chapter untouched', () => {
    const m = base();
    const next = ok(applyEditOps(m, removeAll(m, 'datastore.redis')));
    expect(next.views.find(v => v.id === 'view.architecture')!.mainPath).toEqual(['actor.user', 'gateway.api', 'svc.orders']);
    expect(next.guidedViews).toEqual(m.guidedViews);
  });

  it('drops a chapter and a boundary that lose every member', () => {
    const m = base();
    m.semanticChecks = null;
    m.guidedViews = [{ id: 'gv.pay', label: 'Payments', focus: ['external.stripe'] }];
    m.boundaries = [{ id: 'b.ext', label: 'Third parties', wraps: ['external.stripe'] }];
    const next = ok(applyEditOps(m, removeAll(m, 'external.stripe')));
    expect(next.guidedViews).toEqual([]);
    expect(next.boundaries).toEqual([]);
  });

  it('moves a fragment to its first surviving message when its carrier is removed', () => {
    const m = base();
    const seq = m.views.find(v => v.id === 'view.sequence')!.sequence!;
    seq.messages[2]!.fragment = { type: 'loop', covers: [3, 4, 5] };
    const next = ok(applyEditOps(m, removeAll(m, 'external.stripe')));
    expect(next.views.find(v => v.id === 'view.sequence')!.sequence!.messages[2]).toEqual({ seq: 3, from: 'svc.orders', to: 'gateway.api', label: 'order confirmation', kind: 'return', fragment: { type: 'loop', covers: [3] } });
  });

  it('drops a sequence view that loses every participant', () => {
    const m = base();
    m.semanticChecks = null;
    m.views.push({ id: 'view.pay', type: 'sequence', nodes: ['external.stripe'], edges: [], sequence: { participants: ['external.stripe'], messages: [] } });
    const next = ok(applyEditOps(m, removeAll(m, 'external.stripe')));
    expect(next.views.some(v => v.id === 'view.pay')).toBe(false);
  });

  it('clears an open question that was blocked by a removed link', () => {
    const m = base();
    m.openQuestions.push({ id: 'oq-2', text: 'Is the Stripe call retried?', blockedBy: 'e.orders-stripe' });
    const next = ok(applyEditOps(m, removeAll(m, 'external.stripe')));
    expect(next.openQuestions.find(q => q.id === 'oq-2')).toEqual({ id: 'oq-2', text: 'Is the Stripe call retried?' });
  });
});

describe('source-backed requirements stay protected', () => {
  it('refuses removing a required link backed by source evidence', () => {
    const m = sourceBacked(base(), 'e.user-api');
    expect(refused(applyEditOps(m, [op(m, { op: 'remove', target: 'e.user-api', patch: {} })]))).toBe('Customer → API Gateway is backed by source evidence and can\'t be removed by refinement.');
  });

  it('refuses retyping a required link backed by source evidence', () => {
    const m = sourceBacked(base(), 'e.user-api');
    expect(refused(applyEditOps(m, [op(m, { op: 'update', target: 'e.user-api', patch: { type: 'async' } })]))).toMatch(/Customer → API Gateway is backed by source evidence/);
  });

  it('refuses breaking a required path between source-backed components', () => {
    const m = sourceBacked(base(), 'actor.user', 'datastore.postgres');
    const r = applyEditOps(m, [op(m, { op: 'remove', target: 'e.orders-pg', patch: {} }), op(m, { op: 'remove', target: 'e.catalog-pg', patch: {} })]);
    expect(refused(r)).toBe('The path Customer → PostgreSQL is backed by source evidence and can\'t be broken by refinement.');
  });

  it('still allows ordinary edits on a source-backed model', () => {
    const m = sourceBacked(base(), 'e.user-api', 'actor.user', 'datastore.postgres');
    ok(applyEditOps(m, [op(m, { op: 'remove', target: 'e.orders-redis', patch: {} })]));
  });
});

describe('every component can be removed unless source evidence forbids it', () => {
  it('removes each component of a generated model with its links', () => {
    const m = base();
    for (const n of m.nodes) {
      const r = applyEditOps(m, removeAll(m, n.id));
      expect(r.ok, `${n.id}: ${r.ok ? '' : r.errors.join('; ')}`).toBe(true);
    }
  });

  it('refuses only for source evidence on a fully source-backed model', () => {
    const m = sourceBacked(base(), ...validFullModelExtended.nodes.map(n => n.id), ...validFullModelExtended.edges.map(e => e.id));
    let refusedCount = 0;
    for (const n of m.nodes) {
      const r = applyEditOps(m, removeAll(m, n.id));
      if (!r.ok) { refusedCount++; for (const e of r.errors) expect(e).toMatch(/is backed by source evidence/); }
    }
    expect(refusedCount).toBeGreaterThan(0);
  });
});

describe('undo and persistence', () => {
  it('undo restores every structure exactly', () => {
    const m = base();
    const next = ok(applyEditOps(m, removeAll(m, 'gateway.api')));
    expect({ ...undoTo(next, m), revision: m.revision, parentId: m.parentId }).toEqual(m);
  });

  it('round-trips reconciled models through the schema', () => {
    const m = base();
    const next = ok(applyEditOps(m, removeAll(m, 'external.stripe')));
    expect(SystemModelSchema.parse(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
});

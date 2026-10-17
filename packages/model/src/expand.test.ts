import { describe, expect, it } from 'vitest';
import { applyExpansion, detailDrift, expandBlocker, type Expansion } from './expand';
import { internalsOf, isInternal } from './groups';
import { detailMembership, openDetailView } from './detail';
import { applyEditOps, undoTo } from './edit';
import { validFullModel, validFullModelExtended } from './fixtures';
import { SystemModelSchema, type EditOp, type SystemModel } from './schema';
import { validateModel } from './validate';

const base = (): SystemModel => structuredClone(validFullModelExtended);
const ok = (r: { ok: true; model: SystemModel } | { ok: false; errors: string[] }): SystemModel => {
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.model;
};
const fails = (r: { ok: true; model: SystemModel } | { ok: false; errors: string[] }): string => {
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.errors.join('\n');
};
/** Order Service: gateway.api→svc.orders sync; svc.orders→datastore.postgres data; svc.orders→external.stripe sync. */
const valid = (): Expansion => ({
  internals: [{ key: 'intake', label: 'Order Intake' }, { key: 'payments', label: 'Payments' }, { key: 'store', label: 'Order Store' }],
  links: [
    { from: 'gateway.api', to: 'intake', type: 'sync', label: 'submit order' },
    { from: 'intake', to: 'payments', type: 'sync' },
    { from: 'payments', to: 'external.stripe', type: 'sync', label: 'charge' },
    { from: 'intake', to: 'store', type: 'data' },
    { from: 'store', to: 'datastore.postgres', type: 'data' },
  ],
});
const op = (model: SystemModel, o: Omit<EditOp, 'baseRevision' | 'summary'>): EditOp => ({ ...o, baseRevision: model.revision, summary: 'test' });

describe('applying a valid expansion', () => {
  it('adds server-built inferred internals and links as one valid revision and opens the detail view', () => {
    const before = base();
    const after = ok(applyExpansion(before, 'svc.orders', valid()));
    expect(after.revision).toBe(2);
    expect(after.nodes.slice(-3)).toEqual([
      { id: 'svc.orders/intake', kind: 'component', label: 'Order Intake', provenance: 'inferred', evidence: [], group: 'svc.orders' },
      { id: 'svc.orders/payments', kind: 'component', label: 'Payments', provenance: 'inferred', evidence: [], group: 'svc.orders' },
      { id: 'svc.orders/store', kind: 'component', label: 'Order Store', provenance: 'inferred', evidence: [], group: 'svc.orders' },
    ]);
    expect(after.edges.slice(-5)).toEqual([
      { id: 'svc.orders/link-1', from: 'gateway.api', to: 'svc.orders/intake', type: 'sync', label: 'submit order', provenance: 'inferred', evidence: [] },
      { id: 'svc.orders/link-2', from: 'svc.orders/intake', to: 'svc.orders/payments', type: 'sync', provenance: 'inferred', evidence: [] },
      { id: 'svc.orders/link-3', from: 'svc.orders/payments', to: 'external.stripe', type: 'sync', label: 'charge', provenance: 'inferred', evidence: [] },
      { id: 'svc.orders/link-4', from: 'svc.orders/intake', to: 'svc.orders/store', type: 'data', provenance: 'inferred', evidence: [] },
      { id: 'svc.orders/link-5', from: 'svc.orders/store', to: 'datastore.postgres', type: 'data', provenance: 'inferred', evidence: [] },
    ]);
    expect(after.views.find(v => v.id === 'detail:svc.orders')).toMatchObject({
      nodes: ['svc.orders/intake', 'svc.orders/payments', 'svc.orders/store', 'gateway.api', 'datastore.postgres', 'external.stripe'],
      edges: ['svc.orders/link-1', 'svc.orders/link-2', 'svc.orders/link-3', 'svc.orders/link-4', 'svc.orders/link-5'],
    });
    expect(validateModel(JSON.parse(JSON.stringify(after))).ok).toBe(true);
  });

  it('leaves the architecture overview, sequence and ER views and the semantic checks untouched', () => {
    const before = base();
    const after = ok(applyExpansion(before, 'svc.orders', valid()));
    expect(after.views.filter(v => !v.id.startsWith('detail:'))).toEqual(before.views);
    expect(after.semanticChecks).toEqual(before.semanticChecks);
    expect(after.boundaries).toEqual(before.boundaries);
  });

  it('reuses an already open detail view instead of adding a second one', () => {
    const opened = ok(openDetailView(base(), 'svc.orders'));
    const after = ok(applyExpansion(opened, 'svc.orders', valid()));
    expect(after.views.filter(v => v.id === 'detail:svc.orders')).toHaveLength(1);
  });

  it('trims labels and omits empty link labels', () => {
    const e = valid();
    e.internals[0]!.label = '  Order Intake  ';
    e.links[1]!.label = '   ';
    const after = ok(applyExpansion(base(), 'svc.orders', e));
    expect(after.nodes.find(n => n.id === 'svc.orders/intake')!.label).toBe('Order Intake');
    expect(after.edges.find(x => x.id === 'svc.orders/link-2')).not.toHaveProperty('label');
  });

  it('builds ids that never collide with existing nodes or edges', () => {
    const m = base();
    m.semanticChecks = null;
    m.nodes.push({ id: 'svc.orders/intake', kind: 'service', label: 'Legacy', provenance: 'proposed', evidence: [] });
    m.edges.push({ id: 'svc.orders/link-1', from: 'svc.orders/intake', to: 'svc.catalog', type: 'sync', provenance: 'proposed', evidence: [] });
    m.views[0]!.nodes.push('svc.orders/intake');
    m.views[0]!.edges.push('svc.orders/link-1');
    const after = ok(applyExpansion(m, 'svc.orders', valid()));
    expect(after.nodes.filter(n => n.group === 'svc.orders').map(n => n.id)).toEqual(['svc.orders/intake-2', 'svc.orders/payments', 'svc.orders/store']);
    expect(after.edges.filter(e => e.id.startsWith('svc.orders/link-')).map(e => e.id)).toEqual(['svc.orders/link-1', 'svc.orders/link-2', 'svc.orders/link-3', 'svc.orders/link-4', 'svc.orders/link-5', 'svc.orders/link-6']);
  });

  it('covers a self-loop on the focus with an internal link of the same type', () => {
    const m = base();
    m.edges.push({ id: 'e.retry', from: 'svc.orders', to: 'svc.orders', type: 'async', provenance: 'proposed', evidence: [] });
    expect(fails(applyExpansion(m, 'svc.orders', valid()))).toMatch(/e\.retry.*async link between two internals/);
    const e = valid();
    e.links.push({ from: 'payments', to: 'intake', type: 'async', label: 'retry' });
    ok(applyExpansion(m, 'svc.orders', e));
  });
});

describe('expansion rules', () => {
  const cases: [string, (e: Expansion) => void, RegExp][] = [
    ['fewer than two internals', e => { e.internals = e.internals.slice(0, 1); e.links = [{ from: 'gateway.api', to: 'intake', type: 'sync' }]; }, /internals/],
    ['more than eight internals', e => { for (let i = 0; i < 6; i++) e.internals.push({ key: `extra-${i}`, label: `Extra ${i}` }); }, /internals/],
    ['a malformed key', e => { e.internals[0]!.key = 'Order Intake'; }, /key/],
    ['duplicate keys', e => { e.internals[1]!.key = 'intake'; }, /duplicate key "intake"/],
    ['an empty label', e => { e.internals[0]!.label = '   '; }, /label/],
    ['a label over 60 characters', e => { e.internals[0]!.label = 'x'.repeat(61); }, /label/],
    ['duplicate labels', e => { e.internals[1]!.label = 'order intake'; }, /duplicate label "order intake"/i],
    ['a label equal to the focus', e => { e.internals[0]!.label = 'Order Service'; }, /same name as Order Service/],
    ['a label equal to a neighbour', e => { e.internals[1]!.label = 'Stripe'; }, /same name as the neighbour Stripe/],
    ['a link label over 80 characters', e => { e.links[0]!.label = 'x'.repeat(81); }, /label/],
    ['an unknown endpoint', e => { e.links[1]!.to = 'mystery'; }, /"mystery" is neither an internal key nor a neighbour of Order Service/],
    ['a link between two neighbours', e => { e.links.push({ from: 'gateway.api', to: 'external.stripe', type: 'sync' }); }, /must start or end at an internal/],
    ['an internal self-loop', e => { e.links.push({ from: 'payments', to: 'payments', type: 'sync' }); }, /self-loop/],
    ['a duplicate link', e => { e.links.push({ from: 'intake', to: 'payments', type: 'sync' }); }, /duplicate link "intake"→"payments" \(sync\)/],
    ['an outward link the focus does not have', e => { e.links.push({ from: 'store', to: 'svc.catalog', type: 'sync' }); }, /"svc\.catalog" is neither/],
    ['an outward link of the wrong type', e => { e.links[4]!.type = 'sync'; }, /no sync link from Order Service to "datastore\.postgres"/],
    ['an inward link in the wrong direction', e => { e.links[0] = { from: 'intake', to: 'gateway.api', type: 'sync' }; }, /no sync link from Order Service to "gateway\.api"/],
    ['an inward link from a neighbour that only receives from the focus', e => { e.links.push({ from: 'external.stripe', to: 'payments', type: 'sync' }); }, /no sync link from "external\.stripe" to Order Service/],
    ['an inward link of the wrong type', e => { e.links.push({ from: 'gateway.api', to: 'payments', type: 'async' }); }, /no async link from "gateway\.api" to Order Service/],
    ['an uncovered focus link', e => { e.links = e.links.filter(l => l.to !== 'external.stripe'); e.links.push({ from: 'payments', to: 'store', type: 'data' }); }, /e\.orders-stripe.*not covered: add a sync link from an internal to "external\.stripe"/],
    ['an internal without an incoming link when roots are checked', e => { e.links = e.links.filter(l => l.from !== 'intake' || l.to !== 'store'); e.links.push({ from: 'store', to: 'payments', type: 'sync' }); }, /"store" needs an incoming link/],
    ['an internal without an outgoing link when terminals are checked', e => { e.links = e.links.filter(l => l.to !== 'datastore.postgres'); e.links.push({ from: 'payments', to: 'datastore.postgres', type: 'data' }); }, /"store" needs an outgoing link/],
  ];
  it.each(cases)('rejects %s with an actionable message', (_name, mutate, message) => {
    const e = valid();
    mutate(e);
    expect(fails(applyExpansion(base(), 'svc.orders', e))).toMatch(message);
  });

  it('does not require incoming or outgoing links when the model has no root or terminal checks', () => {
    const m = structuredClone(validFullModel);
    const e = valid();
    e.links.push({ from: 'payments', to: 'store', type: 'data' });
    e.internals.push({ key: 'audit', label: 'Audit Log' });
    e.links.push({ from: 'intake', to: 'audit', type: 'async' });
    ok(applyExpansion(m, 'svc.orders', e));
  });

  it.each([
    ['not an object', 'internals please'],
    ['extra properties', { ...valid(), notes: 'x' }],
    ['a non-enum link type', { ...valid(), links: [{ from: 'gateway.api', to: 'intake', type: 'calls' }] }],
    ['more than 40 links', { ...valid(), links: Array.from({ length: 41 }, () => ({ from: 'intake', to: 'payments', type: 'sync' })) }],
  ])('rejects a response that is %s', (_name, raw) => {
    expect(fails(applyExpansion(base(), 'svc.orders', raw))).not.toBe('');
  });

  it('never lets the provider choose ids, kinds, provenance or evidence', () => {
    const e = valid() as unknown as { internals: Record<string, unknown>[] };
    e.internals[0]!.provenance = 'source-supported';
    expect(fails(applyExpansion(base(), 'svc.orders', e))).toMatch(/provenance|Unrecognized/i);
  });

  it('does not modify the input model', () => {
    const m = base();
    const before = structuredClone(m);
    applyExpansion(m, 'svc.orders', valid());
    expect(m).toEqual(before);
  });
});

describe('which components can be expanded', () => {
  it.each([
    ['an unknown component', 'svc.missing', /unknown/],
    ['an ER entity', 'entity.order', /entity/],
  ])('refuses %s', (_name, id, message) => {
    expect(expandBlocker(base(), id)).toMatch(message);
  });

  it('refuses an already expanded component and an internal, bounding nesting to one level', () => {
    const m = ok(applyExpansion(base(), 'svc.orders', valid()));
    expect(expandBlocker(m, 'svc.orders')).toMatch(/already has inferred internals/);
    expect(expandBlocker(m, 'svc.orders/intake')).toMatch(/already part of Order Service/);
  });

  it('refuses before inference when a new detail view would exceed the limit', () => {
    let m = base();
    m.semanticChecks = null;
    for (let i = 0; i < 12; i++) { m.nodes.push({ id: `svc.n${i}`, kind: 'service', label: `N${i}`, provenance: 'proposed', evidence: [] }); m = ok(openDetailView(m, `svc.n${i}`)); }
    expect(expandBlocker(m, 'svc.orders')).toMatch(/at most 12 detail views/);
    expect(expandBlocker(m, 'svc.n0')).toBeNull();
  });

  it('allows an ordinary component', () => {
    expect(expandBlocker(base(), 'svc.orders')).toBeNull();
  });
});

describe('internals after expansion', () => {
  const expanded = () => ok(applyExpansion(base(), 'svc.orders', valid()));

  it('identifies internals by group and absence from the overview', () => {
    const m = expanded();
    expect(internalsOf(m, 'svc.orders').map(n => n.id)).toEqual(['svc.orders/intake', 'svc.orders/payments', 'svc.orders/store']);
    expect(isInternal(m, 'svc.orders/intake')).toBe(true);
    expect(isInternal(m, 'svc.orders')).toBe(false);
  });

  it('treats a grouped node that is in the overview as an ordinary component', () => {
    const m = base();
    m.nodes.find(n => n.id === 'svc.catalog')!.group = 'svc.orders';
    expect(isInternal(m, 'svc.catalog')).toBe(false);
    expect(internalsOf(m, 'svc.orders')).toEqual([]);
  });

  it('refuses to remove a component while its internals exist', () => {
    const m = expanded();
    const removeEdges = m.edges.filter(e => e.from === 'svc.orders' || e.to === 'svc.orders').map(e => op(m, { op: 'remove', target: e.id, patch: {} }));
    const r = applyEditOps(m, [...removeEdges, op(m, { op: 'remove', target: 'svc.orders', patch: {} })]);
    expect(fails(r)).toMatch(/still referenced by: .*internal svc\.orders\/intake/);
  });

  it('keeps internals added by refinement out of the overview', () => {
    const m = expanded();
    m.semanticChecks = null;
    const next = ok(applyEditOps(m, [op(m, { op: 'add', target: 'svc.orders/audit', patch: { id: 'svc.orders/audit', kind: 'component', label: 'Audit', provenance: 'proposed', group: 'svc.orders' } })]));
    expect(next.views[0]!.nodes).not.toContain('svc.orders/audit');
    expect(next.views.find(v => v.id === 'detail:svc.orders')!.nodes).toContain('svc.orders/audit');
  });

  it('still auto-joins ordinary new components to the overview', () => {
    const m = expanded();
    m.semanticChecks = null;
    const next = ok(applyEditOps(m, [op(m, { op: 'add', target: 'svc.cache', patch: { id: 'svc.cache', kind: 'service', label: 'Cache', provenance: 'proposed', group: 'not-a-node' } })]));
    expect(next.views[0]!.nodes).toContain('svc.cache');
  });

  it('keeps a neighbour\'s detail view at overview level, ignoring links to another component\'s internals', () => {
    const m = ok(openDetailView(expanded(), 'external.stripe'));
    expect(m.views.find(v => v.id === 'detail:external.stripe')).toMatchObject({ nodes: ['external.stripe', 'svc.orders'], edges: ['e.orders-stripe'] });
  });

  it('shows every link of an internal in the internal\'s own detail view', () => {
    const m = ok(openDetailView(expanded(), 'svc.orders/payments'));
    expect(m.views.find(v => v.id === 'detail:svc.orders/payments')).toMatchObject({ nodes: ['svc.orders/payments', 'svc.orders/intake', 'external.stripe'], edges: ['svc.orders/link-2', 'svc.orders/link-3'] });
  });

  it('falls back to the plain detail membership when every internal is removed', () => {
    let m = expanded();
    const ids = m.edges.filter(e => e.id.startsWith('svc.orders/link-')).map(e => e.id);
    m = ok(applyEditOps(m, [...ids.map(id => op(m, { op: 'remove', target: id, patch: {} })), ...['intake', 'payments', 'store'].map(k => op(m, { op: 'remove', target: `svc.orders/${k}`, patch: {} }))]));
    expect(m.views.find(v => v.id === 'detail:svc.orders')).toMatchObject(detailMembership(m, 'svc.orders'));
    expect(m.views.find(v => v.id === 'detail:svc.orders')!.nodes[0]).toBe('svc.orders');
  });

  it('undo removes the internals in a forward revision', () => {
    const before = base();
    const after = ok(applyExpansion(before, 'svc.orders', valid()));
    const undone = undoTo(after, before);
    expect(internalsOf(undone, 'svc.orders')).toEqual([]);
    expect(validateModel(undone).ok).toBe(true);
  });

  it('round-trips through JSON and the schema unchanged', () => {
    const m = expanded();
    expect(SystemModelSchema.parse(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });
});

describe('drift between the overview and the internals', () => {
  it('reports nothing right after expansion', () => {
    expect(detailDrift(ok(applyExpansion(base(), 'svc.orders', valid())), 'svc.orders')).toEqual({ uncovered: [], unbacked: [] });
  });

  it('names a new focus link no internal covers', () => {
    let m = ok(applyExpansion(base(), 'svc.orders', valid()));
    m = ok(applyEditOps(m, [op(m, { op: 'add', target: 'e.orders-redis-2', patch: { id: 'e.orders-redis-2', from: 'svc.orders', to: 'datastore.redis', type: 'data', provenance: 'proposed' } })]));
    expect(detailDrift(m, 'svc.orders').uncovered.map(e => e.id)).toEqual(['e.orders-redis-2']);
    expect(m.views.find(v => v.id === 'detail:svc.orders')!.nodes).toContain('datastore.redis');
  });

  it('names internal links the overview no longer backs and keeps their endpoints drawable', () => {
    let m = ok(applyExpansion(base(), 'svc.orders', valid()));
    m = ok(applyEditOps(m, [op(m, { op: 'remove', target: 'e.orders-stripe', patch: {} })]));
    expect(detailDrift(m, 'svc.orders').unbacked.map(e => e.id)).toEqual(['svc.orders/link-3']);
    const view = m.views.find(v => v.id === 'detail:svc.orders')!;
    expect(view.nodes).toContain('external.stripe');
    expect(view.edges).toContain('svc.orders/link-3');
  });
});

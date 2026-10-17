import { describe, expect, it } from 'vitest';
import { closeDetailView, detailMembership, detailViewId, isDetailView, MAX_DETAIL_VIEWS, openDetailView, syncDetailViews } from './detail';
import { applyEditOps, orientArchitecture, undoTo } from './edit';
import { validFullModel } from './fixtures';
import { SystemModelSchema, type EditOp, type SystemModel, type View } from './schema';
import { validateModel } from './validate';

const base = (): SystemModel => structuredClone(validFullModel);
const ok = (r: { ok: true; model: SystemModel } | { ok: false; errors: string[] }): SystemModel => {
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.model;
};
const opened = (model: SystemModel, id: string) => ok(openDetailView(model, id));
const detail = (model: SystemModel, focus: string) => model.views.find(v => v.id === `detail:${focus}`);
const op = (model: SystemModel, o: Omit<EditOp, 'baseRevision' | 'summary'>): EditOp => ({ ...o, baseRevision: model.revision, summary: 'test' });

describe('detail membership', () => {
  it('holds the focus first, then direct neighbours in edge order, and every edge touching the focus', () => {
    expect(detailMembership(base(), 'svc.orders')).toEqual({
      nodes: ['svc.orders', 'gateway.api', 'datastore.postgres', 'external.stripe'],
      edges: ['e.api-orders', 'e.orders-pg', 'e.orders-stripe'],
    });
    expect(detailMembership(base(), 'gateway.api')).toEqual({
      nodes: ['gateway.api', 'actor.user', 'svc.orders', 'svc.catalog'],
      edges: ['e.user-api', 'e.api-orders', 'e.api-catalog'],
    });
  });

  it('leaves out links between neighbours that do not touch the focus', () => {
    expect(detailMembership(base(), 'datastore.postgres').edges).toEqual(['e.orders-pg', 'e.catalog-pg']);
  });

  it('shows an unconnected component on its own', () => {
    const m = base();
    m.nodes.push({ id: 'svc.lonely', kind: 'service', label: 'Lonely', provenance: 'proposed', evidence: [] });
    expect(detailMembership(m, 'svc.lonely')).toEqual({ nodes: ['svc.lonely'], edges: [] });
  });

  it('includes a self-loop once without repeating the focus', () => {
    const m = base();
    m.edges.push({ id: 'e.retry', from: 'svc.orders', to: 'svc.orders', type: 'async', provenance: 'proposed', evidence: [] });
    expect(detailMembership(m, 'svc.orders')).toEqual({
      nodes: ['svc.orders', 'gateway.api', 'datastore.postgres', 'external.stripe'],
      edges: ['e.api-orders', 'e.orders-pg', 'e.orders-stripe', 'e.retry'],
    });
  });

  it('lists a neighbour once when several links reach it', () => {
    const m = base();
    m.edges.push({ id: 'e.orders-pg-2', from: 'datastore.postgres', to: 'svc.orders', type: 'data', provenance: 'proposed', evidence: [] });
    expect(detailMembership(m, 'svc.orders')).toEqual({
      nodes: ['svc.orders', 'gateway.api', 'datastore.postgres', 'external.stripe'],
      edges: ['e.api-orders', 'e.orders-pg', 'e.orders-stripe', 'e.orders-pg-2'],
    });
  });
});

describe('opening a detail view', () => {
  it('appends one auto-arranged component-detail view as a new valid revision', () => {
    const before = base();
    const after = opened(before, 'svc.orders');
    expect(after.revision).toBe(2);
    expect(after.parentId).toBe(1);
    expect(after.views.map(v => v.id)).toEqual(['view.architecture', 'view.sequence', 'view.er', 'detail:svc.orders']);
    expect(after.views.at(-1)).toEqual({
      id: 'detail:svc.orders', type: 'component-detail', focus: 'svc.orders', orientation: 'TB',
      nodes: ['svc.orders', 'gateway.api', 'datastore.postgres', 'external.stripe'],
      edges: ['e.api-orders', 'e.orders-pg', 'e.orders-stripe'],
    });
    expect({ ...after, revision: 1, parentId: before.parentId, views: before.views }).toEqual(before);
    expect(validateModel(JSON.parse(JSON.stringify(after))).ok).toBe(true);
  });

  it('returns the same model without a new revision when the view already exists', () => {
    const once = opened(base(), 'svc.orders');
    expect(openDetailView(once, 'svc.orders')).toEqual({ ok: true, model: once });
  });

  it.each([
    ['an ER entity, whose fields are already its detail', 'entity.order', /entity/i],
    ['an unknown component', 'svc.missing', /unknown/i],
  ])('refuses %s', (_name, id, message) => {
    const r = openDetailView(base(), id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(message);
  });

  it('refuses when another kind of view already uses the detail id', () => {
    const m = base();
    m.views.push({ id: 'detail:svc.orders', type: 'architecture', nodes: ['svc.orders'], edges: [] });
    const r = openDetailView(m, 'svc.orders');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/already uses/);
  });

  it(`allows at most ${MAX_DETAIL_VIEWS} detail views but still reopens an existing one at the limit`, () => {
    let m = base();
    for (let i = 0; i < 13; i++) m.nodes.push({ id: `svc.n${i}`, kind: 'service', label: `N${i}`, provenance: 'proposed', evidence: [] });
    for (let i = 0; i < 12; i++) m = opened(m, `svc.n${i}`);
    expect(m.views.filter(isDetailView)).toHaveLength(12);
    const refused = openDetailView(m, 'svc.n12');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors.join(' ')).toMatch(/12 detail views/);
    expect(openDetailView(m, 'svc.n3')).toEqual({ ok: true, model: m });
  });
});

describe('closing a detail view', () => {
  it('removes only that view as a new revision and leaves the component in place', () => {
    const open = opened(opened(base(), 'svc.orders'), 'gateway.api');
    const closed = ok(closeDetailView(open, 'detail:svc.orders'));
    expect(closed.revision).toBe(open.revision + 1);
    expect(closed.views.map(v => v.id)).toEqual(['view.architecture', 'view.sequence', 'view.er', 'detail:gateway.api']);
    expect(closed.nodes).toEqual(open.nodes);
  });

  it.each([
    ['a base view', 'view.architecture'],
    ['an unknown view', 'detail:svc.catalog'],
  ])('refuses %s', (_name, viewId) => {
    expect(closeDetailView(opened(base(), 'svc.orders'), viewId).ok).toBe(false);
  });
});

describe('keeping detail views truthful through edits', () => {
  it('adds a new link and neighbour to the detail view in the same revision', () => {
    const m = opened(base(), 'svc.orders');
    const next = ok(applyEditOps(m, [op(m, { op: 'add', target: 'e.orders-redis-2', patch: { id: 'e.orders-redis-2', from: 'svc.orders', to: 'datastore.redis', type: 'data', provenance: 'proposed' } })]));
    expect(detail(next, 'svc.orders')).toMatchObject({
      nodes: ['svc.orders', 'gateway.api', 'datastore.postgres', 'external.stripe', 'datastore.redis'],
      edges: ['e.api-orders', 'e.orders-pg', 'e.orders-stripe', 'e.orders-redis-2'],
    });
  });

  it('drops a removed link and a neighbour that is no longer connected', () => {
    const m = opened(base(), 'svc.orders');
    const next = ok(applyEditOps(m, [op(m, { op: 'remove', target: 'e.orders-stripe', patch: {} })]));
    expect(detail(next, 'svc.orders')).toMatchObject({ nodes: ['svc.orders', 'gateway.api', 'datastore.postgres'], edges: ['e.api-orders', 'e.orders-pg'] });
  });

  it('removes the detail view when its component is removed', () => {
    let m = opened(base(), 'datastore.redis');
    m = ok(applyEditOps(m, [op(m, { op: 'remove', target: 'e.orders-redis', patch: {} }), op(m, { op: 'remove', target: 'datastore.redis', patch: {} })]));
    expect(m.views.some(isDetailView)).toBe(false);
    expect(validateModel(m).ok).toBe(true);
  });

  it('removes the detail view when its component becomes an ER entity', () => {
    const m = opened(base(), 'svc.catalog');
    const next = ok(applyEditOps(m, [op(m, { op: 'update', target: 'svc.catalog', patch: { kind: 'entity' } })]));
    expect(detail(next, 'svc.catalog')).toBeUndefined();
  });

  it('keeps the view and its id when the component is renamed', () => {
    const m = opened(base(), 'svc.orders');
    const next = ok(applyEditOps(m, [op(m, { op: 'update', target: 'svc.orders', patch: { label: 'Order Service' } })]));
    expect(detail(next, 'svc.orders')).toEqual(detail(m, 'svc.orders'));
  });

  it('follows the architecture direction', () => {
    const m = opened(base(), 'svc.orders');
    const lr = ok(orientArchitecture(m, 'view.architecture', 'LR'));
    expect(lr.revision).toBe(m.revision + 1);
    expect(detail(lr, 'svc.orders')?.orientation).toBe('LR');
  });

  it('never rewrites generated component-detail views', () => {
    const m = base();
    const generated: View = { id: 'view.component', type: 'component-detail', focus: 'svc.orders', nodes: ['svc.orders', 'datastore.postgres'], edges: ['e.orders-pg'] };
    m.views.push(generated);
    const next = ok(applyEditOps(m, [op(m, { op: 'add', target: 'e.orders-redis-2', patch: { id: 'e.orders-redis-2', from: 'svc.orders', to: 'datastore.redis', type: 'data', provenance: 'proposed' } })]));
    expect(next.views.find(v => v.id === 'view.component')).toEqual(generated);
    expect(isDetailView(generated)).toBe(false);
  });

  it('only treats a view as a drill-down when its id names its focus', () => {
    expect(isDetailView({ id: 'detail:svc.orders', type: 'component-detail', focus: 'svc.orders', nodes: [], edges: [] })).toBe(true);
    expect(isDetailView({ id: 'detail:svc.orders', type: 'component-detail', focus: 'svc.catalog', nodes: [], edges: [] })).toBe(false);
    expect(isDetailView({ id: 'detail:svc.orders', type: 'architecture', focus: 'svc.orders', nodes: [], edges: [] })).toBe(false);
    expect(detailViewId('svc.orders')).toBe('detail:svc.orders');
  });

  it('repairs stale membership on any synced model', () => {
    const m = opened(base(), 'svc.orders');
    const stale = structuredClone(m);
    detail(stale, 'svc.orders')!.nodes = ['svc.orders'];
    detail(stale, 'svc.orders')!.edges = [];
    expect(syncDetailViews(stale)).toEqual(m);
  });
});

describe('undo and persistence', () => {
  it('undo after opening removes the view in a forward revision', () => {
    const before = base();
    const after = opened(before, 'svc.orders');
    const undone = undoTo(after, before);
    expect(undone.revision).toBe(3);
    expect(undone.views.some(isDetailView)).toBe(false);
  });

  it('round-trips through JSON and the schema unchanged', () => {
    const m = opened(opened(base(), 'svc.orders'), 'gateway.api');
    expect(SystemModelSchema.parse(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });
});

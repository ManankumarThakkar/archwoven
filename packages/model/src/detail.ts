import type { SystemModel, View } from './schema';
import { validateModel } from './validate';
import { internalsOf, isInternal } from './groups';

/** Drill-down views are ordinary component-detail views whose id names their focus.
 * Generated component-detail views never match, so they are never rewritten. */
export const MAX_DETAIL_VIEWS = 12;
export const detailViewId = (nodeId: string): string => `detail:${nodeId}`;
export const isDetailView = (view: View): boolean =>
  view.type === 'component-detail' && !!view.focus && view.id === detailViewId(view.focus);

type Result = { ok: true; model: SystemModel } | { ok: false; errors: string[] };

/** The focus, its direct neighbours in edge order, and every edge touching it. Once expanded,
 * the internals replace the focus: internals, its neighbours, and every link touching an internal. */
export function detailMembership(model: SystemModel, focus: string): { nodes: string[]; edges: string[] } {
  // An overview-level component stays at its level: links into another component's internals are not its connections.
  const sameLevel = (e: { from: string; to: string }) => isInternal(model, focus) || !isInternal(model, e.from === focus ? e.to : e.from);
  const edges = model.edges.filter(e => (e.from === focus || e.to === focus) && sameLevel(e));
  const neighbours = edges.map(e => (e.from === focus ? e.to : e.from));
  const inner = new Set(internalsOf(model, focus).map(n => n.id));
  if (!inner.size) return { nodes: [...new Set([focus, ...neighbours])], edges: edges.map(e => e.id) };
  const links = model.edges.filter(e => inner.has(e.from) || inner.has(e.to));
  return {
    nodes: [...new Set([...inner, ...neighbours.filter(id => id !== focus), ...links.flatMap(e => [e.from, e.to])])],
    edges: links.map(e => e.id),
  };
}

/** Re-derive detail views in place: drop those whose focus is gone or is an entity. */
export function syncDetailViewsInPlace(m: SystemModel): void {
  const orientation = m.views.find(v => v.type === 'architecture')?.orientation ?? null;
  m.views = m.views.flatMap(view => {
    if (!isDetailView(view)) return [view];
    const focus = m.nodes.find(n => n.id === view.focus);
    if (!focus || focus.kind === 'entity') return [];
    return [{ ...view, orientation, ...detailMembership(m, focus.id) }];
  });
}

export function syncDetailViews(model: SystemModel): SystemModel {
  const m = structuredClone(model);
  syncDetailViewsInPlace(m);
  return m;
}

const revise = (model: SystemModel, next: SystemModel): Result => {
  const checked = validateModel({ ...next, revision: model.revision + 1, parentId: model.revision });
  return checked.ok ? { ok: true, model: checked.model } : { ok: false, errors: checked.errors };
};

export function openDetailView(model: SystemModel, nodeId: string): Result {
  const node = model.nodes.find(n => n.id === nodeId);
  if (!node) return { ok: false, errors: [`Cannot open detail for unknown component "${nodeId}".`] };
  if (node.kind === 'entity') return { ok: false, errors: ['An ER entity already shows its fields; choose a component instead.'] };
  const existing = model.views.find(v => v.id === detailViewId(nodeId));
  if (existing) return isDetailView(existing) ? { ok: true, model } : { ok: false, errors: [`Another view already uses the id "${existing.id}".`] };
  if (model.views.filter(isDetailView).length >= MAX_DETAIL_VIEWS)
    return { ok: false, errors: [`A diagram can have at most ${MAX_DETAIL_VIEWS} detail views. Close one to open another.`] };
  const next = structuredClone(model);
  next.views.push({ id: detailViewId(nodeId), type: 'component-detail', focus: nodeId, nodes: [], edges: [] });
  syncDetailViewsInPlace(next);
  return revise(model, next);
}

export function closeDetailView(model: SystemModel, viewId: string): Result {
  if (!model.views.some(v => v.id === viewId && isDetailView(v))) return { ok: false, errors: [`"${viewId}" is not an open detail view.`] };
  const next = structuredClone(model);
  next.views = next.views.filter(v => v.id !== viewId);
  return revise(model, next);
}

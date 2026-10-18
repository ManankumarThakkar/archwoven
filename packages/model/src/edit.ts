import { NodeSchema, EdgeSchema, type EditOp, type SystemModel } from './schema';
import { validateModel } from './validate';
import { syncDetailViewsInPlace } from './detail';
import { isInternal } from './groups';
import { reconcileReferences } from './reconcile';

/**
 * Controlled edits: every op is checked against baseRevision, the batch is
 * atomic (all-or-nothing), and the result must pass validateModel. Layout is
 * only ever touched by `move` — semantic edits preserve every position.
 */
export function applyEditOps(
  model: SystemModel,
  ops: EditOp[],
): { ok: true; model: SystemModel } | { ok: false; errors: string[] } {
  const stale = ops.filter((o) => o.baseRevision !== model.revision);
  if (stale.length > 0) return { ok: false, errors: [`stale-revision: ${stale.length} op(s) target revision ${stale[0]!.baseRevision}, model is at ${model.revision}`] };

  const m: SystemModel = structuredClone(model);
  const errors: string[] = [];

  const findNode = (id: string) => m.nodes.find((n) => n.id === id);
  const findEdge = (id: string) => m.edges.find((e) => e.id === id);

  for (const o of ops) {
    if (o.op === 'add') {
      // 'from'+'to' in the patch distinguishes an edge from a node. New elements
      // join the architecture overview so the diagram stays live; sequence/ER views
      // are structured and only change via explicit ops.
      const fmt = (iss: { path: readonly PropertyKey[]; message: string }[]) =>
        `add "${o.target}": ${iss.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
      if ('from' in o.patch && 'to' in o.patch) {
        const p = EdgeSchema.safeParse(o.patch);
        if (!p.success) { errors.push(fmt(p.error.issues)); continue; }
        if (p.data.id !== o.target) { errors.push(`add "${o.target}": patch id "${p.data.id}" does not match target`); continue; }
        m.edges.push(p.data);
        for (const v of m.views)
          if (v.type === 'architecture' && v.nodes.includes(p.data.from) && v.nodes.includes(p.data.to) && !v.edges.includes(o.target)) v.edges.push(o.target);
      } else {
        const p = NodeSchema.safeParse(o.patch);
        if (!p.success) { errors.push(fmt(p.error.issues)); continue; }
        if (p.data.id !== o.target) { errors.push(`add "${o.target}": patch id "${p.data.id}" does not match target`); continue; }
        // A node grouped under an existing component is one of its internals: detail views only.
        const internal = !!p.data.group && p.data.group !== p.data.id && !!findNode(p.data.group);
        m.nodes.push(p.data);
        if (!internal)
          for (const v of m.views)
            if (v.type === 'architecture' && !v.nodes.includes(o.target)) v.nodes.push(o.target);
      }
      continue;
    }

    if (o.op === 'move') {
      if (o.target === '__proto__') {
        errors.push(`move "${o.target}": unsupported layout key`);
        continue;
      }
      if (!findNode(o.target) && !findEdge(o.target)) {
        errors.push(`move "${o.target}": unknown target`);
        continue;
      }
      const { x, y } = o.patch as { x?: unknown; y?: unknown };
      if (typeof x !== 'number' || typeof y !== 'number') {
        errors.push(`move "${o.target}": patch needs numeric x and y`);
        continue;
      }
      m.layout = { ...m.layout, [o.target]: { x, y } };
      continue;
    }

    const node = findNode(o.target);
    const edge = node ? undefined : findEdge(o.target);
    if (!node && !edge) {
      errors.push(`${o.op} "${o.target}": unknown target`);
      continue;
    }

    if (o.op === 'remove') {
      if (node) {
        const referrers = [
          ...m.edges.filter((e) => e.from === o.target || e.to === o.target).map((e) => `edge ${e.id}`),
          ...m.nodes.filter((n) => n.group === o.target && isInternal(m, n.id)).map((n) => `internal ${n.id}`),
        ];
        if (referrers.length > 0) {
          errors.push(`remove "${o.target}" still referenced by: ${referrers.join(', ')}`);
          continue;
        }
        m.nodes = m.nodes.filter((n) => n.id !== o.target);
        for (const v of m.views) v.nodes = v.nodes.filter((id) => id !== o.target);
        if (m.layout) delete m.layout[o.target];
      } else if (edge) {
        m.edges = m.edges.filter((e) => e.id !== o.target);
        for (const v of m.views) v.edges = v.edges.filter((id) => id !== o.target);
      }
      continue;
    }

    // update: shallow-merge patch; identity fields are immutable.
    if ('id' in o.patch) {
      errors.push(`update "${o.target}": cannot change id`);
      continue;
    }
    if (edge && ('from' in o.patch || 'to' in o.patch)) {
      errors.push(`update "${o.target}": cannot change edge endpoints — remove and re-add`);
      continue;
    }
    Object.assign(node ?? edge!, o.patch);
  }

  if (errors.length > 0) return { ok: false, errors };

  const refusals = reconcileReferences(model, m);
  if (refusals.length > 0) return { ok: false, errors: refusals };
  syncDetailViewsInPlace(m);
  const checked = validateModel({ ...m, revision: m.revision + 1, parentId: m.revision });
  if (!checked.ok) return { ok: false, errors: checked.errors };
  return { ok: true, model: checked.model };
}

/** Undo is itself a forward revision: restore prev's content, keep the revision chain honest. */
export function undoTo(_model: SystemModel, prev: SystemModel): SystemModel {
  const next = structuredClone(prev);
  next.revision = _model.revision + 1;
  next.parentId = _model.revision;
  return next;
}

/** Orientation is an explicit layout action, separate from semantic refinement.
 * Manual coordinates use schema v1's global node-id map: reset member keys so
 * auto-layout can take effect, retaining all nonmember positions for other views.
 */
export function orientArchitecture(model: SystemModel, viewId: string, orientation: 'LR' | 'TB'): ReturnType<typeof applyEditOps> {
  const view = model.views.find(v => v.id === viewId);
  if (!view || view.type !== 'architecture' || !['LR', 'TB'].includes(orientation))
    return { ok: false, errors: ['Choose an architecture view and a horizontal or vertical direction.'] };
  if ((view.orientation ?? 'TB') === orientation) return { ok: true, model };
  const next = structuredClone(model);
  next.views.find(v => v.id === viewId)!.orientation = orientation;
  if (next.layout) for (const id of view.nodes) delete next.layout[id];
  syncDetailViewsInPlace(next);
  const checked = validateModel({ ...next, revision: model.revision + 1, parentId: model.revision });
  return checked.ok ? { ok: true, model: checked.model } : { ok: false, errors: checked.errors };
}

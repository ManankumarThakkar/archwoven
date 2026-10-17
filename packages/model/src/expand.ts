import { z } from 'zod';
import { detailViewId, isDetailView, MAX_DETAIL_VIEWS, syncDetailViewsInPlace } from './detail';
import { internalsOf, isInternal } from './groups';
import { EdgeTypeSchema, type Edge, type SystemModel } from './schema';
import { validateModel } from './validate';

export const MIN_INTERNALS = 2;
export const MAX_INTERNALS = 8;
export const MAX_EXPANSION_LINKS = 40;

/** The only shape a provider may return. Ids, kinds, provenance and evidence are server-built. */
export const ExpansionSchema = z.object({
  internals: z.array(z.object({
    key: z.string().regex(/^[a-z0-9-]{1,40}$/, 'key must be 1–40 lowercase letters, digits or hyphens'),
    label: z.string().trim().min(1).max(60),
  }).strict()).min(MIN_INTERNALS).max(MAX_INTERNALS),
  links: z.array(z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    type: EdgeTypeSchema,
    label: z.string().trim().max(80).nullish(),
  }).strict()).max(MAX_EXPANSION_LINKS),
}).strict();
export type Expansion = z.input<typeof ExpansionSchema>;

type Result = { ok: true; model: SystemModel } | { ok: false; errors: string[] };

const labelOf = (model: SystemModel, id: string): string => model.nodes.find(n => n.id === id)?.label ?? id;
const focusEdges = (model: SystemModel, focus: string): Edge[] => model.edges.filter(e => e.from === focus || e.to === focus);

/** Why `focus` cannot be expanded right now, or null. Checked before any inference or credit. */
export function expandBlocker(model: SystemModel, focus: string): string | null {
  const node = model.nodes.find(n => n.id === focus);
  if (!node) return `Cannot expand unknown component "${focus}".`;
  if (node.kind === 'entity') return 'An ER entity already shows its fields; choose a component instead.';
  if (isInternal(model, focus)) return `${node.label} is already part of ${labelOf(model, node.group!)}; internals are not expanded further.`;
  if (internalsOf(model, focus).length) return `${node.label} already has inferred internals. Refine them or undo the expansion.`;
  const view = model.views.find(v => v.id === detailViewId(focus));
  if (view && !isDetailView(view)) return `Another view already uses the id "${view.id}".`;
  if (!view && model.views.filter(isDetailView).length >= MAX_DETAIL_VIEWS)
    return `A diagram can have at most ${MAX_DETAIL_VIEWS} detail views. Close one to expand another component.`;
  return null;
}

/** Rule violations for a provider response, phrased so a repair round can act on them. */
function ruleErrors(model: SystemModel, focus: string, e: z.output<typeof ExpansionSchema>): string[] {
  const errors: string[] = [];
  const name = labelOf(model, focus);
  const edges = focusEdges(model, focus);
  const neighbours = new Set(edges.map(x => (x.from === focus ? x.to : x.from)).filter(id => id !== focus));
  const keys = new Set<string>();
  const labels = new Set<string>();
  for (const i of e.internals) {
    if (keys.has(i.key)) errors.push(`duplicate key "${i.key}"; every internal needs its own key.`);
    keys.add(i.key);
    const lower = i.label.toLowerCase();
    if (labels.has(lower)) errors.push(`duplicate label "${i.label}"; every internal needs a distinct name.`);
    labels.add(lower);
    if (lower === name.toLowerCase()) errors.push(`internal "${i.key}" has the same name as ${name}; name the part, not the whole.`);
    for (const n of neighbours) if (lower === labelOf(model, n).toLowerCase()) errors.push(`internal "${i.key}" has the same name as the neighbour ${labelOf(model, n)}; it must be a part of ${name}.`);
  }
  const seen = new Set<string>();
  for (const l of e.links) {
    for (const end of [l.from, l.to]) if (!keys.has(end) && !neighbours.has(end)) errors.push(`link endpoint "${end}" is neither an internal key nor a neighbour of ${name}.`);
    if (!keys.has(l.from) && !keys.has(l.to)) { errors.push(`link "${l.from}"→"${l.to}" must start or end at an internal.`); continue; }
    if (l.from === l.to) errors.push(`link "${l.from}"→"${l.to}" is a self-loop; connect two different internals.`);
    const signature = `${l.from}\u0000${l.to}\u0000${l.type}`;
    if (seen.has(signature)) errors.push(`duplicate link "${l.from}"→"${l.to}" (${l.type}).`);
    seen.add(signature);
    if (keys.has(l.from) && neighbours.has(l.to) && !edges.some(x => x.from === focus && x.to === l.to && x.type === l.type))
      errors.push(`link "${l.from}"→"${l.to}" has no ${l.type} link from ${name} to "${l.to}"; internals may only connect outward where ${name} already does, with the same type.`);
    if (neighbours.has(l.from) && keys.has(l.to) && !edges.some(x => x.from === l.from && x.to === focus && x.type === l.type))
      errors.push(`link "${l.from}"→"${l.to}" has no ${l.type} link from "${l.from}" to ${name}; neighbours may only reach internals where they already reach ${name}, with the same type.`);
  }
  for (const x of edges) {
    const covered = x.from === focus && x.to === focus
      ? e.links.some(l => keys.has(l.from) && keys.has(l.to) && l.type === x.type)
      : x.from === focus
        ? e.links.some(l => keys.has(l.from) && l.to === x.to && l.type === x.type)
        : e.links.some(l => l.from === x.from && keys.has(l.to) && l.type === x.type);
    if (!covered) errors.push(x.from === focus && x.to === focus
      ? `${name}'s link ${x.id} (${x.type} self-loop) is not covered: add a ${x.type} link between two internals.`
      : x.from === focus
        ? `${name}'s link ${x.id} (${x.from}→${x.to}, ${x.type}) is not covered: add a ${x.type} link from an internal to "${x.to}".`
        : `${name}'s link ${x.id} (${x.from}→${x.to}, ${x.type}) is not covered: add a ${x.type} link from "${x.from}" to an internal.`);
  }
  const checks = model.semanticChecks;
  for (const i of e.internals) {
    if (checks?.allowedRoots.length && !e.links.some(l => l.to === i.key)) errors.push(`internal "${i.key}" needs an incoming link; this model checks that every component is reached.`);
    if (checks?.allowedTerminals.length && !e.links.some(l => l.from === i.key)) errors.push(`internal "${i.key}" needs an outgoing link; this model checks that every component leads somewhere.`);
  }
  return [...new Set(errors)];
}

const uniqueId = (taken: Set<string>, wanted: string): string => {
  let id = wanted;
  for (let n = 2; taken.has(id); n++) id = `${wanted}-${n}`;
  taken.add(id);
  return id;
};

/** Validate a provider response against the focus and, if sound and complete, apply it as one revision. */
export function applyExpansion(model: SystemModel, focus: string, raw: unknown): Result {
  const blocked = expandBlocker(model, focus);
  if (blocked) return { ok: false, errors: [blocked] };
  const parsed = ExpansionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(i => `expansion.${i.path.join('.') || '<root>'}: ${i.message}`) };
  const errors = ruleErrors(model, focus, parsed.data);
  if (errors.length) return { ok: false, errors };

  const next = structuredClone(model);
  const nodeIds = new Set(next.nodes.map(n => n.id));
  const edgeIds = new Set(next.edges.map(x => x.id));
  const idOf = new Map(parsed.data.internals.map(i => [i.key, uniqueId(nodeIds, `${focus}/${i.key}`)]));
  for (const i of parsed.data.internals)
    next.nodes.push({ id: idOf.get(i.key)!, kind: 'component', label: i.label, provenance: 'inferred', evidence: [], group: focus });
  let n = 0;
  for (const l of parsed.data.links) {
    let id: string;
    do id = `${focus}/link-${++n}`; while (edgeIds.has(id));
    edgeIds.add(id);
    next.edges.push({ id, from: idOf.get(l.from) ?? l.from, to: idOf.get(l.to) ?? l.to, type: l.type, ...(l.label ? { label: l.label } : {}), provenance: 'inferred', evidence: [] });
  }
  if (!next.views.some(v => v.id === detailViewId(focus)))
    next.views.push({ id: detailViewId(focus), type: 'component-detail', focus, nodes: [], edges: [] });
  syncDetailViewsInPlace(next);
  const checked = validateModel({ ...next, revision: model.revision + 1, parentId: model.revision });
  return checked.ok ? { ok: true, model: checked.model } : { ok: false, errors: checked.errors };
}

/** Disagreements between the overview and an expanded component's internals. Reported, never auto-fixed. */
export function detailDrift(model: SystemModel, focus: string): { uncovered: Edge[]; unbacked: Edge[] } {
  const inner = new Set(internalsOf(model, focus).map(n => n.id));
  if (!inner.size) return { uncovered: [], unbacked: [] };
  const links = model.edges.filter(x => inner.has(x.from) || inner.has(x.to));
  const edges = focusEdges(model, focus);
  const uncovered = edges.filter(x => !(x.from === focus && x.to === focus
    ? links.some(l => inner.has(l.from) && inner.has(l.to) && l.type === x.type)
    : x.from === focus
      ? links.some(l => inner.has(l.from) && l.to === x.to && l.type === x.type)
      : links.some(l => l.from === x.from && inner.has(l.to) && l.type === x.type)));
  const unbacked = links.filter(l => inner.has(l.from) && inner.has(l.to) ? false
    : inner.has(l.from)
      ? !edges.some(x => x.from === focus && x.to === l.to && x.type === l.type)
      : !edges.some(x => x.from === l.from && x.to === focus && x.type === l.type));
  return { uncovered, unbacked };
}

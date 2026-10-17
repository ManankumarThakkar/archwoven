import type { Message, SystemModel } from './schema';

const SOURCE_REFUSAL = 'is backed by source evidence';
/** True for a refusal that protects a source-backed requirement; callers surface it to the user. */
export const isSourceEvidenceRefusal = (error: string): boolean => error.includes(SOURCE_REFUSAL);

/** Same diagram content, ignoring revision bookkeeping and object key order. */
export function sameModelContent(a: SystemModel, b: SystemModel): boolean {
  const canonical = ({ revision: _r, parentId: _p, ...rest }: SystemModel) =>
    JSON.stringify(rest, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) : v));
  return canonical(a) === canonical(b);
}

/**
 * Keep every id-referencing structure consistent after an edit batch, in place.
 * The user's explicit request wins over generated annotations; requirements backed
 * by source evidence stay protected and are returned as refusals.
 * `before` is the last valid revision, so every new violation was caused by this batch.
 */
export function reconcileReferences(before: SystemModel, m: SystemModel): string[] {
  const nodeIds = new Set(m.nodes.map(n => n.id));
  const edgeIds = new Set(m.edges.map(e => e.id));
  const label = (id: string) => before.nodes.find(n => n.id === id)?.label ?? m.nodes.find(n => n.id === id)?.label ?? id;
  const errors: string[] = [];

  // Sequences: a removed participant takes its messages; survivors renumber and fragments follow.
  m.views = m.views.flatMap(view => {
    const seq = view.sequence;
    if (!seq || seq.participants.every(p => nodeIds.has(p))) return [view];
    const participants = seq.participants.filter(p => nodeIds.has(p));
    if (!participants.length) return [];
    const kept = seq.messages.filter(msg => nodeIds.has(msg.from) && nodeIds.has(msg.to));
    const renumber = new Map(kept.map((msg, i) => [msg.seq, i + 1]));
    const remap = (covers: number[]) => covers.flatMap(c => (renumber.has(c) ? [renumber.get(c)!] : []));
    const messages: Message[] = kept.map(({ fragment, ...msg }) => {
      const covers = fragment ? remap(fragment.covers) : [];
      return { ...msg, seq: renumber.get(msg.seq)!, ...(fragment && covers.length ? { fragment: { ...fragment, covers } } : {}) };
    });
    for (const msg of seq.messages) {
      if (kept.includes(msg) || !msg.fragment) continue;
      const covers = remap(msg.fragment.covers);
      const carrier = covers.length ? messages.find(x => x.seq === Math.min(...covers)) : undefined;
      if (carrier && !carrier.fragment) carrier.fragment = { ...msg.fragment, covers };
    }
    return [{ ...view, sequence: { participants, messages } }];
  });

  // Narrative and grouping annotations follow removals; emptied ones disappear.
  m.guidedViews = m.guidedViews.map(g => ({ ...g, focus: g.focus.filter(id => nodeIds.has(id)) })).filter(g => g.focus.length);
  m.boundaries = m.boundaries.map(b => ({ ...b, wraps: b.wraps.filter(id => nodeIds.has(id)) })).filter(b => b.wraps.length);
  for (const view of m.views) {
    const path = view.mainPath;
    if (!path) continue;
    const valid = path.every(id => view.nodes.includes(id)) && path.slice(1).every((to, i) => m.edges.some(e => e.from === path[i] && e.to === to));
    if (!valid) delete view.mainPath;
  }
  for (const q of m.openQuestions) if (q.blockedBy && !nodeIds.has(q.blockedBy) && !edgeIds.has(q.blockedBy)) delete q.blockedBy;

  const sc = m.semanticChecks;
  if (!sc) return errors;
  sc.requiredEdges = sc.requiredEdges.flatMap(re => {
    const matches = (e: { from: string; to: string; type: string }) => e.from === re.from && e.to === re.to && (re.type == null || e.type === re.type);
    if (m.edges.some(matches)) return [re];
    const was = before.edges.filter(matches);
    const retyped = was.map(e => m.edges.find(x => x.id === e.id)).find(e => e && e.from === re.from && e.to === re.to);
    if (was.some(e => e.provenance === 'source-supported')) {
      errors.push(`${label(re.from)} → ${label(re.to)} ${SOURCE_REFUSAL} and can't be ${retyped ? 'changed' : 'removed'} by refinement.`);
      return [re];
    }
    return retyped && re.type != null ? [{ ...re, type: retyped.type }] : [];
  });
  const adjacency = new Map<string, string[]>();
  for (const e of m.edges) (adjacency.get(e.from) ?? adjacency.set(e.from, []).get(e.from)!).push(e.to);
  const reaches = (from: string, to: string) => {
    const seen = new Set([from]); const queue = [from];
    while (queue.length) for (const next of adjacency.get(queue.shift()!) ?? []) { if (next === to) return true; if (!seen.has(next)) { seen.add(next); queue.push(next); } }
    return false;
  };
  const sourceNode = (id: string) => before.nodes.find(n => n.id === id)?.provenance === 'source-supported';
  sc.requiredPaths = sc.requiredPaths.filter(rp => {
    if (nodeIds.has(rp.from) && nodeIds.has(rp.to) && reaches(rp.from, rp.to)) return true;
    if (sourceNode(rp.from) && sourceNode(rp.to)) {
      errors.push(`The path ${label(rp.from)} → ${label(rp.to)} ${SOURCE_REFUSAL} and can't be broken by refinement.`);
      return true;
    }
    return false;
  });
  // Root/terminal discipline stays opt-in per non-empty list; new sources and sinks are the request's own.
  const rootsActive = sc.allowedRoots.length > 0, terminalsActive = sc.allowedTerminals.length > 0;
  sc.allowedRoots = sc.allowedRoots.filter(id => nodeIds.has(id));
  sc.allowedTerminals = sc.allowedTerminals.filter(id => nodeIds.has(id));
  for (const n of m.nodes) {
    if (rootsActive && !m.edges.some(e => e.to === n.id) && !sc.allowedRoots.includes(n.id)) sc.allowedRoots.push(n.id);
    if (terminalsActive && !m.edges.some(e => e.from === n.id) && !sc.allowedTerminals.includes(n.id)) sc.allowedTerminals.push(n.id);
  }
  return errors;
}

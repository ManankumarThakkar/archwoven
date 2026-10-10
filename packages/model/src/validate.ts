import { SystemModelSchema, type SystemModel } from './schema';

export type ValidationResult =
  | { ok: true; model: SystemModel }
  | { ok: false; errors: string[] };

/**
 * Zod shape validation + graph referential integrity.
 * Error strings always name the offending ids so LLM repair loops get actionable feedback.
 */
export function validateModel(raw: unknown): ValidationResult {
  const parsed = SystemModelSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
    };
  }
  const m = parsed.data;
  const errors: string[] = [];

  const nodeIds = new Set<string>();
  for (const n of m.nodes) {
    if (nodeIds.has(n.id)) errors.push(`duplicate node id: "${n.id}"`);
    nodeIds.add(n.id);
  }

  const edgeIds = new Set<string>();
  for (const e of m.edges) {
    if (edgeIds.has(e.id)) errors.push(`duplicate edge id: "${e.id}"`);
    edgeIds.add(e.id);
    if (!nodeIds.has(e.from)) errors.push(`edge "${e.id}" from unknown node: "${e.from}"`);
    if (!nodeIds.has(e.to)) errors.push(`edge "${e.id}" to unknown node: "${e.to}"`);
  }

  for (const v of m.views) {
    for (const id of v.nodes) {
      if (!nodeIds.has(id)) errors.push(`view "${v.id}" references unknown node: "${id}"`);
    }
    for (const id of v.edges) {
      if (!edgeIds.has(id)) errors.push(`view "${v.id}" references unknown edge: "${id}"`);
    }
    if (v.sequence) {
      const viewNodes = new Set(v.nodes);
      for (const p of v.sequence.participants) {
        if (!viewNodes.has(p)) errors.push(`view "${v.id}" participant not in view nodes: "${p}"`);
      }
      const seqs = v.sequence.messages.map((msg) => msg.seq);
      for (let i = 0; i < seqs.length; i++) {
        const expected = i + 1;
        if (seqs[i] !== expected) {
          errors.push(`view "${v.id}" message seq must be consecutive from 1, got ${seqs[i]} at index ${i}`);
          break;
        }
      }
      for (const msg of v.sequence.messages) {
        if (!v.sequence.participants.includes(msg.from))
          errors.push(`view "${v.id}" message ${msg.seq} from unknown participant: "${msg.from}"`);
        if (!v.sequence.participants.includes(msg.to))
          errors.push(`view "${v.id}" message ${msg.seq} to unknown participant: "${msg.to}"`);
      }
    }
  }

  if (m.parentId !== undefined && m.parentId !== m.revision - 1) {
    errors.push(`parentId ${m.parentId} must equal revision - 1 (${m.revision - 1})`);
  }

  // --- M4 semantic enforcement (only when semanticChecks present) ---
  const adjacency = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const e of m.edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    adjacency.get(e.from)!.push(e.to);
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  }
  const reachable = (from: string): Set<string> => {
    const seen = new Set<string>([from]);
    const queue = [from];
    while (queue.length > 0) {
      for (const to of adjacency.get(queue.shift()!) ?? []) {
        if (!seen.has(to)) { seen.add(to); queue.push(to); }
      }
    }
    return seen;
  };

  if (m.semanticChecks) {
    const sc = m.semanticChecks;
    for (const id of [...sc.allowedRoots, ...sc.allowedTerminals]) {
      if (!nodeIds.has(id)) errors.push(`semanticChecks reference unknown node: "${id}"`);
    }
    for (const re of sc.requiredEdges) {
      if (!nodeIds.has(re.from) || !nodeIds.has(re.to)) { errors.push(`requiredEdge references unknown node: "${re.from}"→"${re.to}"`); continue; }
      const hit = m.edges.some((e) => e.from === re.from && e.to === re.to && (re.type == null || e.type === re.type));
      if (!hit) errors.push(`requiredEdge missing: "${re.from}"→"${re.to}"${re.type ? ` type:${re.type}` : ''}`);
    }
    for (const rp of sc.requiredPaths) {
      if (!nodeIds.has(rp.from) || !nodeIds.has(rp.to)) { errors.push(`requiredPath references unknown node: "${rp.from}"→"${rp.to}"`); continue; }
      if (!reachable(rp.from).has(rp.to)) errors.push(`requiredPath unreachable: "${rp.from}"→"${rp.to}"`);
    }
    // root/terminal discipline is opt-in per list (non-empty): extraction emits
    // only what it saw — an empty list means "not checked", never "none allowed".
    if (sc.allowedRoots.length > 0) {
      for (const n of m.nodes) {
        if ((incoming.get(n.id) ?? 0) === 0 && !sc.allowedRoots.includes(n.id)) errors.push(`node has no incoming edge but is not in allowedRoots: "${n.id}"`);
      }
    }
    if (sc.allowedTerminals.length > 0) {
      for (const n of m.nodes) {
        if (!adjacency.has(n.id) && !sc.allowedTerminals.includes(n.id)) errors.push(`node has no outgoing edge but is not in allowedTerminals: "${n.id}"`);
      }
    }
  }

  const boundaryOf = new Map<string, string>();
  for (const b of m.boundaries) {
    for (const id of b.wraps) {
      if (!nodeIds.has(id)) { errors.push(`boundary "${b.id}" wraps unknown node: "${id}"`); continue; }
      if (boundaryOf.has(id)) errors.push(`node in two boundaries: "${id}" (${boundaryOf.get(id)}, ${b.id})`);
      boundaryOf.set(id, b.id);
    }
  }

  for (const gv of m.guidedViews) {
    for (const id of gv.focus) {
      if (!nodeIds.has(id)) errors.push(`guidedView "${gv.id}" references unknown node: "${id}"`);
    }
  }

  for (const v of m.views) {
    if (!v.mainPath) continue;
    const viewNodes = new Set(v.nodes);
    for (const id of v.mainPath) {
      if (!viewNodes.has(id)) errors.push(`view "${v.id}" mainPath references node outside the view: "${id}"`);
    }
    for (let i = 0; i + 1 < v.mainPath.length; i++) {
      const hasEdge = m.edges.some((e) => e.from === v.mainPath[i] && e.to === v.mainPath[i + 1]);
      if (!hasEdge) errors.push(`view "${v.id}" mainPath pair without forward edge: "${v.mainPath[i]}"→"${v.mainPath[i + 1]}"`);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, model: m };
}

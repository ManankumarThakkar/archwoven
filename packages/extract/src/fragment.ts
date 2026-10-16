import type { Edge, Evidence, Node, SemanticChecks } from '@archwoven/model';

export interface FragmentEndpoint {
  method: string;
  path: string;
  evidence: Evidence;
}

/** Bounded untrusted context for repositories outside specialized parsers. */
export interface SourceContext {
  kind: 'bounded-source-analysis';
  inventory: string[];
  eligibleFiles: number;
  sampledFiles: number;
  omittedFiles: number;
  truncatedFiles: number;
  samples: { path: string; lines: [number, number]; text: string; truncated: boolean }[];
  limits: { maxFiles: number; maxFileChars: number; maxTotalChars: number; maxInventory: number; maxEdges: number };
  limitations: string[];
}

/** A piece of a SystemModel extracted from source: everything source-supported, plus explicit gaps. */
export interface Fragment {
  nodes: Node[];
  edges: Edge[];
  endpoints: FragmentEndpoint[];
  gaps: string[];
  /** emitted ONLY when endpoints + required bindings were actually seen (never empty-object noise) */
  semanticChecks?: SemanticChecks;
  sourceContext?: SourceContext;
}

/**
 * Derive fragment-level semanticChecks from what the extractor actually saw:
 * roots/terminals = edge-less nodes at extraction time; requiredPaths =
 * root→datastore pairs BFS-provable over the fragment's own edges — so the
 * extraction can never emit a check its own output would fail.
 */
export function deriveSemanticChecks(
  frag: Fragment,
  requiredEdges: { from: string; to: string; type?: 'sync' }[],
): SemanticChecks | undefined {
  if (frag.endpoints.length === 0 || requiredEdges.length === 0) return undefined;
  const incoming = new Set(frag.edges.map((e) => e.to));
  const outgoing = new Set(frag.edges.map((e) => e.from));
  const adjacency = new Map<string, string[]>();
  for (const e of frag.edges) (adjacency.get(e.from) ?? adjacency.set(e.from, []).get(e.from)!).push(e.to);
  const reach = (from: string): Set<string> => {
    const seen = new Set([from]);
    const q = [from];
    while (q.length) for (const t of adjacency.get(q.shift()!) ?? []) if (!seen.has(t)) { seen.add(t); q.push(t); }
    return seen;
  };
  const roots = frag.nodes.filter((n) => !incoming.has(n.id));
  return {
    allowedRoots: roots.map((n) => n.id),
    allowedTerminals: frag.nodes.filter((n) => !outgoing.has(n.id)).map((n) => n.id),
    requiredEdges,
    requiredPaths: roots.flatMap((r) => frag.nodes.filter((n) => n.kind === 'datastore' && reach(r.id).has(n.id)).map((d) => ({ from: r.id, to: d.id }))),
  };
}

import type { Evidence, Field, Cardinality, NodeKind, Provenance, SystemModel } from '@archwoven/model';

export interface EvidenceLink {
  label: string;
  href?: string;
}

export interface InspectorPayload {
  id: string;
  kind: 'node' | 'edge';
  label: string;
  provenance: Provenance;
  role?: string;
  nodeKind?: NodeKind;
  endpoints?: { from: string; to: string };
  type?: string;
  fields?: Field[];
  cardinality?: Cardinality | null;
  evidence: EvidenceLink[];
  gaps: string[];
}

const ROLE: Record<NodeKind, string> = {
  actor: 'A person or external system that interacts with the architecture',
  service: 'A service component owning a slice of the domain',
  gateway: 'An entry point routing requests to services',
  datastore: 'A store of durable state',
  queue: 'An async transport between producers and consumers',
  external: 'A third-party system outside your boundary',
  entity: 'A domain entity / table',
  component: 'A component or source module',
};

const evidenceLink = (ev: Evidence): EvidenceLink => {
  const file = ev.path?.split('/').pop();
  if (ev.repo?.startsWith('local/')) {
    const path = ev.path ?? 'Local source';
    return { label: `${path}${ev.lines ? `:${ev.lines[0]}-${ev.lines[1]}` : ''}${ev.commit ? ` · commit ${ev.commit.slice(0, 12)}` : ''}`, href: undefined };
  }
  const label = ev.lines ? `${file ?? ev.path ?? 'source'}:${ev.lines[0]}-${ev.lines[1]}` : file ?? ev.note ?? ev.repo ?? 'source';
  // Pin to the analyzed revision when known (scenario 5), else the default branch.
  const href = ev.repo && ev.path ? `https://github.com/${ev.repo}/blob/${ev.commit ?? 'main'}/${ev.path}${ev.lines ? `#L${ev.lines[0]}` : ''}` : undefined;
  return { label, href };
};

/**
 * Pure mapping from a selected element id → the inspector payload the UI renders.
 * Kept UI-free so provenance/evidence/gap surfacing is unit-testable.
 */
export function inspectorFor(model: SystemModel, id: string): InspectorPayload | null {
  const node = model.nodes.find((n) => n.id === id);
  if (node) {
    return {
      id,
      kind: 'node',
      nodeKind: node.kind,
      ...(node.kind === 'entity' ? { fields: node.fields ?? [] } : {}),
      label: node.label,
      provenance: node.provenance,
      role: ROLE[node.kind],
      evidence: node.evidence.map(evidenceLink),
      gaps: model.openQuestions.filter((q) => q.blockedBy === id).map((q) => q.text),
    };
  }
  const edge = model.edges.find((e) => e.id === id);
  if (edge) {
    return {
      id,
      kind: 'edge',
      label: edge.label ?? edge.type,
      provenance: edge.provenance,
      endpoints: { from: edge.from, to: edge.to },
      type: edge.type,
      ...(edge.type === 'relation' ? { cardinality: edge.cardinality ?? null } : {}),
      evidence: edge.evidence.map(evidenceLink),
      gaps: model.openQuestions.filter((q) => q.blockedBy === id).map((q) => q.text),
    };
  }
  return null;
}

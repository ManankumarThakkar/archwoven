import type { EdgeType, SystemModel } from '@archwoven/model';

/**
 * Relationship passport (§2): the identity of an edge WITHOUT its evidence internals —
 * evidence count only, never source paths or commit SHAs (privacy §5). The inspector
 * keeps the full evidence links; the passport only counts them.
 */
export interface Passport {
  id: string;
  fromLabel: string;
  toLabel: string;
  edgeLabel: string;
  edgeKind: EdgeType;
  provenance: string;
  evidenceCount: number;
}

export function passportFor(model: SystemModel, edgeId: string): Passport | null {
  const e = model.edges.find((x) => x.id === edgeId);
  if (!e) return null;
  return {
    id: e.id,
    fromLabel: model.nodes.find((n) => n.id === e.from)?.label ?? e.from,
    toLabel: model.nodes.find((n) => n.id === e.to)?.label ?? e.to,
    edgeLabel: e.label ?? e.type,
    edgeKind: e.type,
    provenance: e.provenance,
    evidenceCount: e.evidence.length,
  };
}

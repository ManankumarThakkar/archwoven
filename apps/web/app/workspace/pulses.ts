import type { Edge, EdgeType } from '@archwoven/model';

/** Flow-token pulse priority: security > event > data > state > call.
 *  Schema v1 has no security edge type — that tier stays reserved. Mapping:
 *  event→async, data→data, state→control, call→sync; relation is structural, last. */
export const PULSE_RANK: Record<EdgeType, number> = { async: 1, data: 2, control: 3, sync: 4, relation: 5 };

/** Edge ids in pulse order: kind priority first, schema order breaks ties (stable).
 *  The motion gate lives in the caller — this never sees a still-mode canvas. */
export function pulseOrder(viewEdges: Edge[]): string[] {
  return viewEdges
    .map((e, i) => ({ id: e.id, rank: PULSE_RANK[e.type], i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.id);
}

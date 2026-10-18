import type { SystemModel } from '@archwoven/model';

export interface FinderHit {
  id: string;
  label: string;
}

/** Node-finder matching: case-insensitive substring over label and id,
 *  returned in view schema order. Empty query lists the whole current view;
 *  ids in the view that don't resolve to a node are skipped, never guessed. */
export function findNodes(model: SystemModel, viewNodes: string[], query: string): FinderHit[] {
  const q = query.trim().toLowerCase();
  const out: FinderHit[] = [];
  for (const id of viewNodes) {
    const n = model.nodes.find((m) => m.id === id);
    if (!n) continue;
    if (!q || n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) out.push({ id: n.id, label: n.label });
  }
  return out;
}

import type { NodeKind, SystemModel } from '@archwoven/model';

/** Semantic lens (§2): at most two kinds active at once. */
export const LENS_MAX = 2;

const KINDS: readonly NodeKind[] = ['actor', 'service', 'gateway', 'datastore', 'queue', 'external', 'entity', 'component'];

/** Parse `#lens=` permalinks: unknown kinds dropped, duplicates collapsed, >2 clamped to the first two. */
export function parseLens(raw: string | null | undefined): NodeKind[] {
  if (!raw) return [];
  const out: NodeKind[] = [];
  for (const part of raw.split(',')) {
    const k = part.trim() as NodeKind;
    if (KINDS.includes(k) && !out.includes(k)) out.push(k);
    if (out.length >= LENS_MAX) break;
  }
  return out;
}

export function serializeLens(kinds: NodeKind[]): string | null {
  return kinds.length ? kinds.slice(0, LENS_MAX).join(',') : null;
}

/** Toggle a kind: remove if active; a third kind replaces the oldest — never more than LENS_MAX. */
export function toggleLens(kinds: NodeKind[], kind: NodeKind): NodeKind[] {
  if (kinds.includes(kind)) return kinds.filter((k) => k !== kind);
  return [...kinds.slice(Math.max(0, kinds.length - LENS_MAX + 1)), kind];
}

/** Distinct kinds of the nodes actually in the view, in schema order (drives the chips). */
export function lensKindsInView(model: SystemModel, viewNodes: string[]): NodeKind[] {
  const out: NodeKind[] = [];
  for (const id of viewNodes) {
    const k = model.nodes.find((n) => n.id === id)?.kind;
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Empty lens = no filter. */
export function lensPasses(kind: NodeKind, lens: NodeKind[]): boolean {
  return lens.length === 0 || lens.includes(kind);
}

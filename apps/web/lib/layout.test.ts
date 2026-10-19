import { describe, expect, it } from 'vitest';
import { validateModel, validFullModel } from '@archwoven/model';
import { layoutModel, nodeSize, type PlacedNode } from './layout';
import stressRaw from '../test-fixtures/layout-stress.json';

describe('layoutModel (ELK)', () => {
  it('positions every node of the golden architecture view with finite coords', async () => {
    const r = await layoutModel(validFullModel, 'view.architecture');
    expect(r.nodes).toHaveLength(validFullModel.views[0]!.nodes.length);
    for (const n of r.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.width).toBeGreaterThan(0);
    }
  });

  it('produces zero node overlaps on the golden view', async () => {
    const r = await layoutModel(validFullModel, 'view.architecture');
    expect(countOverlaps(r.nodes)).toBe(0);
  });

  it('handles the 39-node stress fixture incl. bidirectional pairs + self-loops', async () => {
    const v = validateModel(stressRaw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const r = await layoutModel(v.model, 'view.stress');
    expect(r.nodes).toHaveLength(39);
    expect(r.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    expect(countOverlaps(r.nodes)).toBe(0);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });

  it('sizes ER entities by field count', () => {
    const small = nodeSize(validFullModel, 'entity.user');
    const big = nodeSize(validFullModel, 'entity.order');
    expect(big.height).toBeGreaterThan(small.height);
  });
});

/** Counts padded node overlaps in layout regression tests. */
function countOverlaps(nodes: PlacedNode[], pad = 8): number {
  let overlaps = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (
        a.x + a.width + pad > b.x &&
        b.x + b.width + pad > a.x &&
        a.y + a.height + pad > b.y &&
        b.y + b.height + pad > a.y
      ) {
        overlaps++;
      }
    }
  }
  return overlaps;
}

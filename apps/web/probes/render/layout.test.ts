import { describe, expect, it } from 'vitest';
import { validateModel, validFullModel } from '@archwoven/model';
import { layoutModel, countOverlaps, nodeSize } from './layout';
import stressRaw from './stress-fixture.json';

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

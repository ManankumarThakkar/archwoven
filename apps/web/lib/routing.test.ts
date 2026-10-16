import { describe, expect, it } from 'vitest';
import { validFullModel, validateModel, type SystemModel } from '@archwoven/model';
import stressRaw from '../probes/render/stress-fixture.json';
import { layoutModel } from './layout';
import { buildSvg } from './export-svg';

type Point = { x: number; y: number };
type Routed = { id: string; points: Point[]; label?: { x: number; y: number; width: number; height: number; lines: string[] } };
const routesOf = (r: unknown) => (r as { edges: Routed[] }).edges;
const inside = (p: Point, n: { x: number; y: number; width: number; height: number }) => p.x > n.x + .1 && p.x < n.x + n.width - .1 && p.y > n.y + .1 && p.y < n.y + n.height - .1;
const segmentCrosses = (a: Point, b: Point, n: { x: number; y: number; width: number; height: number }) => a.x === b.x
  ? a.x > n.x + .1 && a.x < n.x + n.width - .1 && Math.max(a.y, b.y) > n.y + .1 && Math.min(a.y, b.y) < n.y + n.height - .1
  : a.y > n.y + .1 && a.y < n.y + n.height - .1 && Math.max(a.x, b.x) > n.x + .1 && Math.min(a.x, b.x) < n.x + n.width - .1;

describe('shared graph routing', () => {
  it.each(['LR', 'TB'] as const)('preserves boundary-to-boundary directed routes and caption boxes in %s', async orientation => {
    const m = structuredClone(validFullModel), view = m.views.find(v => v.id === 'view.architecture')!; view.orientation = orientation;
    m.edges.find(e => e.id === 'e.user-api')!.label = 'A long user request with details that must remain visible without crossing node boxes';
    const r = await layoutModel(m, view.id), routes = routesOf(r);
    expect(routes).toHaveLength(view.edges.length);
    for (const route of routes) {
      const e = m.edges.find(e => e.id === route.id)!, a = r.nodes.find(n => n.id === e.from)!, b = r.nodes.find(n => n.id === e.to)!;
      expect(route.points.length).toBeGreaterThanOrEqual(2);
      const start = route.points[0]!, end = route.points.at(-1)!;
      expect(start.x).toBeCloseTo(a.x + (orientation === 'LR' ? a.width : a.width / 2));
      expect(start.y).toBeCloseTo(a.y + (orientation === 'LR' ? a.height / 2 : a.height));
      expect(end.x).toBeCloseTo(b.x + (orientation === 'LR' ? 0 : b.width / 2));
      expect(end.y).toBeCloseTo(b.y + (orientation === 'LR' ? b.height / 2 : 0));
      expect(route.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      for (const point of route.points) expect(r.nodes.some(node => inside(point, node))).toBe(false);
      for (let i = 1; i < route.points.length; i++) expect(r.nodes.some(node => segmentCrosses(route.points[i - 1]!, route.points[i]!, node))).toBe(false);
      if (route.label) for (const node of r.nodes) {
        const label = route.label;
        expect(label.x + label.width <= node.x || label.x >= node.x + node.width || label.y + label.height <= node.y || label.y >= node.y + node.height).toBe(true);
      }
    }
    expect(routes.find(e => e.id === 'e.user-api')!.label!.lines.length).toBeGreaterThan(1);
  });
  it('keeps self-relations, reverse edges and parallel connections as separate visible paths', async () => {
    const m: SystemModel = { schemaVersion: '1', revision: 1, title: 'Routing cases', requirements: [], openQuestions: [], boundaries: [], guidedViews: [], privacy: { classification: 'public', boundary: 'external-allowed' },
      nodes: ['a','b'].map(id => ({ id, kind: 'entity', label: id, provenance: 'user-specified', evidence: [], fields: [{ name: 'id', key: 'pk' }] })),
      edges: [
        { id: 'ab', from: 'a', to: 'b', label: 'first', cardinality: '1:N' },
        { id: 'ab2', from: 'a', to: 'b', label: 'second', cardinality: 'N:M' },
        { id: 'ba', from: 'b', to: 'a', label: 'reverse', cardinality: '1:1' },
        { id: 'bb', from: 'b', to: 'b', label: 'parent hierarchy', cardinality: '1:N' },
      ].map(e => ({ ...e, type: 'relation', provenance: 'user-specified', evidence: [] })) as SystemModel['edges'],
      views: [{ id: 'er', type: 'er', orientation: 'LR', nodes: ['a','b'], edges: ['ab','ab2','ba','bb'] }],
    };
    const r = await layoutModel(m, 'er'), routes = routesOf(r);
    expect(routes).toHaveLength(4);
    expect(new Set(routes.map(route => JSON.stringify(route.points))).size).toBe(4);
    const loop = routes.find(e => e.id === 'bb')!;
    expect(loop.points.length).toBeGreaterThan(3);
    expect(loop.points.some((p, i) => i > 0 && (p.x !== loop.points[0]!.x || p.y !== loop.points[0]!.y))).toBe(true);
    const svg = await buildSvg(m, 'er');
    expect(svg).toContain('data-edge="bb"'); expect(svg).toContain('parent hierarchy');
    expect(svg).not.toContain('<line x1=');
  });
  it('routes the 39-node stress view without crossing node interiors or clipping captions', async () => {
    const parsed = validateModel(stressRaw); if (!parsed.ok) throw new Error('invalid stress fixture');
    const result = await layoutModel(parsed.model, 'view.stress');
    for (const route of result.edges) {
      for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1]!, b = route.points[i]!;
        expect(a.x === b.x || a.y === b.y).toBe(true);
        expect(result.nodes.some(node => segmentCrosses(a, b, node)), route.id).toBe(false);
      }
      if (route.label) {
        const box = route.label;
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(result.width);
        expect(box.y + box.height).toBeLessThanOrEqual(result.height);
        for (const node of result.nodes) expect(box.x + box.width <= node.x || box.x >= node.x + node.width || box.y + box.height <= node.y || box.y >= node.y + node.height, route.id).toBe(true);
      }
    }
  });
});

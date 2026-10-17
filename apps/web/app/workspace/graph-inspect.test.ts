import { describe, expect, it } from 'vitest';
import type { SystemModel } from '@archwoven/model';
import { journey, reachability } from './graph-inspect';

const model = (nodes: string[], edges: [string, string][]): SystemModel => ({
  schemaVersion: '1',
  revision: 1,
  title: 't',
  requirements: [],
  openQuestions: [],
  nodes: nodes.map((id) => ({ id, kind: 'service' as const, label: id, provenance: 'source-supported' as const, evidence: [] })),
  edges: edges.map(([from, to], i) => ({ id: `e${i}`, from, to, type: 'sync' as const, provenance: 'source-supported' as const, evidence: [] })),
  views: [],
  boundaries: [],
  guidedViews: [],
  privacy: { classification: 'public', boundary: 'external-allowed' },
});

describe('reachability', () => {
  it('forward depth along a chain', () => {
    const r = reachability(model(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]), 'a');
    expect(r.forward.get('b')).toBe(1);
    expect(r.forward.get('c')).toBe(2);
    expect(r.forward.has('a')).toBe(false);
  });

  it('backward depth against the arrows', () => {
    const r = reachability(model(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]), 'c');
    expect(r.backward.get('b')).toBe(1);
    expect(r.backward.get('a')).toBe(2);
  });

  it('cyclic graph terminates', () => {
    const r = reachability(model(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a']]), 'a');
    expect(r.forward.get('a')).toBeUndefined();
    expect(r.forward.size).toBe(2);
  });

  it('unknown id → empty maps', () => {
    const r = reachability(model(['a'], []), 'ghost');
    expect(r.forward.size).toBe(0);
    expect(r.backward.size).toBe(0);
  });
});

describe('journey', () => {
  it('shortest forward node path', () => {
    const m = model(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'd'], ['a', 'c'], ['c', 'd'], ['d', 'a']]);
    expect(journey(m, 'a', 'd')).toEqual(['a', 'b', 'd']);
  });

  it('unreachable → null', () => {
    expect(journey(model(['a', 'b'], [['a', 'b']]), 'b', 'a')).toBeNull();
  });

  it('same node → [id]', () => {
    expect(journey(model(['a'], []), 'a', 'a')).toEqual(['a']);
  });
});

describe('scale (fastapi-grade, Review Focus 3)', () => {
  const big = () => {
    const nodes = Array.from({ length: 700 }, (_, i) => `n${i}`);
    const edges = Array.from({ length: 1300 }, (_, i): [string, string] => [nodes[i % 700]!, nodes[i < 700 ? (i + 1) % 700 : (i * 7 + 3) % 700]!]);
    return model(nodes, edges);
  };

  it('reachability on 700 nodes < 500ms', () => {
    const t0 = Date.now();
    const r = reachability(big(), 'n0');
    expect(r.forward.has('n699')).toBe(true);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('journey on 700 nodes < 500ms', () => {
    const t0 = Date.now();
    const j = journey(big(), 'n0', 'n699');
    expect(j).not.toBeNull();
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('view-scoped exploration', () => {
  // A hidden shortcut a→c exists in the model (e.g. an internal link) but not in the overview.
  const scoped: SystemModel = {
    schemaVersion: '1', revision: 1, title: 'scoped', requirements: [], openQuestions: [], boundaries: [], guidedViews: [],
    privacy: { classification: 'public', boundary: 'external-allowed' },
    nodes: ['a', 'b', 'c', 'hidden'].map((id) => ({ id, kind: 'service' as const, label: id, provenance: 'inferred' as const, evidence: [] })),
    edges: [
      { id: 'ab', from: 'a', to: 'b', type: 'sync', provenance: 'inferred', evidence: [] },
      { id: 'bc', from: 'b', to: 'c', type: 'sync', provenance: 'inferred', evidence: [] },
      { id: 'a-c', from: 'a', to: 'c', type: 'sync', provenance: 'inferred', evidence: [] },
      { id: 'hidden-c', from: 'hidden', to: 'c', type: 'sync', provenance: 'inferred', evidence: [] },
    ],
    views: [{ id: 'overview', type: 'architecture', nodes: ['a', 'b', 'c'], edges: ['ab', 'bc'] }],
  };

  it('routes only along the view\'s own connections', () => {
    expect(journey(scoped, 'a', 'c')).toEqual(['a', 'c']);
    expect(journey(scoped, 'a', 'c', 'overview')).toEqual(['a', 'b', 'c']);
  });

  it('reports reachability only through the view\'s connections', () => {
    const r = reachability(scoped, 'a', 'overview');
    expect([...r.forward.keys()]).toEqual(['b', 'c']);
    expect(reachability(scoped, 'c', 'overview').backward.has('hidden')).toBe(false);
  });

  it('finds no route when the view has none, even if the model does', () => {
    const m = { ...scoped, views: [{ id: 'overview', type: 'architecture' as const, nodes: ['a', 'c'], edges: [] }] };
    expect(journey(m, 'a', 'c', 'overview')).toBeNull();
  });
});

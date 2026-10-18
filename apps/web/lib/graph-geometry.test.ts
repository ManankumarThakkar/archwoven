import { describe, expect, it } from 'vitest';
import { validFullModel, type SystemModel } from '@archwoven/model';
import { graphScene, warningSummary } from './graph-geometry';
import type { LayoutResult, PlacedNode } from './layout';

const node = (id: string, x: number, y: number): PlacedNode => ({ id, x, y, width: 160, height: 54 });
const scene = (nodes: PlacedNode[], boundaries: SystemModel['boundaries'], warnings: string[] = []) => {
  const model = structuredClone(validFullModel);
  model.nodes = nodes.map(n => ({ id: n.id, label: `Label ${n.id}`, kind: 'service', provenance: 'user-specified', evidence: [] }));
  model.boundaries = boundaries;
  const placed: LayoutResult = { nodes, edges: [], width: 800, height: 500, warnings };
  return { model, placed, result: graphScene(model, placed) };
};
const boundary = { id: 'group.ab', label: 'Core services', wraps: ['a', 'b'] };

describe('truthful boundary scenes shared by canvas and export', () => {
  it('omits an enclosure containing a visible nonmember and discloses preserved membership', () => {
    const { model, placed, result } = scene([node('a', 0, 0), node('b', 600, 0), node('c', 300, 0)], [boundary], ['Routing warning.']);
    expect(result.boundaries).toEqual([]);
    expect(result.warnings[0]).toBe('Routing warning.');
    expect(result.warnings[1]).toBe('Group "Core services" is not drawn as a box because it would also cover Label c. Members shown: Label a, Label b.');
    expect(result.warnings.join(' ')).not.toMatch(/\((a|b|c|group\.ab)\)/);
    expect(result.omittedGroups).toEqual(['Core services']);
    expect(model.boundaries).toEqual([boundary]);
    expect(placed.nodes.map(n => [n.x, n.y])).toEqual([[0, 0], [600, 0], [300, 0]]);
    expect(placed.warnings).toEqual(['Routing warning.']);
  });

  it.each([
    ['node body', 180, 0],
    ['heading', 0, -70],
    ['bottom padding', 0, 77],
  ])('also suppresses partial intersection with the %s', (_part, x, y) => {
    const { result } = scene([node('a', 0, 0), node('c', x, y)], [{ ...boundary, wraps: ['a'] }]);
    expect(result.boundaries).toEqual([]);
    expect(result.warnings.join(' ')).toContain('would also cover Label c.');
  });

  it('retains an ordinary enclosure when nonmembers merely touch its edge', () => {
    const { result } = scene([node('a', 0, 0), node('b', 300, 0), node('c', 484, 0)], [boundary]);
    expect(result.boundaries).toMatchObject([{ id: 'group.ab', x: -24, y: -44, width: 508, height: 122 }]);
    expect(result.warnings).toEqual([]);
  });

  it('suppresses a misleading outer group while retaining its geometrically nested disjoint group', () => {
    const { result } = scene([node('a', 0, 0), node('b', 600, 0), node('c', 300, 0)], [boundary, { id: 'group.c', label: 'Other service', wraps: ['c'] }]);
    expect(result.boundaries.map(b => b.id)).toEqual(['group.c']);
    expect(result.warnings).toHaveLength(1);
  });

  it('retains overlapping padding when neither enclosure intersects nonmember nodes', () => {
    const { result } = scene([node('a', 0, 0), node('b', 200, 0)], [{ ...boundary, wraps: ['a'] }, { id: 'group.b', label: 'Other service', wraps: ['b'] }]);
    expect(result.boundaries.map(b => b.id)).toEqual(['group.ab', 'group.b']);
    expect(result.warnings).toEqual([]);
  });

  it('checks only visible nodes and omits boundaries with no visible members quietly', () => {
    const { result } = scene([node('a', 0, 0)], [{ ...boundary, wraps: ['a', 'hidden'] }, { id: 'hidden', label: 'Hidden group', wraps: ['hidden'] }]);
    expect(result.boundaries.map(b => b.id)).toEqual(['group.ab']);
    expect(result.warnings).toEqual([]);
  });

  it('fits truthful groups at negative manual positions without changing their coordinates', () => {
    const { result, placed } = scene([node('a', -700, -500), node('b', -400, -500)], [boundary]);
    placed.bounds = { x: -740, y: -540, width: 540, height: 134 };
    const negative = graphScene(scene(placed.nodes, [boundary]).model, placed);
    expect(result.boundaries).toMatchObject([{ x: -724, y: -544, width: 508, height: 122 }]);
    expect(negative.bounds).toEqual({ x: -740, y: -552, width: 540, height: 146 });
    expect(negative.warnings).toEqual([]);
  });
});

describe('layout warning summary', () => {
  it('names omitted groups in one line and keeps other warnings as they are', () => {
    expect(warningSummary({ warnings: ['Routing warning.', 'Group "A" is not drawn as a box because it would also cover X. Members shown: Y.'], omittedGroups: ['A'] }))
      .toEqual(['1 group is not drawn as a box, to avoid covering other components: A.', 'Routing warning.']);
    const detail = (label: string) => `Group "${label}" is not drawn as a box because it would also cover X. Members shown: Y.`;
    expect(warningSummary({ warnings: [detail('Core'), detail('Edge')], omittedGroups: ['Core', 'Edge'] }))
      .toEqual(['2 groups are not drawn as boxes, to avoid covering other components: Core, Edge.']);
    expect(warningSummary({ warnings: [], omittedGroups: [] })).toEqual([]);
  });

  it('lists at most three covered components in a detail message', () => {
    const many = [node('a', 0, 0), node('b', 900, 0), ...['c', 'd', 'e', 'f', 'g'].map((id, i) => node(id, 150 + i * 150, 0))];
    const { result } = scene(many, [boundary]);
    expect(result.warnings[0]).toBe('Group "Core services" is not drawn as a box because it would also cover Label c, Label d, Label e and 2 more. Members shown: Label a, Label b.');
  });
});

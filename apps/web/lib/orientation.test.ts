import { describe, expect, it } from 'vitest';
import { orientArchitecture, validFullModel } from '@archwoven/model';
import { buildSvg } from './export-svg';
import { layoutModel } from './layout';

describe('saved direction in the shared workspace/export scene', () => {
  it.each(['LR', 'TB'] as const)('replaces manual placements with a directed %s scene in layout and SVG', async direction => {
    const model = structuredClone(validFullModel), view = model.views[0]!;
    view.nodes = ['actor.user', 'gateway.api']; view.edges = ['e.user-api']; view.orientation = direction === 'LR' ? 'TB' : 'LR';
    model.layout = { 'actor.user': { x: 9000, y: 50 }, 'gateway.api': { x: 9000, y: 500 } };
    const result = orientArchitecture(model, view.id, direction);
    expect(result.ok).toBe(true); if (!result.ok) return;
    const placed = await layoutModel(result.model, view.id), a = placed.nodes.find(n => n.id === 'actor.user')!, b = placed.nodes.find(n => n.id === 'gateway.api')!;
    if (direction === 'LR') expect(b.x).toBeGreaterThan(a.x + a.width);
    else expect(b.y).toBeGreaterThan(a.y + a.height);
    expect(Math.max(...placed.nodes.map(n => Math.max(n.x, n.y)))).toBeLessThan(1000);
    const svg = await buildSvg(result.model, view.id);
    const box = (id: string) => svg.split(`data-node="${id}"`)[1]!.match(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/)!.slice(1).map(Number);
    const from = box('actor.user'), to = box('gateway.api');
    if (direction === 'LR') expect(to[0]!).toBeGreaterThan(from[0]! + from[2]!);
    else expect(to[1]!).toBeGreaterThan(from[1]! + from[3]!);
    expect(svg).toContain('data-edge="e.user-api"');
    expect(result.model.nodes).toEqual(model.nodes); expect(result.model.edges).toEqual(model.edges);
  });
});

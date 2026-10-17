import { expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { layoutModel } from './layout';
import { manualLayout } from './manual-layout';
import { buildSvg } from './export-svg';
import { validateModel } from '@archwoven/model';
import stressRaw from '../probes/render/stress-fixture.json';
it('honors saved positions exactly and routes around the moved node interiors', async () => {
    const model = structuredClone(validFullModel), view = model.views.find(v => v.type === 'architecture')!;
    view.nodes = ['actor.user', 'gateway.api', 'svc.orders'];
    view.edges = ['e.user-api'];
    view.orientation = 'LR';
    model.layout = { 'actor.user': { x: -200, y: 0 }, 'gateway.api': { x: 500, y: 0 }, 'svc.orders': { x: 100, y: 0 } };
    const placed = await layoutModel(model, view.id);
    for (const node of placed.nodes)
        expect({ x: node.x, y: node.y }).toEqual(model.layout[node.id]);
    const path = placed.edges[0]!.points, from = placed.nodes[0]!, to = placed.nodes[1]!;
    expect(path[0]).toEqual({ x: from.x + from.width, y: from.y + from.height / 2 });
    expect(path.at(-1)).toEqual({ x: to.x, y: to.y + to.height / 2 });
    for (let i = 1; i < path.length; i++)
        for (const node of placed.nodes) {
            const a = path[i - 1]!, b = path[i]!;
            const crosses = a.x === b.x ? a.x > node.x && a.x < node.x + node.width && Math.max(a.y, b.y) > node.y && Math.min(a.y, b.y) < node.y + node.height : a.y > node.y && a.y < node.y + node.height && Math.max(a.x, b.x) > node.x && Math.min(a.x, b.x) < node.x + node.width;
            expect(crosses).toBe(false);
        }
});
it('keeps moved self-relations visible and fits exports around far or negative positions after rename', async () => {
    const model = structuredClone(validFullModel), view = model.views.find(v => v.type === 'architecture')!;
    view.nodes = ['gateway.api'];
    view.edges = ['e.user-api'];
    const edge = model.edges.find(e => e.id === 'e.user-api')!;
    edge.from = edge.to = 'gateway.api';
    edge.label = 'retry';
    model.layout = { 'gateway.api': { x: 10000, y: -800 } };
    model.nodes.find(n => n.id === 'gateway.api')!.label = 'Renamed coordinator';
    const placed = await layoutModel(model, view.id);
    expect(placed.nodes[0]).toMatchObject({ x: 10000, y: -800 });
    expect(placed.edges[0]!.points.length).toBeGreaterThan(3);
    const svg = await buildSvg(model, view.id), [x, y, w, h] = svg.match(/viewBox="([^"]+)"/)![1]!.split(' ').map(Number);
    expect(x).toBeGreaterThan(9000);
    expect(y).toBeLessThan(-800);
    expect(w).toBeLessThan(1000);
    expect(h).toBeLessThan(1000);
});
it('keeps the 39-node layout bounded when all visible positions are saved', async () => {
    const parsed = validateModel(stressRaw);
    if (!parsed.ok)
        throw Error('invalid fixture');
    const model = parsed.model, auto = await layoutModel(model, 'view.stress');
    model.layout = Object.fromEntries(auto.nodes.map(n => [n.id, { x: n.x, y: n.y }]));
    const manual = await layoutModel(model, 'view.stress');
    expect(manual.nodes).toHaveLength(39);
    expect(manual.edges).toHaveLength(auto.edges.length);
    expect(manual.warnings).toEqual([]);
    expect(manual.edges.every(e => e.points.length >= 2 && e.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))).toBe(true);
    for (const node of manual.nodes)
        expect({ x: node.x, y: node.y }).toEqual(model.layout[node.id]);
});
it('keeps a visible detour when moved nodes have touching source and target handles', async () => {
    const model = structuredClone(validFullModel), view = model.views.find(v => v.type === 'architecture')!;
    view.nodes = ['actor.user', 'gateway.api'];
    view.edges = ['e.user-api'];
    view.orientation = 'LR';
    const auto = await layoutModel(model, view.id), source = auto.nodes.find(n => n.id === 'actor.user')!, target = auto.nodes.find(n => n.id === 'gateway.api')!;
    model.layout = { 'actor.user': { x: 0, y: 0 }, 'gateway.api': { x: source.width, y: (source.height - target.height) / 2 } };
    const manual = await layoutModel(model, view.id), points = manual.edges[0]!.points;
    expect(points[0]).toEqual(points.at(-1));
    expect(points.some(p => p.x !== points[0]!.x || p.y !== points[0]!.y)).toBe(true);
});
it('discloses ignored legacy positions in the workspace layout and export description', async () => {
    const model = structuredClone(validFullModel), view = model.views.find(v => v.type === 'architecture')!;
    model.layout = { [view.nodes[0]!]: { x: 1e12, y: 0 } };
    const placed = await layoutModel(model, view.id);
    expect(placed.warnings?.join(' ')).toContain('outside the supported range');
    expect(await buildSvg(model, view.id)).toMatch(/<desc>[^<]*outside the supported range/);
});
it('bounds total routing work for irregular 80-node views without discarding connections', () => {
    const model = structuredClone(validFullModel);
    model.nodes = Array.from({ length: 80 }, (_, i) => ({ id: `n${i}`, kind: 'service', label: `N${i}`, provenance: 'user-specified', evidence: [] }));
    model.edges = Array.from({ length: 160 }, (_, i) => ({ id: `e${i}`, from: `n${i % 80}`, to: `n${(17 * i + 9) % 80}`, type: 'sync', provenance: 'user-specified', evidence: [] }));
    const view = { id: 'irregular', type: 'architecture' as const, orientation: 'LR' as const, nodes: model.nodes.map(n => n.id), edges: model.edges.map(e => e.id) };
    model.views = [view];
    const nodes = model.nodes.map((n, i) => ({ id: n.id, x: (i % 10) * 300 + i * .7, y: Math.floor(i / 10) * 200 + i * .9, width: 160, height: 54 }));
    model.layout = Object.fromEntries(nodes.map(n => [n.id, { x: n.x, y: n.y }]));
    const result = manualLayout(model, view, { width: 3000, height: 2000, nodes, edges: model.edges.map(e => ({ id: e.id, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })) });
    expect(result.warnings?.join(' ')).toContain('Routing work limit reached');
    expect(result.nodes).toHaveLength(80);
    expect(result.edges).toHaveLength(160);
    expect(result.edges.every(e => e.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))).toBe(true);
});

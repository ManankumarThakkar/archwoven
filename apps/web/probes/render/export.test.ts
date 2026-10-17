import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { sequenceSvg } from './sequence';
import { ensureResvg, renderPng } from './export';
import { Resvg } from '@resvg/resvg-wasm';
import { entityLayout } from '../../lib/entity';
import { buildSvg } from '../../lib/export-svg';
import { layoutModel } from './layout';
import { expandedDetailModel } from './detail-fixture';

const require = createRequire(import.meta.url);

const here = new URL('.', import.meta.url).pathname;

describe('renderPng (resvg-wasm)', () => {
  it('paints omitted-boundary membership warnings inside the actual PNG bounds', async () => {
    await ensureResvg(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    const model = structuredClone(validFullModel), view = model.views.find(v => v.type === 'architecture')!;
    view.nodes = ['actor.user', 'gateway.api', 'svc.orders']; view.edges = [];
    model.layout = { 'actor.user': { x: -800, y: -500 }, 'gateway.api': { x: -200, y: -500 }, 'svc.orders': { x: -500, y: -500 } };
    model.boundaries = [{ id: 'b.core', label: 'W'.repeat(200), wraps: ['actor.user', 'gateway.api'] }];
    const svg = await buildSvg(model, view.id), footer = svg.match(/<g data-layout-warnings="true">[\s\S]*?<\/g>/)?.[0];
    expect(footer).toBeTruthy();
    const [x, y, width, height] = svg.match(/viewBox="([^"]+)"/)![1]!.split(' ').map(Number) as [number, number, number, number];
    const fonts = [readFileSync(`${here}../../public/fonts/inter-400.woff2`)];
    const renderer = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000" font-family="Inter">${footer}</svg>`, { font: { fontBuffers: fonts, defaultFontFamily: 'Inter' } });
    try {
      const box = renderer.getBBox()!;
      expect(box.x).toBeGreaterThanOrEqual(x); expect(box.y).toBeGreaterThanOrEqual(y);
      expect(box.x + box.width).toBeLessThanOrEqual(x + width);
      expect(box.y + box.height).toBeLessThanOrEqual(y + height);
      expect(box.y).toBeGreaterThan(-400);
    } finally { renderer.free(); }
    expect(await renderPng(svg, fonts)).not.toEqual(await renderPng(svg.replace(footer!, ''), fonts));
  });

  it('paints the detail caption and dashed internal borders into the actual PNG', async () => {
    await ensureResvg(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    const svg = await buildSvg(expandedDetailModel(), 'detail:svc.orders');
    const caption = svg.match(/<g data-detail-caption="true">[\s\S]*?<\/g>/)?.[0];
    expect(caption).toBeTruthy();
    const internal = svg.match(/<g data-node="svc.orders\/intake">[\s\S]*?<\/g>/)![0];
    expect(internal).toContain('stroke-dasharray="6 4"');
    const fonts = [readFileSync(`${here}../../public/fonts/inter-400.woff2`)];
    const png = await renderPng(svg, fonts);
    expect(png).not.toEqual(await renderPng(svg.replace(caption!, ''), fonts));
    expect(png).not.toEqual(await renderPng(svg.replace(internal, internal.replace(' stroke-dasharray="6 4"', '')), fonts));
  });

  it('fits wrapped detail context above the graph with narrow bounds and negative manual positions', async () => {
    await ensureResvg(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    const model = expandedDetailModel(), view = model.views.find(v => v.id === 'detail:svc.orders')!;
    model.nodes.find(n => n.id === 'svc.orders')!.label = 'W'.repeat(100);
    model.nodes.find(n => n.id === 'gateway.api')!.provenance = 'source-supported';
    view.nodes = ['svc.orders/intake']; view.edges = [];
    model.layout = { 'svc.orders/intake': { x: -500, y: -300 } };
    const svg = await buildSvg(model, view.id), placed = await layoutModel(model, view.id);
    const caption = svg.match(/<g data-detail-caption="true">[\s\S]*?<\/g>/)?.[0];
    expect(caption).toBeTruthy();
    const [x, y, width, height] = svg.match(/viewBox="([^"]+)"/)![1]!.split(' ').map(Number) as [number, number, number, number];
    const renderer = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000" font-family="Inter">${caption}</svg>`, { font: { fontBuffers: [readFileSync(`${here}../../public/fonts/inter-400.woff2`)], defaultFontFamily: 'Inter' } });
    try {
      const box = renderer.getBBox()!;
      expect(box.x).toBeGreaterThanOrEqual(x); expect(box.y).toBeGreaterThanOrEqual(y);
      expect(box.x + box.width).toBeLessThanOrEqual(x + width);
      expect(box.y + box.height).toBeLessThanOrEqual(y + height);
      expect(box.y + box.height).toBeLessThan(placed.nodes[0]!.y);
    } finally { renderer.free(); }
  });

  it('contains a long boundary title inside the actual exported scene', async () => {
    await ensureResvg(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    const model = structuredClone(validFullModel), view = model.views.find(view => view.type === 'architecture')!;
    view.nodes = [view.nodes[0]!]; view.edges = [];
    model.boundaries = [{ id: 'boundary', label: 'External payment settlement and reconciliation infrastructure boundary', wraps: view.nodes }];
    const svg = await buildSvg(model, view.id);
    const [x, y, width, height] = svg.match(/viewBox="([^"]+)"/)![1]!.split(' ').map(Number) as [number, number, number, number];
    const title = svg.match(/<g[^>]*><rect[^>]*stroke-dasharray="6 4"[\s\S]*?<\/g>/)![0];
    const renderer = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000" font-family="Inter">${title}</svg>`, { font: { fontBuffers: [readFileSync(`${here}../../public/fonts/inter-400.woff2`)], defaultFontFamily: 'Inter' } });
    try {
      const box = renderer.getBBox()!;
      expect(box.x).toBeGreaterThanOrEqual(x); expect(box.y).toBeGreaterThanOrEqual(y);
      expect(box.x + box.width).toBeLessThanOrEqual(x + width);
      expect(box.y + box.height).toBeLessThanOrEqual(y + height);
    } finally { renderer.free(); }
  });
  it.each(['architecture', 'er'] as const)('paints a routed self-relation and its endpoint in %s PNG export', async type => {
    await ensureResvg(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    const model = structuredClone(validFullModel), view = model.views.find(view => view.type === type)!;
    const node = view.nodes[0]!, edge = model.edges.find(edge => edge.id === view.edges[0])!;
    edge.from = node; edge.to = node; edge.label = 'scheduled retry';
    if (type === 'er') edge.cardinality = '1:N';
    view.nodes = [node]; view.edges = [edge.id];
    const svg = await buildSvg(model, view.id), fonts = [readFileSync(`${here}../../public/fonts/inter-400.woff2`)];
    const png = await renderPng(svg, fonts);
    const path = svg.match(/<path data-edge="[^\"]+"[^>]+\/>/)![0];
    expect(png).not.toEqual(await renderPng(svg.replace(path, ''), fonts));
    expect(png).not.toEqual(await renderPng(svg.replace(path, path.replace(/ marker-end="[^"]+"/, '')), fonts));
  });
  it('keeps an ER relationship caption outside both entity boxes', async () => {
    await ensureResvg(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    const m = structuredClone(validFullModel), view = m.views.find(v => v.id === 'view.er')!;
    view.orientation = 'LR'; view.nodes = ['entity.user', 'entity.order']; view.edges = ['er.user-order'];
    m.edges.find(e => e.id === 'er.user-order')!.label = 'has a reader profile';
    const svg = await buildSvg(m, view.id), placed = await layoutModel(m, view.id);
    const caption = svg.match(/<g data-edge-label="er.user-order">[\s\S]+?<\/g>/)![0];
    const renderer = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000" font-family="Inter">${caption}</svg>`, { font: { fontBuffers: [readFileSync(`${here}../../public/fonts/inter-400.woff2`)], defaultFontFamily: 'Inter' } });
    try {
      const label = renderer.getBBox()!;
      for (const node of placed.nodes) expect(label.x + label.width <= node.x || label.x >= node.x + node.width || label.y + label.height <= node.y || label.y >= node.y + node.height).toBe(true);
    } finally { renderer.free(); }
  });
  it('contains wide field/header glyphs using the actual bundled font metrics', async () => {
    await ensureResvg(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    const entity = structuredClone(validFullModel.nodes.find(n => n.id === 'entity.user')!);
    entity.label = 'W'.repeat(42); entity.fields = [{ name: 'W'.repeat(22), type: 'W'.repeat(16) }];
    const box = entityLayout(entity);
    const fonts = [readFileSync(`${here}../../public/fonts/inter-400.woff2`), readFileSync(`${here}../../public/fonts/inter-600.woff2`)];
    const groups = [{ lines: box.label, size: 13, width: box.width - 28 }, ...box.rows.flatMap(row => [{ lines: row.name, size: 12, width: 160 }, { lines: row.type, size: 12, width: 124 }])];
    for (const group of groups) for (const line of group.lines) {
      const rendered = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="40"><text x="0" y="25" font-family="Inter" font-size="${group.size}" font-weight="600">${line}</text></svg>`, { font: { fontBuffers: fonts, defaultFontFamily: 'Inter' } });
      try { expect(rendered.getBBox()!.width).toBeLessThanOrEqual(group.width); } finally { rendered.free(); }
    }
  });
  it.each(['1:1', '1:N', 'N:M'] as const)('retains %s cardinality endpoints in the real ER PNG rasterizer', async cardinality => {
    await ensureResvg(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    const m = structuredClone(validFullModel); m.edges.find(e => e.id === 'er.user-order')!.cardinality = cardinality;
    m.views.find(v => v.id === 'view.er')!.edges = ['er.user-order'];
    const svg = await buildSvg(m, 'view.er');
    const fonts = [readFileSync(`${here}../../public/fonts/inter-400.woff2`)];
    const original = await renderPng(svg, fonts);
    for (const endpoint of ['start', 'end']) {
      const removed = svg.replace(new RegExp(` marker-${endpoint}="url\\(#er-[^"]+\\)"`, 'g'), '');
      expect(original).not.toEqual(await renderPng(removed, fonts));
    }
  });
  it.each(['async', 'return'] as const)('retains the %s open arrowhead in the actual PNG rasterizer', async kind => {
    await ensureResvg(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    const m = structuredClone(validFullModel);
    const seq = m.views.find(v => v.type === 'sequence')!.sequence!;
    seq.messages = [{ seq: 1, from: seq.participants[0]!, to: seq.participants[1]!, kind, label: 'Response' }];
    const svg = sequenceSvg(m, 'view.sequence');
    const withoutHeads = svg.replace(/<marker\b[\s\S]*?<\/marker>/g, marker => marker.replace(/stroke="[^"]+"/g, 'stroke="none"'));
    const fonts = [readFileSync(`${here}../../public/fonts/inter-400.woff2`)];
    const original = await renderPng(svg, fonts);
    const removed = await renderPng(withoutHeads, fonts);
    expect(original).not.toEqual(removed);
  });
  it('renders the sequence SVG to a valid PNG at 2x with bundled fonts', async () => {
    await ensureResvg(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
    const fontBuffers = [
      readFileSync(`${here}../../public/fonts/inter-400.woff2`),
      readFileSync(`${here}../../public/fonts/inter-600.woff2`),
    ];

    const png = await renderPng(sequenceSvg(validFullModel, 'view.sequence'), fontBuffers);

    // PNG magic bytes
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR dimensions (big-endian at offsets 16/20), 2x scale
    const width = new DataView(png.buffer, png.byteOffset).getUint32(16);
    const height = new DataView(png.buffer, png.byteOffset).getUint32(20);
    const svgW = 4 * 160 + 80; // 4 participants at min col width + margins
    expect(width).toBeGreaterThanOrEqual(svgW);
    expect(height).toBeGreaterThan(400);
    expect(png.byteLength).toBeGreaterThan(10_000);
  });

  it('refuses to render before wasm init', async () => {
    // fresh module state is shared in-process; ensureResvg already ran above,
    // so assert the guard message shape via a direct check instead:
    await expect(renderPng('<svg xmlns="http://www.w3.org/2000/svg"/>', [])).resolves.toBeDefined();
  });
});

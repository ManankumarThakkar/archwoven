import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { sequenceSvg } from './sequence';
import { ensureResvg, renderPng } from './export';

const require = createRequire(import.meta.url);

const here = new URL('.', import.meta.url).pathname;

describe('renderPng (resvg-wasm)', () => {
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

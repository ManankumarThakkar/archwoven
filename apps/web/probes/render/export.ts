import { initWasm, Resvg } from '@resvg/resvg-wasm';

let wasmReady: Promise<void> | null = null;

/**
 * Initialize resvg-wasm once.
 * Browser: ensureResvg(fetch('/resvg/index_bg.wasm').then(r => r.arrayBuffer()))
 * Node:    ensureResvg(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')))
 */
export function ensureResvg(wasmBytes: Uint8Array | ArrayBuffer | Promise<Uint8Array | ArrayBuffer>): Promise<void> {
  wasmReady ??= Promise.resolve(wasmBytes).then((bytes) => initWasm(bytes));
  return wasmReady;
}

/**
 * SVG string → PNG bytes at 2x. Fonts must be supplied explicitly —
 * resvg-wasm has no system fonts (Review Focus 4: blank text without fontBuffers).
 */
export async function renderPng(
  svg: string,
  fontBuffers: Uint8Array[],
  scale = 2,
): Promise<Uint8Array> {
  if (!wasmReady) throw new Error('ensureResvg() must be called before renderPng()');
  await wasmReady;
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: { fontBuffers, defaultFontFamily: 'Inter' },
  });
  return resvg.render().asPng();
}

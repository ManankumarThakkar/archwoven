/** Load one bundled rendering asset (the resvg build or an Inter font) by its public path. */
export type AssetLoader = (path: string) => Promise<Uint8Array>;

const fetchAsset: AssetLoader = async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Export asset unavailable: ${path}`);
  return new Uint8Array(await res.arrayBuffer());
};

/** Render an SVG to PNG in the browser with the bundled resvg build and Inter fonts; nothing is sent to a server. */
export async function svgToPng(svg: string, scale = 2, load: AssetLoader = fetchAsset): Promise<Blob> {
  const { ensureResvg, renderPng } = await import('../probes/render/export');
  const [wasm, ...fonts] = await Promise.all(['/resvg/index_bg.wasm', '/fonts/inter-400.woff2', '/fonts/inter-600.woff2'].map(async (path) => {
    const bytes = await load(path);
    if (!bytes.byteLength) throw new Error(`Export asset empty: ${path}`);
    return bytes;
  }));
  await ensureResvg(wasm!);
  const png = await renderPng(svg, fonts, scale);
  return new Blob([png as unknown as BlobPart], { type: 'image/png' });
}

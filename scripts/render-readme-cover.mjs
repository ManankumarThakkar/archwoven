#!/usr/bin/env node
// First-party README artwork, rendered with the same bundled font as the site.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const web = new URL('apps/web/', root);
const { initWasm, Resvg } = createRequire(new URL('package.json', web))('@resvg/resvg-wasm');
await initWasm(readFileSync(new URL('public/resvg/index_bg.wasm', web)));
const renderer = new Resvg(readFileSync(new URL('docs/assets/cover.svg', root), 'utf8'), {
  font: { fontBuffers: ['400', '600'].map(weight => readFileSync(new URL(`public/fonts/inter-${weight}.woff2`, web))), defaultFontFamily: 'Inter', loadSystemFonts: false },
});
try {
  const image = renderer.render();
  try { writeFileSync(new URL('docs/assets/cover.png', root), image.asPng()); }
  finally { image.free(); }
} finally { renderer.free(); }
console.log('Rendered docs/assets/cover.png (1600 × 840).');

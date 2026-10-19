#!/usr/bin/env node
// Regenerate the static social image after editing public/og.svg. No network or provider calls.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const web = new URL('../apps/web/', import.meta.url);
const { initWasm, Resvg } = createRequire(new URL('package.json', web))('@resvg/resvg-wasm');
await initWasm(readFileSync(new URL('public/resvg/index_bg.wasm', web)));
const svg = new Resvg(readFileSync(new URL('public/og.svg', web), 'utf8'), {
  font: { fontBuffers: [readFileSync(new URL('public/fonts/inter-400.woff2', web)), readFileSync(new URL('public/fonts/inter-600.woff2', web))], defaultFontFamily: 'Inter', loadSystemFonts: false },
});
try {
  const image = svg.render();
  try { writeFileSync(new URL('public/og.png', web), image.asPng()); }
  finally { image.free(); }
} finally { svg.free(); }
console.log('Rendered public/og.png at 1200×630.');

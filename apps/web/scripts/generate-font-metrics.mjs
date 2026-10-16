// Run after changing the bundled Inter files: node apps/web/scripts/generate-font-metrics.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
const require = createRequire(import.meta.url);
await initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
const fonts = ['400', '600'].map(weight => readFileSync(new URL(`../public/fonts/inter-${weight}.woff2`, import.meta.url)));
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const bboxWidth = (text, weight) => {
  const r = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="2000"><text x="100" y="1200" font-family="Inter" font-size="1000" font-weight="${weight}">${esc(text)}</text></svg>`, { font: { fontBuffers: fonts, defaultFontFamily: 'Inter' } });
  try { return r.getBBox()?.width ?? 0; } finally { r.free(); }
};
const advance = [];
for (let code = 32; code <= 126; code++) {
  const character = String.fromCharCode(code);
  const measured = Math.max(...['400', '600'].map(weight => (bboxWidth(`M${character}M`, weight) - bboxWidth('MM', weight)) / 1000));
  // Padding covers pair kerning/bearing variation; unknown Unicode uses 1.2em.
  advance.push(Math.ceil((Math.max(0.2, measured) + 0.08) * 10000) / 10000);
}
const hashes = fonts.map(bytes => createHash('sha256').update(bytes).digest('hex'));
writeFileSync(new URL('../lib/font-metrics.ts', import.meta.url), `// Generated from the bundled Inter 400/600 fonts; regenerate with scripts/generate-font-metrics.mjs.\nexport const FONT_SHA256 = ${JSON.stringify(hashes)} as const;\n// ASCII code points 32..126, in em, with a conservative per-glyph safety margin.\nexport const ASCII_ADVANCE_EM = ${JSON.stringify(advance)} as const;\n`);

import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FONT_SHA256 } from './font-metrics';
import { textWidth, wrapText } from './svg-text';
it('keeps the advance table pinned to the actual bundled font assets', () => {
  for (const [i, weight] of ['400','600'].entries()) expect(createHash('sha256').update(readFileSync(new URL(`../public/fonts/inter-${weight}.woff2`, import.meta.url))).digest('hex')).toBe(FONT_SHA256[i]);
});
it('wraps wide glyphs and long Unicode identifiers without dropping or splitting characters', () => {
  for (const text of ['W'.repeat(100), 'reader_profile_identifier', '😀'.repeat(24)]) {
    const lines = wrapText(text, 160, 12);
    expect(lines.join('')).toBe(text);
    expect(lines.every(line => textWidth(line, 12) <= 160)).toBe(true);
    expect(lines.every(line => !/[\uD800-\uDBFF]$/.test(line))).toBe(true);
  }
  expect(wrapText('display_name', 160, 12)).toEqual(['display_name']);
});

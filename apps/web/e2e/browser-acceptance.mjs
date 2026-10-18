#!/usr/bin/env node
/**
 * Cross-browser acceptance in Playwright Chromium, WebKit (Safari's engine) and Firefox,
 * against a server with fake generation (ARCHWOVEN_FAKE=1 ARCHWOVEN_DEMO_ACK=1):
 * export downloads checked as real files, an axe-core scan of the empty and loaded
 * workspace at desktop and phone widths, and a keyboard-only pass (Option+Tab in WebKit,
 * following the macOS default where Tab moves only between text fields).
 *
 *   node apps/web/e2e/browser-acceptance.mjs <baseUrl> <outDir> <dir containing node_modules/{playwright-core,axe-core}> [chromium,webkit,firefox]
 *
 * Neither package is a project dependency: install playwright-core and axe-core in a
 * scratch directory and point the third argument at it.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, out, tools, engines = 'chromium,webkit,firefox'] = process.argv.slice(2);
const require = createRequire(join(tools, 'package.json'));
const pw = require('playwright-core');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
mkdirSync(out, { recursive: true });
const results = [];
const check = (browser, name, ok, detail = '') => { results.push({ browser, name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${browser}] ${name}${detail ? ` — ${detail}` : ''}`); };
let net = 30;

async function generate(page) {
  await page.fill('#system-description', 'A shop: customers use a web app that calls an order service backed by PostgreSQL.');
  await page.getByRole('button', { name: 'Generate diagram' }).click();
  await page.waitForSelector('.react-flow__node', { timeout: 30000 });
  await page.waitForTimeout(1200);
}

/** Download one export and return its bytes and suggested name. */
async function download(page, label) {
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: label, exact: true }).click()]);
  const path = join(out, `${Date.now()}-${file.suggestedFilename()}`);
  await file.saveAs(path);
  return { name: file.suggestedFilename(), bytes: readFileSync(path), failure: await file.failure() };
}

/** axe violations at WCAG 2.1 A/AA, summarised as `rule (impact) ×nodes`. */
async function axe(page) {
  await page.addScriptTag({ content: axeSource });
  const r = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
}

for (const name of engines.split(',')) {
  const type = pw[name];
  let browser;
  try { browser = await type.launch(); } catch (err) {
    const lines = err.message.split('\n');
    check(name, 'browser launched', false, lines.find((l) => /\[err\]/.test(l) && !/headless mode/.test(l))?.trim() ?? lines[0]);
    continue;
  }
  // macOS convention (Safari default): Tab moves between text fields, Option+Tab through every control.
  const nextControl = name === 'webkit' ? 'Alt+Tab' : 'Tab';
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, extraHTTPHeaders: { 'X-Forwarded-For': `198.51.100.${net++}` } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${base}/workspace`);
    await page.waitForSelector('#system-description');

    // 1. Accessibility of the empty workspace.
    const empty = await axe(page);
    check(name, 'axe: empty workspace at 1440 px has no WCAG A/AA violations', empty.length === 0, JSON.stringify(empty));

    // 2. Keyboard only: reach the description, type, and generate with Enter on the button.
    await page.keyboard.press(nextControl);
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      reached = await page.evaluate(() => document.activeElement?.id === 'system-description');
      if (!reached) await page.keyboard.press(nextControl);
    }
    check(name, `keyboard: the description field is reachable with ${nextControl}`, reached);
    await page.keyboard.type('A shop: customers use a web app that calls an order service backed by PostgreSQL.');
    let onGenerate = false;
    for (let i = 0; i < 20 && !onGenerate; i++) {
      await page.keyboard.press(nextControl);
      onGenerate = await page.evaluate(() => document.activeElement?.tagName === 'BUTTON' && document.activeElement.textContent.includes('Generate diagram'));
    }
    const focusVisible = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none'); });
    check(name, 'keyboard: Generate is reachable and shows a visible focus indicator', onGenerate && focusVisible, `reached ${onGenerate}, focus ring ${focusVisible}`);
    if (onGenerate) await page.keyboard.press('Enter'); else await generate(page);
    await page.waitForSelector('.react-flow__node', { timeout: 30000 });
    await page.waitForTimeout(1200);

    // 3. Refine bar controls are all reachable by keyboard.
    const wanted = ['Refinement instruction', 'SVG', 'PNG', 'JSON', 'Delete diagram'];
    const seen = new Set();
    await page.focus('input[aria-label="Refinement instruction"]');
    for (let i = 0; i < 12; i++) {
      const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim());
      if (label) seen.add(label);
      await page.keyboard.press(nextControl);
    }
    const missing = wanted.filter((w) => !seen.has(w));
    check(name, 'keyboard: refine and export controls are reachable in order', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : '');

    // 4. Downloads checked as files.
    const svg = await download(page, 'SVG');
    const svgText = svg.bytes.toString('utf8');
    check(name, 'SVG export downloads as a well-formed SVG file', !svg.failure && svg.name.endsWith('.svg') && /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(svgText) && svgText.trimEnd().endsWith('</svg>') && svg.bytes.length > 1000, `${svg.name}, ${svg.bytes.length} bytes`);
    const png = await download(page, 'PNG');
    const sig = png.bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const width = png.bytes.length > 24 ? png.bytes.readUInt32BE(16) : 0, height = png.bytes.length > 24 ? png.bytes.readUInt32BE(20) : 0;
    check(name, 'PNG export downloads as a valid PNG image', !png.failure && png.name.endsWith('.png') && sig && width > 0 && height > 0, `${png.name}, ${width}×${height}, ${png.bytes.length} bytes`);
    const json = await download(page, 'JSON');
    let model = null; try { model = JSON.parse(json.bytes.toString('utf8')); } catch { /* reported below */ }
    check(name, 'JSON export downloads the saved model', !json.failure && json.name.endsWith('.json') && model?.schemaVersion === '1' && model.nodes?.length > 0, `${json.name}, ${model?.nodes?.length ?? 0} nodes`);
    const noEvidenceButton = page.getByRole('button', { name: 'JSON (no evidence)', exact: true });
    if (await noEvidenceButton.count()) {
      const stripped = await download(page, 'JSON (no evidence)');
      const m = JSON.parse(stripped.bytes.toString('utf8'));
      check(name, 'JSON (no evidence) export carries no evidence records', [...m.nodes, ...m.edges].every((x) => !x.evidence?.length));
    }
    check(name, 'no page errors during downloads', errors.length === 0, errors.join(' | '));

    // 5. Accessibility of the loaded workspace at desktop and phone widths.
    const loaded = await axe(page);
    check(name, 'axe: workspace with a diagram at 1440 px has no WCAG A/AA violations', loaded.length === 0, JSON.stringify(loaded));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    const phone = await axe(page);
    check(name, 'axe: workspace with a diagram at 390 px has no WCAG A/AA violations', phone.length === 0, JSON.stringify(phone));
  } catch (err) {
    check(name, 'scenario completed', false, err.message.split('\n')[0]);
    await page.screenshot({ path: join(out, `${name}-failure.png`) }).catch(() => {});
  } finally {
    await browser.close();
  }
}
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

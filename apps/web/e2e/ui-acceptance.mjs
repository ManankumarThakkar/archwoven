#!/usr/bin/env node
/**
 * Workspace acceptance in Playwright Chromium and WebKit (Safari's engine), run against
 * a server with fake generation (ARCHWOVEN_FAKE=1 ARCHWOVEN_DEMO_ACK=1). Checks touch
 * targets, full refusal text, the camera after a resize, and links pasted into an open tab.
 *
 *   node apps/web/e2e/ui-acceptance.mjs <baseUrl> <outDir> <dir containing node_modules/playwright-core>
 *
 * Playwright is not a project dependency: install playwright-core in a scratch directory
 * (npm install playwright-core) and point the third argument at it.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(process.argv[4] + '/package.json');
const pw = require('playwright-core');
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const results = [];
const check = (browser, name, ok, detail = '') => { results.push({ browser, name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${browser}] ${name}${detail ? ` — ${detail}` : ''}`); };
const STRIPE = ['sk_', 'live_'].join('') + 'Z9'.repeat(12);
let net = 10;

async function generate(page, prompt) {
  await page.fill('#system-description', prompt);
  await page.getByRole('button', { name: 'Generate diagram' }).click();
  await page.waitForSelector('.react-flow__node', { timeout: 30000 });
  await page.waitForTimeout(1200);
  return page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('model'));
}
/** Every node box lies inside the canvas box (1 px tolerance). */
const allInView = (page) => page.evaluate(() => {
  const area = document.querySelector('.aw-flow-area').getBoundingClientRect();
  const nodes = [...document.querySelectorAll('.react-flow__node:not(.react-flow__node-boundary)')].map((n) => n.getBoundingClientRect());
  const outside = nodes.filter((r) => r.left < area.left - 1 || r.right > area.right + 1 || r.top < area.top - 1 || r.bottom > area.bottom + 1).length;
  return { nodes: nodes.length, outside, area: `${Math.round(area.width)}x${Math.round(area.height)}` };
});
const transform = (page) => page.evaluate(() => document.querySelector('.react-flow__viewport')?.style.transform);

for (const [name, type] of [['chromium', pw.chromium], ['webkit', pw.webkit]]) {
  const browser = await type.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'X-Forwarded-For': `198.51.100.${net++}` } });
  const page = await context.newPage();
  try {
    await page.goto(`${base}/workspace`);
    await page.waitForSelector('#system-description');
    const first = await generate(page, 'A shop: customers use a web app that calls an order service backed by PostgreSQL.');

    // 1. Touch targets at desktop and phone widths.
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(400);
      const short = await page.evaluate(() => [...document.querySelectorAll('.aw-refine-bar button, .aw-refine-bar input')].map((el) => [el.textContent.trim() || el.getAttribute('aria-label'), Math.round(el.getBoundingClientRect().height)]).filter(([, hgt]) => hgt < 44));
      check(name, `refine bar controls are at least 44 px tall at ${w} px`, short.length === 0, short.length ? JSON.stringify(short) : '');
    }

    // 2. A long refusal is fully visible and wraps.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.fill('input[aria-label="Refinement instruction"]', `Add a payments worker using ${STRIPE}`);
    await page.getByRole('button', { name: 'Refine', exact: true }).click();
    // The refusal is the refine bar's text span (a status region after the fix).
    await page.waitForFunction(() => /Stripe key/.test(document.querySelector('.aw-refine-bar')?.textContent ?? ''), null, { timeout: 15000 });
    const status = await page.evaluate(() => { const el = [...document.querySelectorAll('.aw-refine-bar span')].find((e) => /Stripe key/.test(e.textContent)); const r = el.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.2; return { live: el.getAttribute('role') === 'status', overflow: el.scrollWidth > el.clientWidth + 1, lines: Math.round(r.height / lh), width: Math.round(r.width) }; });
    check(name, 'refusal is a live status shown in full, wrapped, at 390 px', status.live && !status.overflow && status.lines > 1, `${status.live ? 'status' : 'not a status'}, ${status.lines} line(s), ${status.overflow ? 'cut off' : 'complete'}, ${status.width} px wide`);
    await page.screenshot({ path: join(out, `${name}-refusal-390.png`) });

    // 3. Camera: shrinking keeps the whole diagram in view.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Fit View' }).click();
    await page.waitForTimeout(900);
    const wide = await allInView(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(700);
    const narrow = await allInView(page);
    check(name, 'diagram stays in view after shrinking from 1440 to 390 px', wide.outside === 0 && narrow.outside === 0 && narrow.nodes > 0, `wide ${wide.area} outside ${wide.outside}; narrow ${narrow.area} outside ${narrow.outside} of ${narrow.nodes}`);
    await page.screenshot({ path: join(out, `${name}-after-shrink-390.png`) });

    // 4. A camera the user zoomed is kept on resize.
    // At phone width the canvas sits below the fold: bring it on screen before zooming.
    await page.locator('.aw-flow-area').scrollIntoViewIfNeeded();
    const area = await page.locator('.aw-flow-area').boundingBox();
    const before = await transform(page);
    await page.mouse.move(area.x + 20, area.y + 20);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(500);
    const zoomed = await transform(page);
    await page.setViewportSize({ width: 430, height: 900 });
    await page.waitForTimeout(700);
    const after = await transform(page);
    check(name, 'a camera the user zoomed is kept on resize', zoomed !== before && after === zoomed, `zoom ${zoomed !== before ? 'applied' : 'NOT applied'}; after resize ${after === zoomed ? 'unchanged' : 'changed'}`);

    // 5. Pasting a link to another diagram into the same tab opens it.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: /Describe a system/ }).click().catch(() => {});
    const second = await generate(page, 'A blog: readers use a web app that reads posts from PostgreSQL.');
    const loaded = page.waitForResponse((r) => r.url().endsWith(`/api/models/${first}`), { timeout: 10000 }).then(() => true, () => false);
    await page.evaluate((id) => { location.hash = `model=${id}`; }, first);
    const fetched = await loaded;
    await page.waitForTimeout(800);
    const now = await page.evaluate(() => ({ remembered: sessionStorage.getItem('aw_modelId'), hash: new URLSearchParams(location.hash.slice(1)).get('model'), nodes: document.querySelectorAll('.react-flow__node').length }));
    check(name, 'a pasted #model= link opens that diagram without a reload', second !== first && fetched && now.remembered === first && now.hash === first && now.nodes > 0, `first ${first?.slice(0, 8)} second ${second?.slice(0, 8)}`);
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

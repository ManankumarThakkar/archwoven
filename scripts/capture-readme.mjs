#!/usr/bin/env node
// Capture the actual viewer from checked-in provider outputs. No inference or production writes.
// Usage: node scripts/capture-readme.mjs <loopback URL> <directory containing playwright-core>
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [base, tools] = process.argv.slice(2);
if (!base || !tools || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Use a disposable loopback server and provide a browser-tools directory.');
const { chromium } = createRequire(resolve(tools, 'package.json'))('playwright-core');
const browser = await chromium.launch();
const out = new URL('../docs/assets/', import.meta.url);
mkdirSync(out, { recursive: true });
const samples = [
  ['architecture', 'streaming'], ['sequence', 'login-seq'],
  ['data-model', 'library-er'], ['component-detail', 'order-component'],
];
const results = [];
try {
  const config = await fetch(base + '/api/config').then(response => response.json());
  if (config.mode !== 'local') throw new Error('Capture requires a disposable local-mode server.');
  for (const [name, file] of samples) {
    const model = JSON.parse(readFileSync(new URL(`../benchmarks/provider-eval/results/2026-10-17-hosted-19b-evidence-and-fence/models/${file}.model.json`, import.meta.url), 'utf8'));
    const context = await browser.newContext({ viewport: { width: 1700, height: 740 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(12_000);
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', route => /\/api\/(generate|repo|refine)(\/|$)/.test(new URL(route.request().url()).pathname) ? route.abort() : route.continue());
    await page.goto(base + '/workspace');
    await page.waitForFunction(() => !document.querySelector('#system-description')?.disabled);
    const response = await context.request.post(base + '/api/models', { data: { model } });
    if (response.status() !== 201) throw new Error(`${name}: model import refused (${response.status()})`);
    const { id } = await response.json();
    await page.goto(base + '/workspace#model=' + id);
    const sequence = model.views[0].type === 'sequence';
    if (sequence) {
      await page.locator('.aw-sequence-svg svg').waitFor();
      await page.getByRole('button', { name: 'Fit', exact: true }).click();
      for (let attempt = 0; attempt < 10; attempt++) {
        const fits = await page.locator('.aw-sequence-svg svg').evaluate(svg => svg.getBoundingClientRect().bottom <= svg.closest('.aw-sequence-viewport').getBoundingClientRect().bottom);
        if (fits) break;
        await page.getByRole('button', { name: 'Zoom out timeline', exact: true }).click();
      }
    } else {
      await page.locator('.react-flow__node').first().waitFor();
      await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    }
    await page.waitForTimeout(500);
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('main').screenshot({ path: new URL(`${name}.png`, out).pathname });
    const rendered = sequence ? await page.locator('.aw-sequence-svg [data-participant]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-participant'))) : await page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-id')));
    const missing = model.nodes.filter(n => !rendered.includes(n.id));
    if (missing.length || errors.length) throw new Error(`${name}: missing nodes ${missing.map(n => n.id)} ${errors.join('; ')}`);
    results.push({ image: name + '.png', source: file + '.model.json', nodes: model.nodes.length, view: model.views[0].type });
    await context.close();
  }
  writeFileSync(new URL('screenshots.json', out), JSON.stringify({ note: 'Actual viewer; recorded real-provider output, rendered without inference.', results }, null, 2) + '\n');
  console.log(results);
} finally { await browser.close(); }

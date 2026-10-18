#!/usr/bin/env node
/** Real browser -> API -> exhausted evaluation ledger -> error/recovery checks.
 * No API mocks or inference. Seeds a recorded diagram in a disposable store.
 * node apps/web/e2e/evaluation-budget.mjs <localhost-url> <temporary-app.db> <temporary-budget.db> <outDir> <toolsDir> [chromium,webkit]
 * Run the server with a sub-cent evaluation cap and external fetch blocked.
 */
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const [base, appFile, budgetFile, out, tools, engines = 'chromium,webkit'] = process.argv.slice(2);
if (!base || !appFile || !budgetFile || !out || !tools) throw new Error('Expected localhost URL, disposable databases, output and tools directories');
const url = new URL(base);
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Use a disposable localhost server');
for (const file of [appFile, budgetFile]) {
  if (![tmpdir(), '/tmp', '/private/tmp'].some(dir => realpathSync(file).startsWith(realpathSync(dir) + sep))) throw new Error('Both databases must be temporary');
}
const config = await fetch(new URL('/api/config', url), { signal: AbortSignal.timeout(10_000) }).then(response => response.json());
if (config.mode !== 'hosted' || config.fake !== false || !config.llmReady || config.evaluationBudgetEnabled !== true) throw new Error('Use a configured hosted-mode evaluation server, with sample data disabled');
if (!Number.isSafeInteger(config.evaluationBudgetCapNanos) || config.evaluationBudgetCapNanos < 1 || config.evaluationBudgetCapNanos > 1000) throw new Error('The server must confirm a fresh sub-cent evaluation cap before any browser mutations');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(join(tools, 'package.json'));
const pw = require('playwright-core');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const build = createRequire(join(root, 'packages/model/package.json'))('esbuild').buildSync;
const scratch = mkdtempSync(join(tmpdir(), 'aw-budget-browser-'));
const owners = [];
const results = [];
mkdirSync(out, { recursive: true });
const check = (browser, width, name, ok) => {
  results.push({ browser, width, name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${browser}/${width}] ${name}`);
};
let store, budget;
try {
  build({ entryPoints: [join(root, 'packages/jobs/src/index.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(scratch, 'jobs.cjs'), logLevel: 'silent' });
  const { openStore, openEvaluationBudget } = require(join(scratch, 'jobs.cjs'));
  budget = openEvaluationBudget(budgetFile);
  const initial = budget.snapshot();
  if (initial.capNanos > 1000 || initial.heldNanos || initial.settledNanos) throw new Error('Use a fresh budget ledger capped at no more than $0.000001');
  store = openStore(appFile);
  const fixture = JSON.parse(readFileSync(join(root, 'benchmarks/ordinary-model-floor/fixtures/postmerge-checkout.model.json'), 'utf8'));
  for (const name of engines.split(',')) {
    let browser;
    try {
      browser = await pw[name].launch();
      for (const width of [1024, 390]) {
        const owner = randomUUID(), modelId = randomUUID(); owners.push({ owner, modelId });
        store.saveRevision(modelId, fixture, owner);
        const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true, extraHTTPHeaders: { 'X-Forwarded-For': `198.51.100.${30 + owners.length}` } });
        await context.addCookies([{ name: 'aw_sid', value: owner, url: base }]);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.goto(`${base}/workspace`);
          await page.locator('#system-description').fill('A shop where customers call an order API backed by PostgreSQL.');
          await page.getByRole('button', { name: /Generate diagram/ }).click();
          await page.getByText(/Evaluation budget cannot cover another attempt/).first().waitFor();
          check(name, width, 'generation explains budget refusal', await page.getByRole('button', { name: 'Try again', exact: true }).isVisible());
          check(name, width, 'budget refusal is not mislabeled as a counting error', !await page.getByText(/context token count failed/).count());
          check(name, width, 'description survives denial', (await page.locator('#system-description').inputValue()).includes('PostgreSQL'));
          await page.getByRole('button', { name: 'Try again', exact: true }).click();
          check(name, width, 'retry restores a usable form', await page.getByRole('button', { name: /Generate diagram/ }).isEnabled());

          await page.goto(`${base}/workspace#model=${modelId}`);
          await page.locator('.react-flow__node').first().waitFor();
          const beforeNodes = await page.locator('.react-flow__node').count();
          const instruction = page.getByRole('textbox', { name: 'Refinement instruction', exact: true });
          await instruction.fill('Rename the order service to Orders API');
          await instruction.press('Enter');
          await page.locator('.aw-refine-status').filter({ hasText: /Evaluation budget cannot cover another attempt/ }).waitFor();
          check(name, width, 'refinement preserves typed instruction', await instruction.inputValue() === 'Rename the order service to Orders API');
          check(name, width, 'refinement preserves the current diagram', await page.locator('.react-flow__node').count() === beforeNodes && store.getRevision(modelId).revision === fixture.revision);
          await page.addScriptTag({ content: axeSource });
          const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map(v => v.id));
          check(name, width, 'budget error passes axe WCAG A/AA', violations.length === 0);
          check(name, width, 'no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
          await page.screenshot({ path: join(out, `${name}-${width}-denied.png`), fullPage: true });
          const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSON', exact: true }).click()]);
          const saved = join(out, `${name}-${width}-preserved.json`); await download.saveAs(saved);
          check(name, width, 'JSON download remains available', JSON.parse(readFileSync(saved, 'utf8')).nodes.length === fixture.nodes.length);
          await page.reload(); await page.locator('.react-flow__node').first().waitFor();
          check(name, width, 'saved diagram survives reload', await page.locator('.react-flow__node').count() === beforeNodes);
          await page.getByRole('button', { name: 'Find node /', exact: true }).click();
          await page.getByRole('textbox', { name: 'Find node', exact: true }).fill('Order Service');
          await page.getByRole('textbox', { name: 'Find node', exact: true }).press('Enter');
          await page.getByRole('button', { name: 'Open detail', exact: true }).click();
          const hint = page.getByRole('textbox', { name: 'Optional focus for the expansion', exact: true });
          await hint.waitFor(); await hint.fill('Show payment retries');
          const revision = store.getRevision(modelId).revision;
          const [expanded] = await Promise.all([
            page.waitForResponse(response => response.url().endsWith('/expand') && response.request().method() === 'POST'),
            page.getByRole('button', { name: /Expand internals/ }).click(),
          ]);
          await page.locator('.aw-refine-status').filter({ hasText: /Evaluation budget cannot cover another attempt/ }).waitFor();
          check(name, width, 'expansion explains budget refusal', expanded.status() === 502);
          check(name, width, 'expansion preserves the focus hint', await hint.inputValue() === 'Show payment retries');
          check(name, width, 'expansion preserves the saved revision', store.getRevision(modelId).revision === revision);
          await page.screenshot({ path: join(out, `${name}-${width}-expand-denied.png`), fullPage: true });
          check(name, width, 'no browser exceptions', errors.length === 0);
        } finally { await context.close(); }
      }
    } catch (error) {
      results.push({ browser: name, name: 'scenario completed', ok: false, error: error.message }); console.error(error.message);
    } finally { await browser?.close(); }
  }
  const final = budget.snapshot();
  check('all', null, 'denials never create paid reservations or charges', final.heldNanos === 0 && final.settledNanos === 0 && final.pendingAttempts === 0 && final.unknownAttempts === 0);
} finally {
  for (const item of owners) store?.deleteModel(item.modelId);
  store?.close(); budget?.close();
  rmSync(scratch, { recursive: true, force: true });
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
}
process.exitCode = results.some(result => !result.ok) ? 1 : 0;

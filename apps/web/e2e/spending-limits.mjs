#!/usr/bin/env node
/** Real browser -> API -> hosted spending ledger -> refusal and recovery checks.
 * No inference: every scenario refuses before a provider request is sent.
 * node apps/web/e2e/spending-limits.mjs <localhost-url> <temporary-app.db> <outDir> <toolsDir> <redis-shim-pid> [chromium,webkit]
 * The server and this script share UPSTASH_REDIS_REST_URL / _TOKEN / ARCHWOVEN_SPEND_PREFIX from the
 * environment and must point at a disposable Redis whose prefix has no ledger yet. SIGUSR1 to the
 * shim process toggles a Redis outage.
 */
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const [base, appFile, out, tools, shimPid, engines = 'chromium,webkit'] = process.argv.slice(2);
if (!base || !appFile || !out || !tools || !shimPid) throw new Error('Expected localhost URL, disposable app database, output and tools directories, and the Redis shim pid');
const url = new URL(base);
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Use a disposable localhost server');
if (![tmpdir(), '/tmp', '/private/tmp'].some(dir => realpathSync(appFile).startsWith(realpathSync(dir) + sep))) throw new Error('The app database must be temporary');
const { UPSTASH_REDIS_REST_URL: redisUrl, UPSTASH_REDIS_REST_TOKEN: token, ARCHWOVEN_SPEND_PREFIX: prefix } = process.env;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(redisUrl ?? '') || !token || !prefix) throw new Error('Point the spending ledger at a disposable loopback Redis');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(join(tools, 'package.json'));
const pw = require('playwright-core');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const build = createRequire(join(root, 'packages/model/package.json'))('esbuild').buildSync;
const scratch = mkdtempSync(join(tmpdir(), 'aw-spend-browser-'));
const results = [];
mkdirSync(out, { recursive: true });
const check = (scenario, browser, width, name, ok) => {
  results.push({ scenario, browser, width, name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scenario}/${browser}/${width}] ${name}`);
};
const toggleOutage = () => process.kill(Number(shimPid), 'SIGUSR1');

build({ entryPoints: [join(root, 'packages/jobs/src/index.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(scratch, 'jobs.cjs'), logLevel: 'silent' });
const { openStore, openSpendingLedger } = require(join(scratch, 'jobs.cjs'));
const ledger = openSpendingLedger({ url: redisUrl, token, prefix });
const store = openStore(appFile);
const fixture = JSON.parse(readFileSync(join(root, 'benchmarks/ordinary-model-floor/fixtures/postmerge-checkout.model.json'), 'utf8'));
const owners = [];
try {
  if (await ledger.status()) throw new Error('Use a prefix without an existing ledger');
  const day = new Date().toISOString().slice(0, 10);
  // One cent per visitor and day is below any single attempt's hold, so every paid request is refused.
  await ledger.initialize({ start: Date.parse(`${day}T00:00:00Z`) - 86_400_000, end: Date.parse(`${day}T00:00:00Z`) + 300 * 86_400_000 },
    { annualNanos: 84e9, monthNanos: 7e9, visitorDayNanos: 1e7, networkDayNanos: 2e9 });
  const scenarios = [
    ['limit', /today's AI limit for this browser/, async () => {}, async () => {}],
    ['paused', /AI generation is paused while spending is reviewed/, () => ledger.setPaused(true, 'browser check'), () => ledger.setPaused(false)],
    ['outage', /AI generation is temporarily unavailable/, async () => toggleOutage(), async () => toggleOutage()],
  ];
  for (const [scenario, copy, enter, leave] of scenarios) {
    await enter();
    try {
      for (const name of engines.split(',')) {
        const browser = await pw[name].launch();
        try {
          for (const width of [1024, 390]) {
            const owner = randomUUID(), modelId = randomUUID(); owners.push(modelId);
            store.saveRevision(modelId, fixture, owner);
            const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true, extraHTTPHeaders: { 'X-Forwarded-For': `198.51.100.${10 + owners.length}` } });
            await context.addCookies([{ name: 'aw_sid', value: owner, url: base }]);
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            try {
              await page.goto(`${base}/workspace`);
              await page.locator('#system-description').fill('A shop where customers call an order API backed by PostgreSQL.');
              await page.getByRole('button', { name: /Generate diagram/ }).click();
              await page.getByText(copy).first().waitFor({ timeout: 30_000 });
              check(scenario, name, width, 'generation explains the refusal and what still works', await page.getByText(/You can still view, edit and download your diagrams/).first().isVisible());
              check(scenario, name, width, 'refusal is not mislabeled as a counting error', !await page.getByText(/context token count failed/).count());
              check(scenario, name, width, 'description survives the refusal', (await page.locator('#system-description').inputValue()).includes('PostgreSQL'));
              await page.getByRole('button', { name: 'Try again', exact: true }).click();
              check(scenario, name, width, 'retry restores a usable form', await page.getByRole('button', { name: /Generate diagram/ }).isEnabled());

              await page.goto(`${base}/workspace#model=${modelId}`);
              await page.locator('.react-flow__node').first().waitFor();
              const beforeNodes = await page.locator('.react-flow__node').count();
              const instruction = page.getByRole('textbox', { name: 'Refinement instruction', exact: true });
              await instruction.fill('Rename the order service to Orders API');
              await instruction.press('Enter');
              await page.locator('.aw-refine-status').filter({ hasText: copy }).waitFor({ timeout: 30_000 });
              check(scenario, name, width, 'refinement preserves the typed instruction', await instruction.inputValue() === 'Rename the order service to Orders API');
              check(scenario, name, width, 'refinement preserves the current diagram', await page.locator('.react-flow__node').count() === beforeNodes && store.getRevision(modelId).revision === fixture.revision);
              await page.addScriptTag({ content: axeSource });
              const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map(v => v.id));
              check(scenario, name, width, 'refusal passes axe WCAG A/AA', violations.length === 0);
              check(scenario, name, width, 'no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
              await page.screenshot({ path: join(out, `${scenario}-${name}-${width}.png`), fullPage: true });
              const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSON', exact: true }).click()]);
              const saved = join(out, `${scenario}-${name}-${width}.json`); await download.saveAs(saved);
              check(scenario, name, width, 'JSON download remains available', JSON.parse(readFileSync(saved, 'utf8')).nodes.length === fixture.nodes.length);
              await page.reload(); await page.locator('.react-flow__node').first().waitFor();
              check(scenario, name, width, 'saved diagram survives reload', await page.locator('.react-flow__node').count() === beforeNodes);
              check(scenario, name, width, 'no browser exceptions', errors.length === 0);
            } finally { await context.close(); }
          }
        } finally { await browser.close(); }
      }
    } catch (error) {
      results.push({ scenario, name: 'scenario completed', ok: false, error: error.message }); console.error(error.message);
    } finally { await leave(); }
  }
  const final = await ledger.status();
  check('all', null, null, 'refusals never hold or charge anything', final.year.heldNanos === 0 && final.year.settledNanos === 0 && final.unknownAttempts === 0 && !final.paused);
} finally {
  for (const modelId of owners) store.deleteModel(modelId);
  store.close();
  rmSync(scratch, { recursive: true, force: true });
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
}
process.exitCode = results.some(result => !result.ok) ? 1 : 0;

#!/usr/bin/env node
/** Browser -> quota API -> SQLite -> real metering -> browser/reload checks.
 * Seeds content-free usage fixtures, not provider responses. No inference.
 * Use a disposable localhost server/database only:
 * node apps/web/e2e/task-usage.mjs <baseUrl> <temporary-server.db> <outDir> <toolsDir> [chromium,webkit]
 */
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const [base, dbPath, out, tools, engines = 'chromium,webkit'] = process.argv.slice(2);
if (!base || !dbPath || !out || !tools) throw new Error('Expected URL, disposable database, output and tools directories');
const url = new URL(base);
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Use a disposable localhost server');
const config = await fetch(new URL('/api/config', url), { signal: AbortSignal.timeout(10_000) }).then(response => response.json());
if (config.mode !== 'hosted' || config.fake !== false) throw new Error('Use a hosted-mode server with sample data disabled; only usage fixtures will be seeded');
const database = realpathSync(dbPath);
if (![tmpdir(), '/tmp', '/private/tmp'].some(dir => database.startsWith(realpathSync(dir) + sep))) throw new Error('Database must be in a temporary directory');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(join(tools, 'package.json'));
const pw = require('playwright-core');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const build = createRequire(join(root, 'packages/model/package.json'))('esbuild').buildSync;
const scratch = mkdtempSync(join(tmpdir(), 'aw-meter-browser-'));
const owners = [];
const results = [];
mkdirSync(out, { recursive: true });
const check = (browser, scenario, width, name, ok) => {
  results.push({ browser, scenario, width, name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${browser}/${scenario}/${width}] ${name}`);
};
try {
  build({ entryPoints: [join(root, 'packages/jobs/src/index.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(scratch, 'jobs.cjs'), logLevel: 'silent' });
  const { openStore, recordUsage } = require(join(scratch, 'jobs.cjs'));
  const store = openStore(database);
  const usage = { provider: 'anthropic', model: 'claude-sonnet-5-5', inputTokens: 1000, cacheWriteTokens: 2000, cacheReadTokens: 3000, outputTokens: 500, effort: 'low', latencyMs: 1200, repairs: 1, transportRetries: 0, usageComplete: true, attempts: [] };
  const part = { kind: 'initial', inputTokens: 60_000, outputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0, usageComplete: true };
  const cases = [
    { id: 'sonnet', usage, expected: '$0.0123 API estimate' },
    { id: 'haiku', usage: { ...usage, model: 'claude-haiku-5-5' }, expected: '$0.0006 API estimate' },
    { id: 'partial', usage: { ...usage, usageComplete: false, transportRetries: 1 }, expected: 'Usage incomplete · ≥ $0.0123 API estimate' },
    { id: 'unknown', usage: { ...usage, model: 'unpriced-model' }, expected: 'Cost unavailable' },
    { id: 'local', usage: { ...usage, provider: 'ollama', model: 'local-model' }, expected: 'Local inference' },
    { id: 'tiny', usage: { ...usage, model: 'claude-haiku-5-5', inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 }, expected: '$0.0000005 API estimate' },
    { id: 'short-attempts', usage: { ...usage, model: 'claude-haiku-5-5', inputTokens: 120_000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 2000, attempts: [part, { ...part, kind: 'repair' }] }, expected: '$0.0130 API estimate' },
    { id: 'long-attempt', usage: { ...usage, model: 'claude-haiku-5-5', inputTokens: 120_000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 2000, attempts: [{ ...part, inputTokens: 120_000, outputTokens: 2000 }] }, expected: '$0.0650 API estimate' },
    { id: 'ambiguous', usage: { ...usage, model: 'claude-haiku-5-5', inputTokens: 120_000 }, expected: 'Cost unavailable' },
  ].map(scenario => {
    const owner = randomUUID();
    owners.push(owner);
    recordUsage(store, { sessionId: owner, tier: 'anonymous', action: 'generate', view: 'architecture', usage: scenario.usage, outcome: scenario.id === 'partial' ? 'failed' : 'ok' });
    return { ...scenario, owner };
  });
  store.close();
  for (const name of engines.split(',')) {
    let browser;
    try {
      browser = await pw[name].launch();
      for (const scenario of cases) {
        const context = await browser.newContext();
        await context.addCookies([{ name: 'aw_sid', value: scenario.owner, url: base }]);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/api/**', route => {
          if (route.request().method() !== 'GET') { errors.push('unexpected API mutation'); return route.abort(); }
          return route.continue();
        });
        for (const width of [1024, 390]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${base}/workspace`);
          const summary = page.locator('.aw-task-usage > summary');
          await summary.waitFor();
          check(name, scenario.id, width, 'API-backed estimate', (await summary.innerText()).includes(scenario.expected));
          await summary.focus();
          await page.keyboard.press('Enter');
          const details = page.locator('.aw-task-usage-details');
          await details.waitFor();
          check(name, scenario.id, width, 'model identity and keyboard disclosure', (await details.innerText()).includes(scenario.usage.model));
          check(name, scenario.id, width, 'no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
          await page.addScriptTag({ content: axeSource });
          const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map(v => v.id));
          check(name, scenario.id, width, `axe A/AA ${violations.join(',')}`, violations.length === 0);
          await page.screenshot({ path: join(out, `${name}-${scenario.id}-${width}.png`) });
          await page.reload();
          await summary.waitFor();
          check(name, scenario.id, width, 'estimate survives reload', (await summary.innerText()).includes(scenario.expected));
        }
        check(name, scenario.id, null, 'no browser errors or mutations', errors.length === 0);
        await context.close();
      }
    } catch (error) {
      results.push({ browser: name, name: 'scenario completed', ok: false, error: error.message });
      console.error(error.message);
    } finally { await browser?.close(); }
  }
} finally {
  const db = new DatabaseSync(database);
  for (const owner of owners) db.prepare('DELETE FROM call_log WHERE session_id = ?').run(owner);
  db.close();
  rmSync(scratch, { recursive: true, force: true });
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
}
process.exitCode = results.some(result => !result.ok) ? 1 : 0;

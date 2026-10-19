#!/usr/bin/env node
/** The ordinary hosted application started as Vercel starts it (VERCEL=1), in a real browser:
 * production build, real Redis job state and spending ledger, no writable local database, and the
 * LABELLED provider fixture (no inference; see apps/web/e2e/fixture-provider.mjs).
 *
 *   node apps/web/e2e/vercel-runtime.mjs <localhost-url> <outDir> <toolsDir> <server-log> [chromium,webkit]
 *
 * Start the server from apps/web with `next start`, VERCEL=1, ARCHWOVEN_MODE=hosted,
 * UPSTASH_REDIS_REST_URL=https://fixture-redis.upstash.io, ARCHWOVEN_FIXTURE_REDIS pointing at a
 * disposable loopback Redis REST server, a session secret, ARCHWOVEN_DB inside a read-only directory
 * (any attempt to open it is logged as an error, which this script checks), and the fixture preload. Vercel's proxy sets x-vercel-forwarded-for; the
 * browser sends a documentation-range address in its place. This is not a Vercel deployment.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, out, tools, serverLog, engines = 'chromium,webkit'] = process.argv.slice(2);
if (!base || !out || !tools || !serverLog) throw new Error('See the usage at the top of this file');
const url = new URL(base);
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Use a disposable localhost server');
const pw = createRequire(join(tools, 'package.json'))('playwright-core');
mkdirSync(out, { recursive: true });
const results = [];
const check = (scope, name, ok) => { results.push({ scope, name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}`); };
const diagram = page => page.locator('.react-flow__node').first().waitFor({ timeout: 30_000 }).then(() => true, () => false);
const benign = message => /^.*\/api\/jobs\/[0-9a-f-]{36} due to access control checks\.$/.test(message) || message === 'ResizeObserver loop completed with undelivered notifications.';
let jobs = 0;

const landing = await fetch(base);
check('server', 'the landing page renders', landing.status === 200 && /Archwoven/.test(await landing.text()));

for (const name of engines.split(',')) {
  const browser = await pw[name].launch();
  try {
    for (const width of [1024, 390]) {
      const scope = `${name}/${width}`;
      const context = await browser.newContext({ viewport: { width, height: 900 }, extraHTTPHeaders: { 'x-vercel-forwarded-for': `203.0.113.${10 + jobs}` } });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', e => { if (!benign(e.message)) errors.push(e.message); });

      await page.goto(`${base}/workspace`);
      check(scope, 'the workspace shows the hosted daily limit', await page.getByText('Free AI · daily limit').first().waitFor({ timeout: 10_000 }).then(() => true, () => false));
      await page.locator('#system-description').fill(`A shop where customers place orders through an API gateway; an order service stores them in PostgreSQL. Variant ${Date.now()}-${++jobs}.`);
      const [accepted] = await Promise.all([
        page.waitForResponse(r => r.url().endsWith('/api/generate') && r.request().method() === 'POST'),
        page.getByRole('button', { name: /Generate diagram/ }).click(),
      ]);
      const { jobId } = await accepted.json().catch(() => ({}));
      check(scope, 'generation is accepted as a hosted job', accepted.status() === 202 && /^[0-9a-f-]{36}$/.test(jobId ?? ''));
      check(scope, 'the generated diagram appears', await diagram(page));
      await page.reload();
      check(scope, 'the diagram reloads from hosted storage', await diagram(page) && page.url().includes(jobId));

      const instruction = page.getByRole('textbox', { name: 'Refinement instruction', exact: true });
      await instruction.fill('Rename the API gateway to Edge Gateway');
      await instruction.press('Enter');
      await page.getByText('Edge Gateway').first().waitFor({ timeout: 30_000 }).catch(() => undefined);
      check(scope, 'a refinement job applies its result', await page.locator('.react-flow__node').filter({ hasText: 'Edge Gateway' }).count() === 1);

      await page.getByRole('button', { name: 'Find node /', exact: true }).click();
      await page.getByRole('textbox', { name: 'Find node', exact: true }).fill('Order Service');
      await page.getByRole('textbox', { name: 'Find node', exact: true }).press('Enter');
      await page.getByRole('textbox', { name: 'Element name', exact: true }).fill('Orders API');
      await page.getByRole('button', { name: 'Save name', exact: true }).click();
      check(scope, 'a direct edit explains that editing is not available yet, without breaking the workspace',
        await page.getByText(/Editing and undo are not available in this deployment yet/).first().waitFor({ timeout: 10_000 }).then(() => true, () => false) && await diagram(page));

      await page.goto(`${base}/workspace`);
      await page.getByRole('button', { name: 'Import repository', exact: true }).click();
      await page.locator('#repository-url').fill('https://github.com/fixture/shop');
      const [repo] = await Promise.all([
        page.waitForResponse(r => r.url().endsWith('/api/repo') && r.request().method() === 'POST'),
        page.getByRole('button', { name: /Analyze repository/ }).click(),
      ]);
      check(scope, 'a repository import is accepted as a hosted job', repo.status() === 202);
      check(scope, 'the imported diagram appears', await diagram(page));

      const stranger = await browser.newContext({ extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.51.100.20' } });
      const peek = await stranger.newPage();
      await peek.goto(`${base}/workspace`);
      const leaked = await peek.evaluate(async id => [await fetch(`/api/jobs/${id}`).then(r => r.status), await fetch(`/api/models/${id}`).then(r => r.status)], jobId);
      check(scope, 'another visitor gets 404 for the job and its diagram', leaked[0] === 404 && leaked[1] === 404);
      await stranger.close();

      await page.screenshot({ path: join(out, `${name}-${width}.png`), fullPage: true });
      check(scope, 'no browser exceptions', errors.length === 0);
      if (errors.length) console.log(`  page errors: ${JSON.stringify(errors)}`);
      await context.close();
    }
  } finally { await browser.close(); }
}

const log = readFileSync(serverLog, 'utf8');
check('server', 'the server logged no errors', !/error|unhandled|SQLITE|EACCES|EROFS/i.test(log));
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
process.exitCode = results.some(r => !r.ok) ? 1 : 0;

#!/usr/bin/env node
/** The ordinary hosted application started as Vercel starts it (VERCEL=1), in a real browser:
 * production build, real Redis job state and spending ledger, no writable local database, and the
 * LABELLED provider fixture (no inference; see apps/web/e2e/fixture-provider.mjs).
 *
 *   node apps/web/e2e/vercel-runtime.mjs <localhost-url> <outDir> <toolsDir with playwright-core and axe-core> <server-log> [chromium,webkit]
 *
 * Start the server from apps/web with `next start`, VERCEL=1, ARCHWOVEN_MODE=hosted,
 * UPSTASH_REDIS_REST_URL=https://fixture-redis.upstash.io, ARCHWOVEN_FIXTURE_REDIS pointing at a
 * disposable loopback Redis REST server, a session secret, ARCHWOVEN_DB inside a read-only directory
 * (any attempt to open it is logged as an error, which this script checks), and the fixture preload. Vercel's proxy sets x-vercel-forwarded-for; the
 * browser sends a documentation-range address in its place. Set ARCHWOVEN_FIXTURE_LOG to the server's
 * fixture log to check that edits send no AI request. This is not a Vercel deployment.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, out, tools, serverLog, engines = 'chromium,webkit'] = process.argv.slice(2);
if (!base || !out || !tools || !serverLog) throw new Error('See the usage at the top of this file');
const url = new URL(base);
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Use a disposable localhost server');
const requireTool = createRequire(join(tools, 'package.json'));
const pw = requireTool('playwright-core');
const axeSource = readFileSync(requireTool.resolve('axe-core/axe.min.js'), 'utf8');
/** axe violations at WCAG 2.1 A/AA, summarised as `rule (impact) ×nodes`. */
async function axe(page) {
  await page.addScriptTag({ content: axeSource });
  const r = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  return r.violations.map(v => `${v.id} (${v.impact}) ×${v.nodes.length}`);
}
mkdirSync(out, { recursive: true });
const results = [];
const check = (scope, name, ok) => { results.push({ scope, name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}`); };
const diagram = page => page.locator('.react-flow__node').first().waitFor({ timeout: 30_000 }).then(() => true, () => false);
const benign = message => /^.*\/api\/jobs\/[0-9a-f-]{36} due to access control checks\.$/.test(message) || message === 'ResizeObserver loop completed with undelivered notifications.';
let jobs = 0;
const fixtureLog = process.env.ARCHWOVEN_FIXTURE_LOG;
const messages = () => fixtureLog && existsSync(fixtureLog) ? readFileSync(fixtureLog, 'utf8').split('\n').filter(Boolean).length : 0;

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
      const loadedViolations = await axe(page);
      check(scope, 'axe: workspace with a diagram has no WCAG 2.1 A/AA violations', loadedViolations.length === 0);
      if (loadedViolations.length) console.log(`  violations: ${JSON.stringify(loadedViolations)}`);
      await page.reload();
      check(scope, 'the diagram reloads from hosted storage', await diagram(page) && page.url().includes(jobId));

      const instruction = page.getByRole('textbox', { name: 'Refinement instruction', exact: true });
      await instruction.fill('Rename the API gateway to Edge Gateway');
      await instruction.press('Enter');
      await page.getByText('Edge Gateway').first().waitFor({ timeout: 30_000 }).catch(() => undefined);
      check(scope, 'a refinement job applies its result', await page.locator('.react-flow__node').filter({ hasText: 'Edge Gateway' }).count() === 1);

      // Direct edits and undo on the hosted server copy: no AI request, kept across reloads.
      const node = label => page.locator('.react-flow__node').filter({ hasText: label });
      const find = async (target, label) => {
        await target.getByRole('button', { name: 'Find node /', exact: true }).click();
        await target.getByRole('textbox', { name: 'Find node', exact: true }).fill(label);
        await target.getByRole('textbox', { name: 'Find node', exact: true }).press('Enter');
      };
      const renameTo = async (target, from, to) => {
        await find(target, from);
        await target.getByRole('textbox', { name: 'Element name', exact: true }).fill(to);
        await target.getByRole('button', { name: 'Save name', exact: true }).click();
      };
      const sent = messages();
      await renameTo(page, 'Order Service', 'Orders API');
      check(scope, 'a direct edit is saved', await page.getByText('Name saved.').first().waitFor({ timeout: 10_000 }).then(() => true, () => false) && await node('Orders API').count() === 1);
      await page.reload();
      check(scope, 'the edit survives a reload', await diagram(page) && await node('Orders API').count() === 1);
      await renameTo(page, 'Orders API', 'Order Desk');
      await page.getByText('Name saved.').first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      await page.getByRole('button', { name: '↶ Undo', exact: true }).click();
      await node('Orders API').first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      check(scope, 'undo restores the previous name', await node('Orders API').count() === 1 && await node('Order Desk').count() === 0);
      await page.reload();
      check(scope, 'the undo survives a reload', await diagram(page) && await node('Orders API').count() === 1);
      check(scope, 'edits and undo sent no AI request', messages() === sent);

      // Another tab's accepted change wins over a stale edit and over a late refinement.
      const other = await context.newPage();
      await other.goto(page.url());
      await diagram(other);
      await renameTo(other, 'Orders API', 'Orders From Tab B');
      await other.getByText('Name saved.').first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      await renameTo(page, 'Orders API', 'Orders From Tab A');
      check(scope, 'a stale edit is refused and the latest version is shown',
        await page.getByText(/changed elsewhere/).first().waitFor({ timeout: 10_000 }).then(() => true, () => false) && await node('Orders From Tab B').count() === 1);
      // The recorded refinement renames the gateway to Edge Gateway, so give it another name first.
      await renameTo(page, 'Edge Gateway', 'API Gateway');
      await page.getByText('Name saved.').first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      await other.reload();
      await diagram(other);
      await instruction.fill('Rename the API gateway to Edge Gateway');
      await instruction.press('Enter');
      await renameTo(other, 'Orders From Tab B', 'Orders Meanwhile');
      await page.getByText(/changed while this request was running|changed since you loaded it/).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
      await page.screenshot({ path: join(out, `${name}-${width}-late-refinement.png`), fullPage: true });
      check(scope, 'a late refinement over another tab\'s edit is refused and keeps the instruction',
        await page.getByText(/changed while this request was running|changed since you loaded it/).first().isVisible() && await instruction.inputValue() === 'Rename the API gateway to Edge Gateway');
      await other.close();
      await instruction.fill('');

      // Expansion starts from the component's detail view, opened by a direct edit.
      await page.reload();
      await diagram(page);
      await find(page, 'Orders Meanwhile');
      await page.getByRole('button', { name: 'Open detail', exact: true }).click();
      const hint = page.getByRole('textbox', { name: 'Optional focus for the expansion', exact: true });
      await hint.waitFor({ timeout: 10_000 }).catch(() => undefined);
      await page.getByRole('button', { name: /Expand internals/ }).click();
      check(scope, 'a component expands from its detail view', await page.getByText(/Added 2 inferred internals/).first().waitFor({ timeout: 30_000 }).then(() => true, () => false));

      // Downloads and share cards are made in the browser from the diagram on screen.
      for (const [label, pattern] of [['SVG', /\.svg$/], ['PNG', /\.png$/], ['JSON', /\.json$/]]) {
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }).catch(() => null), page.getByRole('button', { name: label, exact: true }).click()]);
        check(scope, `${label} downloads`, !!download && pattern.test(download.suggestedFilename()));
      }
      await page.getByRole('group', { name: 'Diagram views' }).getByRole('button', { name: /^architecture$/i }).click();
      await page.getByRole('combobox', { name: 'route from', exact: true }).selectOption('actor.user');
      await page.getByRole('combobox', { name: 'route to', exact: true }).selectOption('datastore.postgres');
      await page.getByRole('button', { name: '▶ probe', exact: true }).click();
      const [card] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }).catch(() => null), page.getByRole('button', { name: '⤓ share', exact: true }).click()]);
      check(scope, 'a share card downloads as PNG', !!card && /\.png$/.test(card.suggestedFilename()));

      // Recovery from this browser's copy when the 24-hour server copy is gone.
      const diagramId = new URLSearchParams(new URL(page.url()).hash.slice(1)).get('model');
      const [jsonDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSON', exact: true }).click()]);
      const jsonPath = join(out, `${name}-${width}-export.json`);
      await jsonDownload.saveAs(jsonPath);
      check(scope, 'this browser keeps a copy and says how long the server keeps it', /24 hours.*this browser keeps a copy/.test(await page.locator('#retention-note').textContent() ?? ''));
      // Removing only the server copy stands in for its 24-hour expiry.
      await page.evaluate(async id => { await fetch(`/api/models/${id}`, { method: 'DELETE' }); }, diagramId);
      await page.reload();
      check(scope, 'an expired server copy is restored from this browser, with an explanation',
        await diagram(page) && await page.getByText('restored from this browser').first().waitFor({ timeout: 10_000 }).then(() => true, () => false));
      await renameTo(page, 'Customer', 'Shopper');
      check(scope, 'the restored diagram accepts edits', await page.getByText('Name saved.').first().waitFor({ timeout: 10_000 }).then(() => true, () => false));

      const reopened = await context.newPage();
      await reopened.goto(`${base}/workspace`);
      check(scope, 'a reopened workspace shows the diagram this browser kept last', await diagram(reopened) && reopened.url().includes(diagramId));
      await reopened.close();

      await page.goto(`${base}/workspace`);
      await diagram(page);
      // The import control is reachable by keyboard.
      await page.locator('#system-description').focus();
      let reached = false;
      for (let i = 0; i < 40 && !reached; i++) { await page.keyboard.press(name === 'webkit' ? 'Alt+Tab' : 'Tab'); // WebKit on macOS moves past controls with Option+Tab
        reached = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Open a JSON download'); }
      check(scope, 'the JSON import control is reachable by keyboard', reached);
      await page.locator('input[type="file"][aria-label="Open a JSON download"]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"title":"not a diagram"}') });
      check(scope, 'a file that is not a diagram is refused with an explanation', await page.getByText('This file is not an Archwoven diagram').first().waitFor({ timeout: 10_000 }).then(() => true, () => false));
      await page.locator('input[type="file"][aria-label="Open a JSON download"]').setInputFiles(jsonPath);
      await page.waitForURL(u => /model=/.test(u.hash) && !u.hash.includes(diagramId), { timeout: 15_000 }).catch(() => undefined);
      await page.screenshot({ path: join(out, `${name}-${width}-imported.png`), fullPage: true });
      check(scope, 'a JSON download opens as a new diagram', await diagram(page) && !page.url().includes(diagramId) && /model=/.test(page.url()));

      const blocked = await context.newPage();
      await blocked.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('denied', 'SecurityError'); }; });
      await blocked.goto(page.url());
      check(scope, 'blocked browser storage is explained and the diagram still works',
        await diagram(blocked) && /not keeping a copy because site storage is blocked/.test(await blocked.locator('#retention-note').textContent() ?? ''));
      await blocked.close();

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

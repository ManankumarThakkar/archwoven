#!/usr/bin/env node
/** Hosted description jobs in a real browser: production build, real Redis job state and
 * spending ledger, and a LABELLED provider fixture (no inference; see the README).
 *
 *   node apps/web/e2e/hosted-jobs.mjs flows <localhost-url> <outDir> <toolsDir> <fixture-log> [chromium,webkit]
 *   node apps/web/e2e/hosted-jobs.mjs crash-start <localhost-url> <outDir> <toolsDir>   (then kill and restart the server)
 *   node apps/web/e2e/hosted-jobs.mjs crash-check <localhost-url> <outDir> <toolsDir>
 *
 * The server must run in hosted mode with Redis job storage, a session secret and the fixture
 * preload, with ARCHWOVEN_FIXTURE_DELAY_MS long enough to act while a job runs (about 6 s).
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [mode, base, out, tools, fixtureLog, engines = 'chromium,webkit'] = process.argv.slice(2);
if (!['flows', 'crash-start', 'crash-check'].includes(mode) || !base || !out || !tools) throw new Error('See the usage at the top of this file');
const url = new URL(base);
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Use a disposable localhost server');
const pw = createRequire(join(tools, 'package.json'))('playwright-core');
mkdirSync(out, { recursive: true });
const results = [];
const check = (scope, name, ok) => { results.push({ scope, name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}`); };
const description = 'A shop where customers place orders through an API gateway; an order service stores them in PostgreSQL.';
const messages = () => existsSync(fixtureLog ?? '') ? readFileSync(fixtureLog, 'utf8').split('\n').filter(Boolean).length : 0;
const activeJob = page => page.evaluate(() => JSON.parse(localStorage.getItem('aw_activeJob') ?? 'null'));
// Each job needs its own description: the same description and view replay an earlier job by design.
let jobs = 0;
async function start(page) {
  await page.goto(`${base}/workspace`);
  await page.locator('#system-description').fill(`${description} Variant ${Date.now()}-${++jobs}.`);
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/generate') && r.request().method() === 'POST'),
    page.getByRole('button', { name: /Generate diagram/ }).click(),
  ]);
  return { status: response.status(), jobId: (await response.json().catch(() => ({}))).jobId };
}
const diagram = page => page.locator('.react-flow__node').first().waitFor({ timeout: 30_000 }).then(() => true, () => false);

if (mode === 'flows') {
  for (const name of engines.split(',')) {
    const browser = await pw[name].launch();
    try {
      for (const width of [1024, 390]) {
        const scope = `${name}/${width}`;
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage();
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        // 1. Generate, then reload: the finished diagram is still there.
        const before = messages();
        const first = await start(page);
        check(scope, 'generation is accepted promptly with a job id', first.status === 202 && /^[0-9a-f-]{36}$/.test(first.jobId ?? ''));
        check(scope, 'the running job is remembered for reconnection', (await activeJob(page))?.jobId === first.jobId);
        check(scope, 'the diagram appears when the job finishes', await diagram(page));
        check(scope, 'one provider request was dispatched for one job', messages() - before === 1);
        check(scope, 'a finished job is forgotten', (await activeJob(page)) === null);
        await page.reload();
        check(scope, 'the diagram survives a reload', await diagram(page));

        // 2. Reload in the middle of a job: the page reconnects and finishes it.
        const second = await start(page.context().pages()[0]);
        await page.waitForTimeout(1500);
        await page.reload();
        check(scope, 'after a mid-job reload the page shows the job still running', await page.getByRole('button', { name: /Cancel/ }).isVisible().catch(() => false) || await page.getByText(/Generating|Validating|Queued/i).first().isVisible().catch(() => false));
        check(scope, 'the reloaded page finishes the same job', await diagram(page) && (await activeJob(page)) === null && page.url().includes(second.jobId));

        // 3. Close the tab mid-job and come back later: the job kept running and is picked up.
        const third = await start(page);
        await page.close();
        await new Promise(r => setTimeout(r, 1000));
        const reopened = await context.newPage();
        reopened.on('pageerror', e => errors.push(e.message));
        await reopened.goto(`${base}/workspace`);
        check(scope, 'a reopened workspace reconnects to the job started before closing', await diagram(reopened) && reopened.url().includes(third.jobId));

        // 4. Two tabs. A tab opened while a job runs reconnects to it. A tab that was already open
        // and asks for a different diagram is refused a second job, with an explanation.
        const idle = await context.newPage();
        await idle.goto(`${base}/workspace`);
        const fourth = await start(reopened);
        const later = await context.newPage();
        await later.goto(`${base}/workspace`);
        check(scope, 'a tab opened later reconnects to the running job', await diagram(later) && later.url().includes(fourth.jobId));
        const sixth = await start(reopened);
        await idle.locator('#system-description').fill('A clinic where patients book appointments through a scheduling API backed by PostgreSQL.');
        const busy = await Promise.all([
          idle.waitForResponse(r => r.url().endsWith('/api/generate') && r.request().method() === 'POST'),
          idle.getByRole('button', { name: /Generate diagram/ }).click(),
        ]).then(([response]) => response.status());
        check(scope, 'a different second job is refused with an explanation', busy === 409 && await idle.getByText(/already have a diagram being generated/).first().isVisible());
        check(scope, 'the first tab still finishes its job', await diagram(reopened) && reopened.url().includes(sixth.jobId));
        await idle.close(); await later.close();

        // 5. Cancel a running job: nothing is saved, and the form is usable again.
        const fifth = await start(reopened);
        check(scope, 'the job to cancel was accepted', fifth.status === 202);
        await reopened.screenshot({ path: join(out, `${name}-${width}-before-cancel.png`) });
        await reopened.getByRole('button', { name: 'Cancel', exact: true }).first().click();
        await reopened.getByText(/cancel/i).first().waitFor();
        const status = await reopened.evaluate(id => fetch(`/api/jobs/${id}`).then(r => r.json()), fifth.jobId);
        check(scope, 'cancelling marks the job cancelled', status.status === 'cancelled');
        check(scope, 'a cancelled job leaves no diagram', (await reopened.evaluate(id => fetch(`/api/models/${id}`).then(r => r.status), fifth.jobId)) === 404);
        check(scope, 'the form is usable after cancelling', await reopened.getByRole('button', { name: /Generate diagram/ }).isEnabled());
        await reopened.screenshot({ path: join(out, `${name}-${width}-cancelled.png`), fullPage: true });

        // 6. Refinement as a hosted job: the result is applied and survives a reload.
        await start(reopened);
        await diagram(reopened);
        const instruction = reopened.getByRole('textbox', { name: 'Refinement instruction', exact: true });
        await instruction.fill('Rename the API gateway to Edge Gateway');
        await instruction.press('Enter');
        await reopened.getByText('Edge Gateway').first().waitFor({ timeout: 30_000 }).catch(() => undefined);
        check(scope, 'a refinement job applies its result', await reopened.locator('.react-flow__node').filter({ hasText: 'Edge Gateway' }).count() === 1 && await instruction.inputValue() === '');
        await reopened.reload();
        check(scope, 'the refined diagram survives a reload', await diagram(reopened) && await reopened.locator('.react-flow__node').filter({ hasText: 'Edge Gateway' }).count() === 1);

        // 7. An edit made in another tab while a refinement runs wins; the late result is refused.
        await start(reopened);
        await diagram(reopened);
        const diagramUrl = reopened.url();
        const editor = await context.newPage();
        await editor.goto(diagramUrl);
        await diagram(editor);
        await instruction.fill('Rename the API gateway to Edge Gateway');
        await instruction.press('Enter');
        await editor.getByRole('button', { name: 'Find node /', exact: true }).click();
        await editor.getByRole('textbox', { name: 'Find node', exact: true }).fill('Order Service');
        await editor.getByRole('textbox', { name: 'Find node', exact: true }).press('Enter');
        await editor.getByRole('textbox', { name: 'Element name', exact: true }).fill('Orders API');
        await editor.getByRole('button', { name: 'Save name', exact: true }).click();
        await editor.getByText('Name saved.').first().waitFor();
        await reopened.getByText(/changed while refining/).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
        check(scope, 'a late refinement over a newer edit is refused with an explanation', await reopened.getByText(/changed while refining/).first().isVisible());
        check(scope, 'the refused refinement keeps the typed instruction', await instruction.inputValue() === 'Rename the API gateway to Edge Gateway');
        await reopened.reload();
        check(scope, 'the edit from the other tab is kept', await diagram(reopened) && await reopened.locator('.react-flow__node').filter({ hasText: 'Orders API' }).count() === 1 && await reopened.locator('.react-flow__node').filter({ hasText: 'Edge Gateway' }).count() === 0);
        await editor.close();

        // 8. Another visitor cannot read the job or its diagram.
        const stranger = await browser.newContext();
        const peek = await stranger.newPage();
        await peek.goto(`${base}/workspace`);
        const leaked = await peek.evaluate(async id => [await fetch(`/api/jobs/${id}`).then(r => r.status), await fetch(`/api/models/${id}`).then(r => r.status)], first.jobId);
        check(scope, 'another visitor gets 404 for the job and its diagram', leaked[0] === 404 && leaked[1] === 404);
        await stranger.close();
        check(scope, 'no browser exceptions', errors.length === 0);
        await context.close();
      }
    } finally { await browser.close(); }
  }
}

if (mode === 'crash-start') {
  const browser = await pw.chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const started = await start(page);
  check('crash', 'job accepted before the crash', started.status === 202);
  await context.storageState({ path: join(out, 'crash-state.json') });
  writeFileSync(join(out, 'crash-job.txt'), started.jobId);
  await browser.close();
}

if (mode === 'crash-check') {
  const browser = await pw.chromium.launch();
  const context = await browser.newContext({ storageState: join(out, 'crash-state.json') });
  const page = await context.newPage();
  await page.goto(`${base}/workspace`);
  await page.getByText(/stopped before it finished/).first().waitFor({ timeout: 60_000 }).catch(() => undefined);
  const jobId = readFileSync(join(out, 'crash-job.txt'), 'utf8');
  const status = await page.evaluate(id => fetch(`/api/jobs/${id}`).then(r => r.json()), jobId);
  check('crash', 'a job whose server died reads as failed after its deadline', status.status === 'failed' && /stopped before it finished/.test(status.error ?? ''));
  check('crash', 'the reopened page explains it and offers a retry', await page.getByText(/stopped before it finished.*retry/).first().isVisible());
  check('crash', 'the job is forgotten afterwards', (await activeJob(page)) === null);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('#system-description').fill('A shop where customers place orders through an API backed by PostgreSQL.');
  check('crash', 'Try again leads to a usable form', await page.getByRole('button', { name: /Generate diagram/ }).isEnabled());
  await page.screenshot({ path: join(out, 'crash-check.png'), fullPage: true });
  await browser.close();
}

writeFileSync(join(out, `results-${mode}.json`), JSON.stringify(results, null, 2));
process.exitCode = results.some(r => !r.ok) ? 1 : 0;

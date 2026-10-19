#!/usr/bin/env node
// LABELLED FIXTURE ACCEPTANCE: disposable loopback Redis and recorded provider responses only.
// Run after starting the ordinary production build with the fixture preload (see vercel-runtime.mjs).
// node --env-file=<fixture env> apps/web/e2e/storage-capacity.mjs <localhost-url> <outDir> <toolsDir>
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STORAGE_LUA, HOSTED_STORAGE_LIMITS } from '../../../packages/jobs/src/hosted-storage.ts';

const [base, out, tools] = process.argv.slice(2);
const redis = process.env.ARCHWOVEN_FIXTURE_REDIS, token = process.env.UPSTASH_REDIS_REST_TOKEN;
const prefix = process.env.ARCHWOVEN_REDIS_PREFIX, fixtureLog = process.env.ARCHWOVEN_FIXTURE_LOG;
const local = value => { const u = new URL(value); return u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname); };
if (!base || !out || !tools || !redis || !token || !prefix || !fixtureLog || !local(base) || !local(redis)) throw new Error('Use disposable loopback application/Redis servers and the fixture environment.');
const requireTool = createRequire(join(tools, 'package.json')), pw = requireTool('playwright-core');
const axeSource = readFileSync(requireTool.resolve('axe-core/axe.min.js'), 'utf8');
const call = async command => {
  const r = await fetch(redis, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(command) });
  const body = await r.json(); if (!r.ok || body.error) throw new Error(body.error ?? `Redis ${r.status}`); return body.result;
};
const evalBudget = (body, args = []) => call(['EVAL', STORAGE_LUA + body, 0, prefix, HOSTED_STORAGE_LIMITS.bytes, HOSTED_STORAGE_LIMITS.records, ...args]);
const messages = () => { try { return readFileSync(fixtureLog, 'utf8').trim().split('\n').filter(Boolean).length; } catch { return 0; } };
const results = [];
function check(scope, name, ok) { results.push({ scope, name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}`); }
mkdirSync(out, { recursive: true });

for (const name of ['chromium', 'webkit']) {
  const browser = await pw[name].launch();
  try {
    for (const width of [1024, 390]) {
      const scope = `${name}/${width}`, seeded = [];
      const context = await browser.newContext({ viewport: { width, height: 900 }, extraHTTPHeaders: { 'x-vercel-forwarded-for': '203.0.113.77' } });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      try {
        await page.goto(`${base}/workspace`);
        await page.locator('#system-description').fill(`A shop with customers, an API and PostgreSQL. Capacity test ${randomUUID()}.`);
        await page.getByRole('button', { name: /Generate diagram/ }).click();
        await page.locator('.react-flow__node').first().waitFor({ timeout: 30_000 });
        check(scope, 'an initial fixture diagram is available', true);

        // Valid budget transitions fill the record allowance. They never bypass the accounting.
        for (;;) {
          const key = `${prefix}model:${randomUUID()}`;
          const ok = await evalBudget(`local b = storageBudget(ARGV[1], tonumber(ARGV[2]), tonumber(ARGV[3]))
            if not b.take(ARGV[4], 14, 1, 86400000) then return 0 end
            redis.call('HSET', ARGV[4], 'owner', 'fixture', 'value', '{"revision":1}')
            redis.call('EXPIRE', ARGV[4], 86400) return 1`, [key]);
          if (!ok) break;
          seeded.push(key);
        }
        const before = messages();
        const instruction = page.getByRole('textbox', { name: 'Refinement instruction', exact: true });
        await instruction.fill('Rename the gateway');
        const [refused] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/refine')), instruction.press('Enter')]);
        check(scope, 'refinement is refused before inference when storage is full', refused.status() === 503 && (await refused.json()).reason === 'storage-full');
        check(scope, 'the refinement instruction is preserved', await instruction.inputValue() === 'Rename the gateway');

        const prompt = `A different system with a gateway and database. ${randomUUID()}`;
        await page.locator('#system-description').fill(prompt);
        const [generation] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/generate')), page.getByRole('button', { name: /Generate diagram/ }).click()]);
        check(scope, 'new generation explains capacity and makes no AI request', generation.status() === 503 && (await generation.json()).reason === 'storage-full' && messages() === before);
        await page.waitForFunction(() => !!document.querySelector('.react-flow__node') && !document.getElementById('system-description').disabled);
        check(scope, 'the description and current diagram are preserved', await page.locator('#system-description').inputValue() === prompt && await page.locator('.react-flow__node').count() > 0);
        check(scope, 'the capacity message is visible', await page.getByText(/temporary diagram storage is full/).first().isVisible());

        const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSON', exact: true }).click()]);
        const path = join(out, `${name}-${width}.json`); await download.saveAs(path);
        check(scope, 'JSON download still contains the visible diagram', JSON.parse(readFileSync(path, 'utf8')).nodes.length > 0);
        await page.addScriptTag({ content: axeSource });
        const violations = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }).then(r => r.violations.map(v => v.id)));
        check(scope, 'capacity state is accessible and has no horizontal overflow', !violations.length && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: join(out, `${name}-${width}.png`), fullPage: true });

        for (const key of seeded.splice(0)) await evalBudget(`storageBudget(ARGV[1], 0, 0).drop(ARGV[4]) return redis.call('DEL', ARGV[4])`, [key]);
        const [retry] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/generate')), page.getByRole('button', { name: /Generate diagram/ }).click()]);
        const { jobId } = await retry.json();
        check(scope, 'freeing storage admits a new job', retry.status() === 202 && !!jobId);
        await page.waitForFunction(id => new URLSearchParams(location.hash.slice(1)).get('model') === id, jobId, { timeout: 30_000 });
        await page.locator('.react-flow__node').first().waitFor();
        check(scope, 'the admitted job completes after capacity is freed', await page.locator('.react-flow__node').count() > 0 && messages() === before + 1);
        check(scope, 'no browser exceptions', !errors.length);
      } finally {
        for (const key of seeded) await evalBudget(`storageBudget(ARGV[1], 0, 0).drop(ARGV[4]) return redis.call('DEL', ARGV[4])`, [key]);
        await context.close();
      }
    }
  } finally { await browser.close(); writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2)); }
}
if (results.some(r => !r.ok)) process.exitCode = 1;

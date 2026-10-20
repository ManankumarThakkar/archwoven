#!/usr/bin/env node
/** Production landing acceptance, no inference. Run:
 * node apps/web/e2e/landing.mjs <loopback-url> <outDir> <toolsDir containing playwright-core and axe-core>
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [base, out, tools] = process.argv.slice(2);
if (!base || !out || !tools || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Use a disposable loopback server and see usage above.');
const requireTool = createRequire(join(tools, 'package.json'));
const pw = requireTool('playwright-core'), axe = readFileSync(requireTool.resolve('axe-core/axe.min.js'), 'utf8');
mkdirSync(out, { recursive: true });
const results = [];
const check = (scope, name, ok) => { results.push({ scope, name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}`); };
for (const engine of ['chromium', 'webkit']) {
  const browser = await pw[engine].launch();
  try {
    for (const width of [1440, 1024, 801, 768, 601, 481, 390, 320]) {
      const scope = `${engine}/${width}`;
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      const page = await context.newPage(), errors = [], api = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url()); });
      try {
        await page.goto(base);
        await page.getByRole('button', { name: /Play walkthrough/ }).waitFor();
        await page.waitForFunction(() => !document.querySelector('.lp-play')?.disabled);
        if (width === 1440) await page.screenshot({ path: join(out, `${engine}-hero.png`) });
        check(scope, 'landing and map are readable without page overflow', await page.getByRole('heading', { level: 1 }).isVisible() && await page.getByRole('img', { name: /^Catalog architecture/ }).isVisible() && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const label = page.locator('.lp-map-name:visible').first();
        const readable = await label.evaluate(el => parseFloat(getComputedStyle(el).fontSize) * el.getScreenCTM().a >= 12);
        check(scope, 'diagram component names render at least 12 CSS pixels', readable);
        await page.getByRole('button', { name: '02 Explore', exact: true }).click();
        check(scope, 'manual step explains the inspected relationship', await page.getByRole('status').textContent().then(t => t.includes('provenance') && t.includes('inferred')));
        await page.getByRole('button', { name: '03 Keep', exact: true }).click();
        const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download example SVG' }).click()]);
        const path = join(out, `${engine}-${width}.svg`); await download.saveAs(path);
        check(scope, 'the preview downloads a real SVG without an API call', readFileSync(path, 'utf8').includes('<svg') && api.length === 0);
        await page.getByRole('button', { name: '01 Describe', exact: true }).click();
        await page.getByRole('button', { name: /Play walkthrough/ }).click();
        check(scope, 'reduced motion stops animated geometry during playback', await page.locator('.lp-map-connection path').first().evaluate(el => getComputedStyle(el).animationName === 'none'));
        await page.getByRole('button', { name: /Pause walkthrough/ }).click();
        check(scope, 'playback can be paused', await page.getByRole('button', { name: /Resume walkthrough/ }).isVisible());
        await page.getByText('Can I use Archwoven privately?', { exact: true }).click();
        check(scope, 'private setup links to the current README section', (await page.getByRole('link', { name: 'private deployment instructions' }).getAttribute('href')).endsWith('#run-privately'));
        await page.addScriptTag({ content: axe });
        const violations = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }).then(r => r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`)));
        check(scope, 'axe WCAG 2.1 A/AA', violations.length === 0); if (violations.length) console.log(violations);
        check(scope, 'no browser errors or API requests', errors.length === 0 && api.length === 0);
        await page.getByRole('button', { name: '01 Describe', exact: true }).click();
        await page.screenshot({ path: join(out, `${engine}-${width}.png`), fullPage: true });
        if (width === 1440) {
          await page.getByRole('button', { name: /Play walkthrough/ }).click();
          await page.getByRole('button', { name: /Replay walkthrough/ }).waitFor({ timeout: 30_000 });
          check(scope, 'the 24-second walkthrough stops on its last step', await page.getByRole('button', { name: '03 Keep', exact: true }).getAttribute('aria-pressed') === 'true');
        }
      } finally { await context.close(); }
    }
    const motion = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
    const motionPage = await motion.newPage(); await motionPage.goto(base);
    await motionPage.keyboard.press('Tab');
    check(engine, 'keyboard navigation begins with the visible skip link', await motionPage.getByRole('link', { name: 'Skip to content' }).evaluate(el => el === document.activeElement && el.getBoundingClientRect().width > 1));
    await motionPage.getByRole('button', { name: /Play walkthrough/ }).click();
    await motionPage.getByRole('button', { name: /Pause walkthrough/ }).waitFor();
    check(engine, 'requested motion runs with the normal motion preference', await motionPage.getByRole('img', { name: /^Catalog architecture/ }).locator('.lp-map-connection path').first().evaluate(el => getComputedStyle(el).animationName === 'lp-flow'));
    await motionPage.getByRole('button', { name: /Pause walkthrough/ }).click();
    check(engine, 'pausing stops the geometry animation', await motionPage.getByRole('img', { name: /^Catalog architecture/ }).locator('.lp-map-connection path').first().evaluate(el => getComputedStyle(el).animationName === 'none'));
    await motion.close();
    const plain = await browser.newContext({ javaScriptEnabled: false });
    const page = await plain.newPage(); await page.goto(base);
    check(engine, 'no-JavaScript visitors can understand the product and enter the workspace', await page.getByRole('heading', { level: 1 }).isVisible() && await page.getByRole('link', { name: 'View example SVG' }).isVisible() && await page.getByRole('link', { name: 'Open workspace', exact: true }).first().getAttribute('href') === '/workspace' && await page.getByRole('button', { name: /Play walkthrough/ }).isDisabled());
    await plain.close();
  } finally { await browser.close(); writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2)); }
}
if (results.some(r => !r.ok)) process.exitCode = 1;

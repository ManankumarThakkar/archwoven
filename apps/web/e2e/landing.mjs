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
const pause = page => page.getByRole('button', { name: 'Pause', exact: true });
const play = page => page.getByRole('button', { name: 'Play', exact: true });
const ready = page => page.waitForFunction(() => !document.querySelector('.lp-film-toggle')?.disabled);
for (const engine of ['chromium', 'webkit']) {
  const browser = await pw[engine].launch();
  try {
    for (const width of [1440, 1024, 801, 768, 601, 481, 390, 320]) {
      const scope = `${engine}/${width}`;
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      const page = await context.newPage(), errors = [], api = [], media = [];
      page.setDefaultTimeout(10_000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => {
        if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url());
        if (r.url().endsWith('.mp4')) media.push(r.url());
      });
      try {
        await page.goto(base); await ready(page);
        if (width === 1440) await page.screenshot({ path: join(out, `${engine}-hero.jpg`) });
        check(scope, 'landing remains useful without horizontal overflow', await page.getByRole('heading', { level: 1 }).isVisible() && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.getByRole('link', { name: 'See it come together' }).click();
        check(scope, 'reduced motion leaves a poster without fetching the movie', media.length === 0 && await page.locator('video').evaluate(v => v.paused && !v.hasAttribute('src')));
        await play(page).click(); await pause(page).waitFor();
        await page.waitForFunction(() => document.querySelector('video').currentTime > 0.3);
        check(scope, 'explicit playback is muted, inline and looping with the real 32-second asset', await page.locator('video').evaluate(v => v.muted && v.loop && v.playsInline && v.videoWidth === 1920 && Math.abs(v.duration - 32) < .1));
        await pause(page).click();
        const time = await page.locator('video').evaluate(v => v.currentTime);
        await page.waitForTimeout(150);
        check(scope, 'pause stops the actual video', await page.locator('video').evaluate((v, t) => v.paused && Math.abs(v.currentTime - t) < .1, time));
        await page.getByRole('button', { name: 'Restart', exact: true }).click();
        await pause(page).waitFor();
        await page.waitForFunction(() => document.querySelector('video').currentTime < 1);
        check(scope, 'restart resumes from the beginning even after pausing', await page.locator('video').evaluate(v => !v.paused));
        await pause(page).click();
        await page.getByText('Read the film summary', { exact: true }).click();
        check(scope, 'descriptive alternative explains both inputs and the source limitations', (await page.locator('.lp-film-caption details').innerText()).includes('Environment overrides remain unverified'));
        check(scope, 'no watch or download distractions in the landing', await page.locator('a[download]').count() === 0);
        await page.addScriptTag({ content: axe });
        const violations = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }).then(r => r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`)));
        check(scope, 'axe WCAG 2.1 A/AA', violations.length === 0); if (violations.length) console.log(violations);
        check(scope, 'no browser errors or AI requests', errors.length === 0 && api.length === 0);
        await page.getByText('Read the film summary', { exact: true }).click();
        await page.locator('#example').screenshot({ path: join(out, `${engine}-${width}-film.jpg`) });
      } finally { await context.close(); }
    }
    const motion = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
    motion.setDefaultTimeout(10_000);
    const page = await motion.newPage(); await page.goto(base); await ready(page);
    await page.getByRole('link', { name: 'See it come together' }).click();
    await pause(page).waitFor();
    check(engine, 'normal motion starts automatically when the film is visible', await page.locator('video').evaluate(v => !v.paused));
    await page.locator('video').evaluate(v => { v.currentTime = 31.6; });
    await page.waitForFunction(() => document.querySelector('video').currentTime < 2);
    check(engine, 'native playback loops without another action', await page.locator('video').evaluate(v => !v.paused));
    await page.locator('.lp-closing').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('video').paused);
    await page.locator('video').scrollIntoViewIfNeeded(); await pause(page).waitFor();
    check(engine, 'scrolling away pauses and returning resumes automatic playback', await page.locator('video').evaluate(v => !v.paused));
    await pause(page).click();
    await page.locator('.lp-closing').scrollIntoViewIfNeeded();
    await page.locator('video').scrollIntoViewIfNeeded();
    check(engine, 'scrolling never overrides a manual pause', await page.locator('video').evaluate(v => v.paused));
    await play(page).click(); await pause(page).waitFor();
    await page.locator('video').evaluate(v => v.pause());
    await page.locator('.lp-closing').scrollIntoViewIfNeeded();
    await page.locator('video').scrollIntoViewIfNeeded();
    check(engine, 'native player pause also survives leaving and returning', await page.locator('video').evaluate(v => v.paused));
    await play(page).focus(); await page.keyboard.press('Enter'); await pause(page).waitFor();
    check(engine, 'playback controls work from the keyboard', await page.locator('video').evaluate(v => !v.paused));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('video').paused);
    check(engine, 'enabling reduced motion stops active automatic playback', true);
    await motion.close();

    const blocked = await browser.newContext({ reducedMotion: 'no-preference' });
    blocked.setDefaultTimeout(10_000);
    await blocked.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play;
      let allowed = false;
      document.addEventListener('pointerdown', () => { allowed = true; }, { once: true });
      HTMLMediaElement.prototype.play = function () {
        if (!allowed) return Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError'));
        return play.call(this);
      };
    });
    const blockedPage = await blocked.newPage(); await blockedPage.goto(base); await ready(blockedPage);
    await blockedPage.locator('video').scrollIntoViewIfNeeded();
    await blockedPage.getByRole('status').filter({ hasText: 'Select Play' }).waitFor();
    await play(blockedPage).click(); await pause(blockedPage).waitFor();
    check(engine, 'a real click recovers when browser autoplay is denied', await blockedPage.locator('video').evaluate(v => !v.paused));
    await blocked.close();

    const broken = await browser.newContext({ reducedMotion: 'reduce' });
    broken.setDefaultTimeout(10_000);
    await broken.route('**/*.mp4', route => route.abort());
    const brokenPage = await broken.newPage(); await brokenPage.goto(base); await ready(brokenPage);
    await play(brokenPage).click();
    await brokenPage.getByRole('status').filter({ hasText: 'film is unavailable' }).waitFor();
    check(engine, 'failed media leaves a poster, readable summary and workspace action', await brokenPage.locator('video').getAttribute('poster') && await brokenPage.getByText('Read the film summary', { exact: true }).isVisible() && await brokenPage.getByRole('link', { name: 'Open workspace', exact: true }).first().getAttribute('href') === '/workspace');
    await broken.close();

    const saver = await browser.newContext({ viewport: { width: 390, height: 700 }, reducedMotion: 'no-preference' });
    saver.setDefaultTimeout(10_000);
    await saver.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true }));
    const saverPage = await saver.newPage(); await saverPage.goto(base); await ready(saverPage);
    await saverPage.locator('video').scrollIntoViewIfNeeded();
    check(engine, 'data saving leaves media unloaded until Play', await saverPage.locator('video').evaluate(v => !v.hasAttribute('src')));
    await play(saverPage).click(); await pause(saverPage).waitFor();
    check(engine, 'data saving still allows explicitly requested playback', await saverPage.locator('video').evaluate(v => !v.paused));
    const range = await saver.request.get(base + '/media/archwoven-overview-v1.mp4', { headers: { Range: 'bytes=0-99' } });
    check(engine, 'versioned media supports cached byte-range playback', range.status() === 206 && range.headers()['cache-control'].includes('immutable') && (await range.body()).length === 100);
    await saver.close();

    const plain = await browser.newContext({ javaScriptEnabled: false });
    const plainPage = await plain.newPage(); await plainPage.goto(base);
    await plainPage.getByText('Read the film summary', { exact: true }).click();
    check(engine, 'without JavaScript the summary and workspace link remain usable', await plainPage.getByRole('heading', { level: 1 }).isVisible() && (await plainPage.locator('.lp-film-caption details').innerText()).includes('Kafka') && await play(plainPage).isDisabled());
    await plain.close();
  } finally { await browser.close(); writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2)); }
}
if (results.some(r => !r.ok)) process.exitCode = 1;

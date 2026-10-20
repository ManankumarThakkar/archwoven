// Offline media rendering harness; does not launch Archwoven or contact an AI provider.
import { createRequire } from 'node:module';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { duration } from './film.mjs';
const [playwrightRoot, output = '/private/tmp/archwoven-landing-film-output'] = process.argv.slice(2);
if (!playwrightRoot) throw new Error('Usage: node render.mjs <directory containing playwright-core> [output directory]');
const { chromium } = createRequire(resolve(playwrightRoot, 'package.json'))('playwright-core');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const failures = [];
page.on('pageerror', e => failures.push(e.message));
const network = [];
page.on('request', req => network.push(req.url()));
try {
  await mkdir(resolve(output, 'frames'), { recursive: true });
  await page.goto('http://127.0.0.1:3147/?render=1');
  await page.waitForFunction(() => window.film);
  await page.evaluate(() => document.fonts.ready);
  const times = [1.5, 4.5, 9.2, 16.2, 21.7, 25.8, 30.4];
  const bounds = [];
  for (let i = 0; i < times.length; i++) {
    await page.evaluate(t => window.film.seek(t), times[i]);
    bounds.push(await page.locator('#stage > svg').evaluate(svg => [...svg.querySelectorAll('text')].filter(e => e.getBoundingClientRect().width && !e.closest('g[opacity="0"]') && !e.closest('[data-camera]')).map(e => ({ text: e.textContent, ...(() => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; })() })).filter(r => r.x < 0 || r.y < 0 || r.right > 1920 || r.bottom > 1080)));
    await page.screenshot({ path: resolve(output, `keyframe-${i}.jpg`), type: 'jpeg', quality: 95 });
  }
  await copyFile(resolve(output, 'keyframe-0.jpg'), resolve(output, 'poster.jpg'));
  await writeFile(resolve(output, 'render-checks.json'), JSON.stringify({ failures, bounds, network }, null, 2));
  if (failures.length || bounds.some(b => b.length)) throw new Error('Render checks failed; inspect render-checks.json');
  if (process.env.KEYFRAMES_ONLY === '1') process.exitCode = 0;
  else {
    const fps = 30, frames = duration * fps;
    for (let frame = 0; frame < frames; frame++) {
      await page.evaluate(t => window.film.seek(t), frame / fps);
      await page.screenshot({ path: resolve(output, 'frames', `${String(frame).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
      if (frame % 150 === 0) console.log(`Rendered ${frame}/${frames}`);
    }
    console.log(`Rendered ${frames} frames at ${fps} fps.`);
  }
} finally { await browser.close(); }

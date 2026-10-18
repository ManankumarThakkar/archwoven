#!/usr/bin/env node
/** Real rendering of a recorded model; API fixture only, no generation/provider calls.
 * node apps/web/e2e/responsive-workspace.mjs <baseUrl> <outDir> <toolsDir> [chromium,webkit]
 * toolsDir contains node_modules/{playwright-core,axe-core}; neither is a project dependency.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, out, tools, engines = 'chromium,webkit'] = process.argv.slice(2);
if (!base || !out || !tools) throw new Error('Expected base URL, output directory and browser tools directory');
const require = createRequire(join(tools, 'package.json'));
const pw = require('playwright-core');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const model = JSON.parse(readFileSync(new URL('../../../benchmarks/ordinary-model-floor/fixtures/postmerge-checkout.model.json', import.meta.url), 'utf8'));
mkdirSync(out, { recursive: true });
const results = [];
const check = (browser, width, name, ok, detail = '') => {
  results.push({ browser, width, name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${browser}/${width}] ${name}${detail ? `: ${detail}` : ''}`);
};

for (const name of engines.split(',')) {
  let browser;
  try {
    browser = await pw[name].launch();
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/models/responsive-fixture', route => route.fulfill({ json: { model } }));
    // Catch accidental generation/refinement during this visual-only scenario.
    await page.route('**/api/**', route => {
      if (route.request().method() !== 'GET') {
        errors.push(`Unexpected mutation: ${new URL(route.request().url()).pathname}`);
        return route.abort();
      }
      return route.fallback();
    });
    await page.goto(`${base}/workspace#model=responsive-fixture`);
    await page.waitForSelector('.react-flow__node');
    await page.getByRole('button', { name: 'Find node /', exact: true }).click();
    await page.getByRole('textbox', { name: 'Find node', exact: true }).fill(model.nodes[0].label);
    await page.getByRole('textbox', { name: 'Find node', exact: true }).press('Enter');
    await page.waitForSelector('.aw-inspector-heading');

    // Resize the same selected diagram across both layout boundaries in both directions.
    for (const width of [901, 960, 1024, 1100, 1200, 1201, 1280, 1440, 900, 768, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250); // ResizeObserver's debounced camera update is 100 ms.
      const boxes = await page.evaluate(() => {
        const box = selector => {
          const element = document.querySelector(selector);
          const r = element.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        };
        const rail = document.querySelector('.aw-outline-rail');
        return {
          canvas: box('.aw-flow-area'),
          main: box('.aw-diagram-main'),
          form: box('.aw-create-panel'),
          inspector: box('.workspace-shell > aside:not(.aw-create-panel)'),
          railVisible: !!rail && getComputedStyle(rail).display !== 'none',
          scrollWidth: document.documentElement.scrollWidth,
          viewport: document.documentElement.clientWidth,
        };
      });
      check(name, width, 'page has no horizontal overflow', boxes.scrollWidth <= boxes.viewport + 1);
      check(name, width, 'diagram has usable width', boxes.canvas.width >= (width > 900 ? 480 : width - 2), `${Math.round(boxes.canvas.width)} px`);
      check(name, width, 'diagram has usable height', boxes.canvas.height >= 180, `${Math.round(boxes.canvas.height)} px`);
      check(name, width, 'outline does not cover a narrow canvas', boxes.canvas.width > 640 || !boxes.railVisible);
      if (width > 900 && width <= 1200) {
        check(name, width, 'inspector sits below both working panes', boxes.inspector.y >= Math.max(boxes.main.bottom, boxes.form.bottom) - 1);
        check(name, width, 'form stays beside the diagram', boxes.form.right <= boxes.main.x + 1);
      } else if (width > 1200) {
        check(name, width, 'desktop inspector stays beside diagram', boxes.inspector.x >= boxes.main.right - 1);
      } else {
        check(name, width, 'phone/tablet panes stack', boxes.main.y >= boxes.form.bottom - 1 && boxes.inspector.y >= boxes.main.bottom - 1);
      }
      const state = await page.locator('.aw-inspector-heading strong').textContent();
      check(name, width, 'selection survives resizing', state === model.nodes[0].label);
      await page.screenshot({ path: join(out, `${name}-${width}.png`) });
    }

    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForTimeout(250);
    const nameField = page.getByRole('complementary', { name: 'Inspector', exact: true }).getByRole('textbox', { name: 'Element name', exact: true });
    await page.getByRole('button', { name: 'Delete diagram', exact: true }).focus();
    const nextControl = name === 'webkit' ? 'Alt+Tab' : 'Tab';
    for (let step = 0; step < 5; step++) {
      await page.keyboard.press(nextControl);
      if (await nameField.evaluate(element => document.activeElement === element)) break;
    }
    await page.waitForTimeout(100);
    const focused = await nameField.evaluate(element => {
      const box = element.getBoundingClientRect();
      return document.activeElement === element && box.top >= 0 && box.bottom <= window.innerHeight;
    });
    check(name, 1024, 'inspector can be reached by keyboard below the diagram', focused);
    await page.screenshot({ path: join(out, `${name}-1024-inspector.png`) });
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => (await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    })).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })));
    check(name, 1024, 'loaded workspace passes axe WCAG A/AA', violations.length === 0, JSON.stringify(violations));
    // Browser zoom can produce fractional CSS viewport widths between 900 and 901.
    await page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.id = 'fractional-workspace';
      frame.title = 'Fractional viewport regression';
      frame.style.cssText = 'width:900.5px;height:900px;border:0';
      frame.src = '/workspace#model=responsive-fixture';
      document.body.append(frame);
    });
    const fractional = page.frameLocator('#fractional-workspace').locator('.aw-flow-area');
    await fractional.waitFor();
    const fractionalWidth = await fractional.evaluate(element => element.getBoundingClientRect().width);
    check(name, 900.5, 'fractional breakpoint keeps canvas usable', fractionalWidth >= 480, `${fractionalWidth} px`);
    check(name, 1024, 'no page errors or mutations', errors.length === 0, errors.join(' | '));
  } catch (error) {
    check(name, null, 'scenario completes', false, error.message);
  } finally { await browser?.close(); }
}
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
process.exitCode = results.some(r => !r.ok) ? 1 : 0;

/**
 * Probe D eval runner — local Ollama model (private path), no external API.
 * Usage: npx tsx probes/local/run-eval.ts [model]   (default gpt-oss:120b)
 * 5 prompts from probe B's set + one 40-node output stress (Review Focus 5).
 * Prints per-prompt rows + aggregate: schema-valid rate, TTFT, total latency.
 */
import { generateModelLocal, LOCAL_MODEL } from '../../src/local';
import type { ViewType } from '@archwoven/model';

const MODEL = process.argv[2] ?? LOCAL_MODEL;

const PROMPTS: { view: ViewType; prompt: string }[] = [
  { view: 'architecture', prompt: 'E-commerce platform with payments and inventory' },
  { view: 'architecture', prompt: 'Multi-tenant SaaS with authentication and billing' },
  { view: 'sequence', prompt: 'User login with OAuth and JWT' },
  { view: 'sequence', prompt: 'Place an order with payment and inventory checks' },
  { view: 'er', prompt: 'E-commerce database with orders, products, and users' },
];

const STRESS: { view: ViewType; prompt: string } = {
  view: 'architecture',
  prompt:
    'Design a large marketplace platform with at least 40 distinct components: web and mobile gateways, API gateway, auth, users, catalog, search, cart, checkout, payments (PSP, wallet, fraud), inventory, warehouse, shipping (3 carriers), notifications (email, push, SMS), recommendations, reviews, pricing, promotions, analytics, event bus, caches, primary and replica databases per domain, admin tooling, and support ticketing. Give each its own node.',
};

async function main() {
  console.log(`Probe D eval — ${MODEL} — ${PROMPTS.length} prompts + stress\n`);
  const rows: { ok: boolean; repairs: number; nodes: number; ttft: number; ms: number }[] = [];

  for (const { view, prompt } of [...PROMPTS, STRESS]) {
    const r = await generateModelLocal(prompt, view, { model: MODEL });
    const u = r.usage as typeof r.usage & { ttftMs?: number };
    const nodes = r.ok ? r.model.nodes.length : 0;
    rows.push({ ok: r.ok, repairs: u.repairs, nodes, ttft: u.ttftMs ?? 0, ms: u.latencyMs });
    const errs = r.ok ? '' : ` ERRORS: ${r.errors.slice(0, 2).join(' | ')}`;
    console.log(
      `${r.ok ? 'PASS' : 'FAIL'} [${view}${prompt === STRESS.prompt ? ' STRESS' : ''}] repairs=${u.repairs} nodes=${nodes} ttft=${((u.ttftMs ?? 0) / 1000).toFixed(1)}s total=${(u.latencyMs / 1000).toFixed(1)}s${errs}`,
    );
  }

  const okCount = rows.filter((r) => r.ok).length;
  const maxTtft = Math.max(...rows.map((r) => r.ttft));
  const maxMs = Math.max(...rows.map((r) => r.ms));
  console.log(`\nAGGREGATE valid=${okCount}/${rows.length} maxTTFT=${(maxTtft / 1000).toFixed(1)}s maxTotal=${(maxMs / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error('eval crashed:', e);
  process.exit(1);
});

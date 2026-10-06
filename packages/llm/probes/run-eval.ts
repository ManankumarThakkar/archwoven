/**
 * Probe B eval runner — real API calls, spend-capped.
 * Usage: ANTHROPIC_API_KEY=... npx tsx probes/run-eval.ts [low|medium]
 * 10 prompts from SPEC §4 example chips. Prints per-prompt rows + aggregate.
 */
import { generateModel, MODEL } from '../src/client';
import type { ViewType } from '@archwoven/model';

const EFFORT = (process.argv[2] === 'low' ? 'low' : 'medium') as 'low' | 'medium';

// opus-5.5 per-MTok (verify against live pricing before quoting externally)
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };

const PROMPTS: { view: ViewType; prompt: string }[] = [
  { view: 'architecture', prompt: 'E-commerce platform with payments and inventory' },
  { view: 'architecture', prompt: 'Customer support chatbot with vector search and human escalation' },
  { view: 'architecture', prompt: 'Multi-tenant SaaS with authentication and billing' },
  { view: 'architecture', prompt: 'Real-time analytics pipeline with streaming data' },
  { view: 'architecture', prompt: 'ML model training and deployment pipeline' },
  { view: 'sequence', prompt: 'User login with OAuth and JWT' },
  { view: 'sequence', prompt: 'Place an order with payment and inventory checks' },
  { view: 'sequence', prompt: 'RAG chatbot query flow with vector search' },
  { view: 'er', prompt: 'E-commerce database with orders, products, and users' },
  { view: 'er', prompt: 'Hospital database with patients, doctors, and appointments' },
];

async function main() {
  console.log(`Probe B eval — ${MODEL} effort=${EFFORT} — ${PROMPTS.length} prompts\n`);
  const rows: { ok: boolean; repairs: number; in: number; cacheRead: number; out: number; ms: number; cost: number }[] = [];

  for (const { view, prompt } of PROMPTS) {
    const r = await generateModel(prompt, view, { effort: EFFORT });
    const u = r.usage;
    const cost =
      (u.inputTokens * PRICE.input + u.cacheWriteTokens * PRICE.cacheWrite +
        u.cacheReadTokens * PRICE.cacheRead + u.outputTokens * PRICE.output) / 1e6;
    rows.push({ ok: r.ok, repairs: u.repairs, in: u.inputTokens, cacheRead: u.cacheReadTokens, out: u.outputTokens, ms: u.latencyMs, cost });
    const errs = r.ok ? '' : ` ERRORS: ${r.errors.slice(0, 2).join(' | ')}`;
    console.log(`${r.ok ? 'PASS' : 'FAIL'} [${view}] repairs=${u.repairs} in=${u.inputTokens} cacheR=${u.cacheReadTokens} out=${u.outputTokens} ${Math.round(u.latencyMs / 100)}0s $${cost.toFixed(4)}${errs}`);
  }

  const firstPass = rows.filter((r) => r.ok && r.repairs === 0).length;
  const ok = rows.filter((r) => r.ok).length;
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const cacheHits = rows.filter((r) => r.cacheRead > 0).length;
  const medianMs = rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
  console.log(`\n== ${EFFORT.toUpperCase()} == first-pass ${firstPass}/${rows.length} | final ${ok}/${rows.length} | cache hits ${cacheHits} | median ${Math.round(medianMs!)}ms | total $${totalCost.toFixed(3)}`);
}

main().catch((e) => { console.error('EVAL CRASH:', e); process.exit(1); });

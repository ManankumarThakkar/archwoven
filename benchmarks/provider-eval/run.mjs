#!/usr/bin/env node
/**
 * Representative real-provider evaluation. Drives a running Archwoven
 * server through the public API, one case at a time, and reads per-call usage
 * from that server's own metering database.
 *
 *   node benchmarks/provider-eval/run.mjs <baseUrl> <server.db> <outDir> [--budget 7.5] [--only id,id]
 *
 * Each description or repository case uses its own session and simulated
 * network address (X-Forwarded-For), so quotas and burst limits do not shape
 * the results; refinements reuse the session that created their diagram. New
 * cases stop starting once metered spend reaches the --budget threshold. The
 * server must also reserve every paid attempt against its separate persistent
 * ARCHWOVEN_EVAL_BUDGET_DB cap. Writes
 * <outDir>/results.json (per case and summary) and the saved models.
 */
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateModel } from '../../packages/model/dist/index.js';
import { scoreDiagram } from './score.mjs';
import { assertLegacyEvalServer } from './config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const [base, dbPath, outDir] = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!base || !dbPath || !outDir) { console.error('usage: run.mjs <baseUrl> <server.db> <outDir> [--budget 7.5] [--only id,id]'); process.exit(2); }
const budget = Number(flag('--budget', '7.5'));
if (!Number.isFinite(budget) || budget <= 0) throw new Error('--budget must be a positive finite dollar amount');
const configResponse = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
if (!configResponse.ok) throw new Error('Could not verify evaluation server configuration');
assertLegacyEvalServer(await configResponse.json());
const only = flag('--only')?.split(',');
const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'));
const PRICES = { input: 4, cacheWrite: 5, cacheRead: 0.2 }; // USD per million tokens, as packages/jobs/src/quota.ts
mkdirSync(join(outDir, 'models'), { recursive: true });

const db = new DatabaseSync(dbPath, { readOnly: true });
const spent = () => db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS c FROM call_log').get().c;
/** Provider calls metered for one session, optionally only those after the first `skip`. */
const usageOf = (sessionId, skip = 0) => {
  const calls = db.prepare('SELECT view, input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, cost_usd, retries, outcome FROM call_log WHERE session_id = ? ORDER BY id').all(sessionId ?? '').slice(skip);
  const sum = (k) => calls.reduce((n, r) => n + (r[k] ?? 0), 0);
  return { calls: calls.map((r) => ({ view: r.view, outcome: r.outcome, repairs: r.retries, costUsd: r.cost_usd })), inputTokens: sum('input_tokens'), cacheWriteTokens: sum('cache_write_tokens'), cacheReadTokens: sum('cache_read_tokens'), outputTokens: sum('output_tokens'), costUsd: sum('cost_usd'), repairs: sum('retries') };
};

let net = 0;
function client() {
  const address = `198.18.${Math.floor(++net / 250)}.${(net % 250) + 1}`;
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': address, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { call, session: () => /aw_sid=([\w-]+)/.exec(cookie)?.[1] };
}

async function waitJob(c, jobId) {
  for (let i = 0; i < 1500; i++) {
    const { body } = await c.call('GET', `/api/jobs/${jobId}`);
    if (!['queued', 'running'].includes(body?.status)) return body;
    await new Promise((r) => setTimeout(r, 200));
  }
  return { status: 'driver-timeout' };
}

const saveModel = async (c, id, modelId) => {
  const { body } = await c.call('GET', `/api/models/${modelId}`);
  const file = join(outDir, 'models', `${id}.model.json`);
  writeFileSync(file, JSON.stringify(body?.model ?? null, null, 2) + '\n');
  return { model: body?.model, file };
};
const shape = (m) => m ? { nodes: m.nodes.length, edges: m.edges.length, views: m.views?.map((v) => v.type), openQuestions: m.openQuestions?.length ?? 0, valid: validateModel(m).ok } : null;

/** Suite A gates through the existing harness, so receipts land with the others. */
function suiteA(caseId, file) {
  const harness = join(root, 'benchmarks/ordinary-model-floor/harness.mjs');
  const runner = `provider-eval-${new Date().toISOString().slice(0, 10)}`;
  const run = (...args) => spawnSync('node', [harness, ...args, '--runner', runner], { encoding: 'utf8' });
  const check = run('check', `cases/${caseId}.case.json`, file);
  const verify = run('verify', file, caseId);
  return { semantic: check.status === 0, validate: verify.status === 0, missing: check.stderr.trim() || undefined };
}

// ── cases ──
const byId = new Map([...cases.generations.map((c) => ['generation', c]), ...cases.refinements.map((c) => ['refinement', c]), ...cases.repositories.map((c) => ['repository', c])].map(([kind, c]) => [c.id, { kind, ...c }]));
const sessions = new Map(); // generation id -> { client, modelId, revision }
const results = [];

async function runGeneration(c) {
  const cl = client();
  const t0 = Date.now();
  const start = await cl.call('POST', '/api/generate', { prompt: c.prompt, view: c.view, idempotencyKey: `eval-${c.id}-${t0}` });
  if (start.status !== 202) return { status: `http-${start.status}`, error: start.body };
  let job = await waitJob(cl, start.body.jobId);
  let clarification;
  if (job.status === 'clarifying') {
    clarification = { questions: job.questions, askedAfterMs: Date.now() - t0 };
    const skip = await cl.call('POST', '/api/generate', { clarification: { jobId: start.body.jobId, skip: true } });
    job = skip.status === 202 ? await waitJob(cl, skip.body.jobId) : { status: `skip-http-${skip.status}`, error: skip.body };
  }
  const latencyMs = Date.now() - t0;
  const out = { status: job.status, error: job.error ?? undefined, latencyMs, clarification, usage: usageOf(cl.session()) };
  if (job.status !== 'succeeded') return out;
  const { model, file } = await saveModel(cl, c.id, job.modelId);
  sessions.set(c.id, { client: cl, modelId: job.modelId, revision: model?.revision });
  return { ...out, model: shape(model), ...(c.suiteA ? { suiteA: suiteA(c.suiteA, file) } : {}) };
}

async function runRefinement(c) {
  const source = sessions.get(c.on);
  if (!source) return { status: 'skipped', error: `no diagram from ${c.on}` };
  const before = usageOf(source.client.session()).calls.length;
  const t0 = Date.now();
  const res = await source.client.call('POST', '/api/refine', { modelId: source.modelId, baseRevision: source.revision, instruction: c.instruction, view: 'architecture' });
  const latencyMs = Date.now() - t0;
  const out = { status: res.status === 200 ? 'succeeded' : `http-${res.status}`, error: res.status === 200 ? undefined : res.body, latencyMs, usage: usageOf(source.client.session(), before) };
  if (res.status !== 200) return out;
  const { model } = await saveModel(source.client, c.id, source.modelId);
  return { ...out, model: shape(model) };
}

async function runRepository(c) {
  const cl = client();
  const t0 = Date.now();
  const start = await cl.call('POST', '/api/repo', { url: c.url, idempotencyKey: `eval-${c.id}-${t0}` });
  if (start.status !== 202) return { status: `http-${start.status}`, error: start.body };
  const job = await waitJob(cl, start.body.jobId);
  const out = { status: job.status, error: job.error ?? undefined, latencyMs: Date.now() - t0, gaps: job.gaps?.length ?? 0, usage: usageOf(cl.session()) };
  if (job.status !== 'succeeded') return out;
  const { model } = await saveModel(cl, c.id, job.modelId);
  const truth = c.truth ? JSON.parse(readFileSync(join(root, 'probes/ground-truth', c.truth), 'utf8')) : null;
  return { ...out, model: shape(model), ...(truth && model ? { diagram: scoreDiagram(model, truth) } : {}) };
}

const runners = { generation: runGeneration, refinement: runRefinement, repository: runRepository };
for (const id of cases.order.filter((id) => !only || only.includes(id))) {
  const c = byId.get(id);
  if (spent() >= budget) { results.push({ id, kind: c.kind, status: 'not-run', error: `budget $${budget} reached` }); console.log(`${id}: not run (budget)`); continue; }
  let r;
  try { r = await runners[c.kind](c); } catch (err) { r = { status: 'driver-error', error: String(err?.message ?? err) }; }
  results.push({ id, kind: c.kind, ...(c.view ? { view: c.view } : {}), ...r });
  console.log(`${id}: ${r.status}${r.latencyMs ? ` in ${(r.latencyMs / 1000).toFixed(1)} s` : ''}${r.usage ? ` · $${r.usage.costUsd.toFixed(3)} · repairs ${r.usage.repairs}` : ''} · spent $${spent().toFixed(3)}`);
}

// ── summary ──
const pct = (n, d) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : '—');
const quantile = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
const seconds = (ms) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);
function group(rows) {
  const ran = rows.filter((r) => r.status !== 'not-run');
  const ok = ran.filter((r) => r.status === 'succeeded');
  const calls = ran.flatMap((r) => r.usage?.calls ?? []);
  const first = calls.filter((x) => x.outcome === 'ok').length;
  const lat = ok.map((r) => r.latencyMs);
  const u = ran.map((r) => r.usage ?? {});
  const tok = (k) => u.reduce((n, x) => n + (x[k] ?? 0), 0);
  return {
    ran: ran.length, succeeded: pct(ok.length, ran.length), providerCalls: calls.length,
    firstPassValid: pct(first, calls.length), repairedToValid: pct(calls.filter((x) => x.outcome === 'repaired').length, calls.length), failedCalls: calls.filter((x) => x.outcome === 'failed').length,
    latencyP50: seconds(quantile(lat, 0.5)), latencyP90: seconds(quantile(lat, 0.9)), latencyMax: seconds(lat.length ? Math.max(...lat) : null),
    costUsd: Number(u.reduce((n, x) => n + (x.costUsd ?? 0), 0).toFixed(4)),
    cacheReadTokens: tok('cacheReadTokens'), cacheWriteTokens: tok('cacheWriteTokens'), uncachedInputTokens: tok('inputTokens'),
    cacheSavingsUsd: Number(((tok('cacheReadTokens') * (PRICES.input - PRICES.cacheRead) - tok('cacheWriteTokens') * (PRICES.cacheWrite - PRICES.input)) / 1e6).toFixed(4)),
  };
}
const gens = results.filter((r) => r.kind === 'generation');
const summary = {
  ranAt: new Date().toISOString(), base, budget, spentUsd: Number(spent().toFixed(4)),
  generations: group(gens),
  byView: Object.fromEntries([...new Set(gens.map((r) => r.view))].map((v) => [v, group(gens.filter((r) => r.view === v))])),
  clarifications: gens.filter((r) => r.clarification).map((r) => r.id),
  validModels: pct(results.filter((r) => r.model?.valid).length, results.filter((r) => r.model).length),
  suiteA: Object.fromEntries(gens.filter((r) => r.suiteA).map((r) => [r.id, r.suiteA])),
  refinements: group(results.filter((r) => r.kind === 'refinement')),
  repositories: group(results.filter((r) => r.kind === 'repository')),
  diagramVsTruth: Object.fromEntries(results.filter((r) => r.diagram).map((r) => [r.id, r.diagram])),
};
writeFileSync(join(outDir, 'results.json'), JSON.stringify({ summary, results }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));

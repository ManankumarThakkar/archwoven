#!/usr/bin/env node
/**
 * Model-aware staged evaluation through the application's own APIs.
 *
 *   node benchmarks/provider-eval/staged/run.mjs plan --ledger <budget.db> [--models a,b,c]
 *   node benchmarks/provider-eval/staged/run.mjs run <baseUrl> --ledger <budget.db> --out <runDir> [--only id,id] [--retry-interrupted]
 *   node benchmarks/provider-eval/staged/run.mjs report <runDir>
 *
 * One server serves one model (ARCHWOVEN_HOSTED_MODEL); restart it per model with
 * the same ARCHWOVEN_EVAL_BUDGET_DB. Every paid attempt is reserved in that
 * ledger by the server; this runner only reads it. Each model's run is an
 * append-only event log under <runDir>/<model>/, so a restarted runner resumes
 * and reports a case it lost as interrupted rather than running it again.
 * The runner must be the ledger's only user while a case runs, so the ledger
 * change during a case belongs to that case. Attempts already in flight when the
 * run starts are a baseline; a case starts only once nothing beyond it is in flight.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOSTED_MODELS, validateModel } from '../../../packages/model/dist/index.js';
import { evaluationLedgerId, openEvaluationBudget } from '../../../packages/jobs/src/evaluation-budget.ts';
import { scoreDiagram } from '../score.mjs';
import { completedStatus, executionOrder, caseHold, failedStatus, largestHold, notAttempted, planModels, readEvents, renderMarkdown, resolveCases, runIdentity, sameIdentity, summarize } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const usd = nanos => `$${(nanos / 1e9).toFixed(4)}`;

export function stageCases() {
  return resolveCases(JSON.parse(readFileSync(join(here, 'screening.json'), 'utf8')), JSON.parse(readFileSync(join(here, '../cases.json'), 'utf8')));
}

function ledgerSnapshot(file) {
  const budget = openEvaluationBudget(file);
  try { return budget.snapshot(); } finally { budget.close(); }
}
const ledgerDelta = (before, after, baseline) => ({
  settledNanos: after.settledNanos - before.settledNanos,
  heldNanos: after.heldNanos - before.heldNanos,
  unknownAttempts: after.unknownAttempts - before.unknownAttempts,
  frozen: after.frozen,
  ...(after.pendingAttempts > baseline ? { inFlightAttempts: after.pendingAttempts - baseline } : {}),
});
/** The ledger once no attempts beyond the baseline are in flight, or after waiting `waitMs`. */
async function settledLedger(file, baseline, waitMs) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const state = ledgerSnapshot(file);
    if (state.pendingAttempts <= baseline || Date.now() >= deadline) return state;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/** Verify the server is a real, budgeted evaluation server reading this ledger. */
export async function evaluationConfig(base, ledgerFile) {
  const response = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok) throw new Error('Could not read the evaluation server configuration.');
  const config = await response.json();
  if (config?.mode !== 'hosted' || config.fake !== false || config.llmReady !== true || !Object.hasOwn(HOSTED_MODELS, config.hostedModel ?? '')) {
    throw new Error('Evaluation requires a configured hosted provider with sample data disabled.');
  }
  if (config.evaluationBudgetEnabled !== true || !config.evaluation) throw new Error('Evaluation requires the server to reserve against an initialized ARCHWOVEN_EVAL_BUDGET_DB.');
  if (config.evaluation.ledger !== evaluationLedgerId(ledgerFile)) throw new Error('The server reserves against a different ledger than --ledger. Use the same file for every model.');
  return config;
}

/** One evaluation session with its own simulated network address, so quotas and burst limits do not shape results. */
function client(base, signal, saved) {
  let cookie = saved?.cookie ?? '';
  const address = saved?.address ?? `198.18.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  const call = async (method, path, body, callSignal = signal) => {
    const res = await fetch(`${base}${path}`, { method, signal: callSignal, headers: { 'content-type': 'application/json', 'x-forwarded-for': address, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { call, saved: () => ({ cookie, address }) };
}

class Interrupted extends Error {}
const pause = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Interrupted()); }, { once: true });
});

/** Poll a job until it settles and its usage is recorded. A job the runner stops waiting for is cancelled. */
async function waitJob(c, jobId, signal, pollMs, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Interrupted();
    const { status, body } = await c.call('GET', `/api/jobs/${jobId}`);
    if (status !== 200) return { status: 'failed', error: `Job status request returned ${status}.` };
    if (!['queued', 'running'].includes(body.status) && !body.usagePending) return body;
    await pause(pollMs, signal);
  }
  await cancelJob(c, jobId);
  return { status: 'failed', error: 'The runner stopped waiting for this job and cancelled it.' };
}
// Sent with its own deadline: after an interrupt the run's signal is already aborted.
const cancelJob = (c, jobId) => c.call('POST', `/api/jobs/${jobId}/cancel`, undefined, AbortSignal.timeout(10_000)).catch(() => null);
const lastTask = async (c, taskId) => {
  const { body } = await c.call('GET', '/api/quota');
  return body?.lastTask && (!taskId || body.lastTask.id === taskId) ? body.lastTask : null;
};
const errorText = body => [body?.error, body?.message, ...(Array.isArray(body?.errors) ? body.errors : [])].filter(Boolean).join('; ') || 'No error message.';

/** Validity, semantic gate and ground truth for a saved model. */
function assess(c, model, file, receipts) {
  const checked = validateModel(model);
  const result = { valid: checked.ok, ...(checked.ok ? {} : { errors: checked.errors.slice(0, 5) }), nodes: model.nodes.length, edges: model.edges.length, views: model.views.map(v => v.type), openQuestions: model.openQuestions?.length ?? 0 };
  let semantic = null;
  if (c.suiteA) {
    const run = spawnSync('node', [join(root, 'benchmarks/ordinary-model-floor/harness.mjs'), 'check', `cases/${c.suiteA}.case.json`, file, '--runner', 'staged-eval', '--results-dir', receipts], { encoding: 'utf8' });
    // Exit 1 is a failed gate; anything else means the check itself did not run.
    if (run.status !== 0 && run.status !== 1) throw new Error(`The Suite A check could not run (exit ${run.status}).`);
    semantic = { gate: 'suite-a', passed: run.status === 0, ...(run.status === 0 ? {} : { missing: run.stderr.trim().slice(0, 500) }) };
  }
  const truth = c.truth ? scoreDiagram(model, JSON.parse(readFileSync(join(root, 'probes/ground-truth', c.truth), 'utf8'))) : null;
  return { result, semantic, truth, ...completedStatus({ valid: checked.ok, semantic }) };
}

async function saveModel(cl, dir, id, modelId) {
  const { status, body } = await cl.call('GET', `/api/models/${modelId}`);
  if (status !== 200 || !body?.model) return null;
  const file = join(dir, 'models', `${id}.model.json`);
  writeFileSync(file, JSON.stringify(body.model, null, 2) + '\n');
  return { model: body.model, file };
}

/** Run one case. Returns its record without ledger fields. */
async function runCase(c, ctx) {
  const { base, dir, signal, records, pollMs, timeoutMs } = ctx;
  const t0 = Date.now();
  const tasks = [];
  const finish = async (cl, modelId, extra = {}) => {
    const saved = await saveModel(cl, dir, c.id, modelId);
    if (!saved) return { status: 'failed', reason: 'The saved diagram could not be read back.', tasks, ...extra };
    return { ...assess(c, saved.model, saved.file, join(dir, 'suite-a')), tasks, modelFile: saved.file, modelId, revision: saved.model.revision, session: cl.saved(), ...extra };
  };
  if (c.kind === 'refinement') {
    const source = records.get(c.on);
    const cl = client(base, signal, source.session);
    // Refine the saved diagram as it is now, and count only the task this request creates.
    const current = await cl.call('GET', `/api/models/${source.modelId}`);
    const earlierTask = (await lastTask(cl))?.id;
    const res = await cl.call('POST', '/api/refine', { modelId: source.modelId, baseRevision: current.body?.model?.revision ?? source.revision, instruction: c.instruction, view: 'architecture' });
    const task = await lastTask(cl);
    if (task && task.action === 'refine' && task.id !== earlierTask) tasks.push(task);
    const latencyMs = Date.now() - t0;
    if (res.status === 422) return { status: 'rejected', reason: errorText(res.body), tasks, latencyMs };
    if (res.status !== 200) return { ...failedStatus(errorText(res.body), tasks.at(-1)), tasks, latencyMs };
    return { ...(await finish(cl, source.modelId)), latencyMs };
  }
  const cl = client(base, signal);
  const path = c.kind === 'repository' ? '/api/repo' : '/api/generate';
  const start = await cl.call('POST', path, c.kind === 'repository' ? { url: c.url, idempotencyKey: `stage-${c.id}-${t0}` } : { prompt: c.prompt, view: c.view, idempotencyKey: `stage-${c.id}-${t0}` });
  if (start.status !== 202) return { ...failedStatus(errorText(start.body), null), latencyMs: Date.now() - t0 };
  ctx.activeJob = { client: cl, jobId: start.body.jobId };
  let job = await waitJob(cl, start.body.jobId, signal, pollMs, timeoutMs);
  let clarification = c.kind === 'generation' ? { expected: c.clarification === 'expected', asked: false } : undefined;
  let taskId = start.body.jobId;
  if (job.status === 'clarifying') {
    const asked = await lastTask(cl, taskId);
    if (asked) tasks.push({ ...asked, role: 'clarification' });
    // Every model gets the same answer: skip, so the diagram is drawn from the description alone.
    const skip = await cl.call('POST', '/api/generate', { clarification: { jobId: start.body.jobId, skip: true } });
    clarification = { ...clarification, asked: true, questions: job.questions, answer: 'skipped' };
    if (skip.status !== 202) return { ...failedStatus(errorText(skip.body), null), tasks, clarification, latencyMs: Date.now() - t0 };
    taskId = skip.body.jobId;
    ctx.activeJob = { client: cl, jobId: taskId };
    job = await waitJob(cl, taskId, signal, pollMs, timeoutMs);
  }
  ctx.activeJob = null;
  const task = await lastTask(cl, taskId);
  if (task) tasks.push(task);
  const latencyMs = Date.now() - t0;
  const repository = c.kind === 'repository' ? { url: c.url, pinnedCommit: /\/tree\/([0-9a-f]{40})/.exec(c.url)?.[1] ?? null } : undefined;
  const extra = { latencyMs, ...(clarification ? { clarification } : {}), ...(repository ? { repository } : {}) };
  if (job.status !== 'succeeded') return { ...failedStatus(job.error ?? `The job ended as ${job.status}.`, task), tasks, ...extra };
  const done = await finish(cl, job.modelId, extra);
  if (repository && done.modelFile) {
    const model = JSON.parse(readFileSync(done.modelFile, 'utf8'));
    done.repository = { ...repository, evidenceCommits: [...new Set(model.nodes.concat(model.edges).flatMap(e => (e.evidence ?? []).map(v => v.commit)).filter(Boolean))] };
  }
  return done;
}

function runnerCommit() {
  const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
  return { commit: git(['rev-parse', 'HEAD']) || null, dirty: git(['status', '--porcelain']).length > 0 };
}

/** Run every pending case for the server's model. Resolves to the model directory. */
export async function runStage({ base, ledger, out, only, retryInterrupted = false, signal = new AbortController().signal, pollMs = 200, timeoutMs = 600_000, settleMs = 60_000, log = console.log }) {
  const config = await evaluationConfig(base, ledger);
  const identity = runIdentity(config);
  const dir = join(out, identity.model);
  mkdirSync(join(dir, 'models'), { recursive: true });
  const eventsFile = join(dir, 'events.jsonl');
  const previous = readEvents(existsSync(eventsFile) ? readFileSync(eventsFile, 'utf8').split('\n') : []);
  if (previous.config && !sameIdentity(previous.config, identity)) throw new Error('This model\'s run used a different prompt version, request configuration or ledger. Use a new output directory.');
  const append = event => appendFileSync(eventsFile, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
  append({ type: 'run', config: identity, runner: runnerCommit() });
  const cases = stageCases();
  const records = previous.records;
  // A case lost by a stopped runner stays interrupted unless explicitly retried.
  for (const record of previous.lost) append({ type: 'result', record });

  const larger = Object.keys(HOSTED_MODELS).filter(m => largestHold(m, cases) > largestHold(identity.model, cases) && !existsSync(join(out, m, 'events.jsonl')));
  if (larger.length) log(`Note: ${larger.join(', ')} reserve more per attempt and have not run here yet. Running them first keeps their larger holds admissible.`);

  const baseline = ledgerSnapshot(ledger).pendingAttempts;
  if (baseline) log(`Note: ${baseline} ledger attempt(s) were already in flight before this run; they are not attributed to any case.`);
  const ctx = { base, dir, signal, records, pollMs, timeoutMs, activeJob: null };
  for (const c of executionOrder(identity.model, cases)) {
    if (only && !only.includes(c.id)) continue;
    ctx.activeJob = null;
    const prior = records.get(c.id);
    if (prior && !notAttempted(prior) && !(prior.status === 'interrupted' && retryInterrupted)) continue;
    if (signal.aborted) break;
    const current = runIdentity(await evaluationConfig(base, ledger));
    if (!sameIdentity(current, identity)) throw new Error('The server configuration changed during the run. Restart the runner with a new output directory.');
    const hold = caseHold(identity.model, c);
    const before = await settledLedger(ledger, baseline, settleMs);
    if (before.pendingAttempts > baseline) throw new Error(`${before.pendingAttempts - baseline} ledger attempt(s) are still in flight from another case or process. Nothing was started; inspect the ledger before resuming.`);
    let record;
    const source = c.on && records.get(c.on);
    if (c.on && !source?.modelId) {
      record = { status: 'skipped', reason: `Its source case ${c.on} produced no diagram.` };
    } else if (before.frozen || before.availableNanos < hold) {
      record = { status: 'budget-blocked', reason: before.frozen ? 'The ledger is frozen for inspection.' : `One attempt needs ${usd(hold)} held; ${usd(before.availableNanos)} is available.`, notStarted: true };
    } else {
      append({ type: 'start', id: c.id, kind: c.kind });
      try { record = await runCase(c, ctx); }
      catch (error) {
        if (!(error instanceof Interrupted) && !signal.aborted) record = { status: 'failed', reason: `Runner error: ${error?.message ?? error}` };
        else {
          const job = ctx.activeJob;
          if (job) await cancelJob(job.client, job.jobId);
          record = { status: 'interrupted', reason: job ? 'Stopped by the operator; the active job was asked to cancel.' : 'Stopped by the operator before the case finished.' };
        }
      }
    }
    // Wait for cancelled or unfinished attempts to settle, so their cost lands on this case.
    record = { id: c.id, kind: c.kind, ...(c.view ? { view: c.view } : {}), holdNanos: hold, ...record, ledger: ledgerDelta(before, await settledLedger(ledger, baseline, settleMs), baseline) };
    records.set(c.id, record);
    append({ type: 'result', record });
    log(`${c.id}: ${record.status}${record.reason ? ` (${record.reason})` : ''} · settled ${usd(record.ledger.settledNanos)}${record.ledger.heldNanos ? ` · still held ${usd(record.ledger.heldNanos)}` : ''}`);
  }
  writeReport(out);
  return dir;
}

/** Summaries for every model under a run directory. */
export function writeReport(out) {
  const cases = stageCases();
  const summaries = readdirSync(out, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(out, entry.name, 'events.jsonl')))
    .map(entry => {
      const { config, records } = readEvents(readFileSync(join(out, entry.name, 'events.jsonl'), 'utf8').split('\n'));
      return summarize(config, cases, records);
    })
    .sort((a, b) => largestHold(b.model, cases) - largestHold(a.model, cases));
  writeFileSync(join(out, 'report.json'), JSON.stringify({ stage: 'screening', generatedAt: new Date().toISOString(), summaries }, null, 2) + '\n');
  writeFileSync(join(out, 'report.md'), renderMarkdown(summaries));
  return summaries;
}

async function main(argv) {
  const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const [command, positional] = argv;
  if (command === 'plan' && flag('--ledger')) {
    const models = flag('--models')?.split(',') ?? Object.keys(HOSTED_MODELS);
    for (const model of models) if (!Object.hasOwn(HOSTED_MODELS, model)) throw new Error(`Unknown model ${model}.`);
    const ledger = ledgerSnapshot(flag('--ledger'));
    console.log(`Ledger: cap ${usd(ledger.capNanos)}, settled ${usd(ledger.settledNanos)}, held ${usd(ledger.heldNanos)}, available ${usd(ledger.availableNanos)}${ledger.frozen ? ', FROZEN' : ''}.`);
    for (const p of planModels(models, stageCases(), ledger)) {
      console.log(`\n${p.model}: largest hold ${usd(p.largestHoldNanos)} per attempt; ${p.admittedNow ? `admitted now, with ${usd(p.headroomNanos)} of further spend or holds before it is refused` : 'NOT admitted with the current ledger'}.`);
      for (const c of p.cases) console.log(`  ${c.id.padEnd(24)} ${c.kind.padEnd(11)} hold ${usd(c.holdNanos)}`);
    }
    console.log('\nRun models in the order listed: the largest holds need the most headroom.');
    return;
  }
  if (command === 'run' && positional && flag('--ledger') && flag('--out')) {
    const controller = new AbortController();
    process.once('SIGINT', () => { console.log('Stopping after cancelling the active job…'); controller.abort(); process.once('SIGINT', () => process.exit(130)); });
    await runStage({ base: positional, ledger: flag('--ledger'), out: flag('--out'), only: flag('--only')?.split(','), retryInterrupted: argv.includes('--retry-interrupted'), signal: controller.signal });
    console.log(`Report: ${join(flag('--out'), 'report.md')}`);
    if (controller.signal.aborted) process.exitCode = 130;
    return;
  }
  if (command === 'report' && positional) { writeReport(positional); console.log(readFileSync(join(positional, 'report.md'), 'utf8')); return; }
  console.error('Usage:\n  run.mjs plan --ledger <budget.db> [--models a,b]\n  run.mjs run <baseUrl> --ledger <budget.db> --out <runDir> [--only id,id] [--retry-interrupted]\n  run.mjs report <runDir>');
  process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));

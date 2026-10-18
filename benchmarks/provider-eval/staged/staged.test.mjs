import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluationHoldNanos } from '../../../packages/model/dist/index.js';
import { evaluationLedgerId, initializeEvaluationBudget, openEvaluationBudget } from '../../../packages/jobs/src/evaluation-budget.ts';
import { executionOrder, failedStatus, isBudgetRefusal, planModels, readEvents, renderMarkdown, resolveCases, summarize } from './lib.mjs';
import { runStage, stageCases } from './run.mjs';

const results = new URL('../results/', import.meta.url);
const recorded = path => JSON.parse(readFileSync(new URL(path, results), 'utf8'));
const checkout = recorded('2026-10-17-hosted-19b-evidence/models/checkout.model.json');
const petclinic = recorded('2026-10-17-hosted-imports-after-19b/models/repo-petclinic.model.json');
const fastapi = recorded('2026-10-17-hosted-imports-after-19b/models/repo-fastapi-template.model.json');
const reviewed = JSON.parse(readFileSync(new URL('../cases.json', import.meta.url), 'utf8'));
const cases = stageCases();
const BUDGET_REFUSAL = 'request failed: Evaluation budget cannot cover another attempt. Existing diagrams remain available. Inspect the budget ledger before continuing.';

const cleanup = [];
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step(); });
function scratch() { const dir = mkdtempSync(join(tmpdir(), 'aw-staged-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true })); return dir; }
function ledger(dir, capNanos = 6_000_000_000) { const file = join(dir, 'budget.db'); initializeEvaluationBudget(file, capNanos); return file; }
const snapshot = file => { const budget = openEvaluationBudget(file); try { return budget.snapshot(); } finally { budget.close(); } };

/**
 * A stand-in for the application's evaluation API. Paid attempts reserve and
 * settle in the real ledger file exactly as the server's guard would.
 * `script[caseId]` decides each case's outcome.
 */
async function fakeApp({ ledgerFile, model = 'claude-haiku-5-5', script, config = {} }) {
  const caseOf = new Map([...reviewed.generations.map(c => [c.prompt, c.id]), ...reviewed.repositories.map(c => [c.url, c.id]), ...reviewed.refinements.map(c => [c.instruction, c.id])]);
  const jobs = new Map(), models = new Map(), tasks = new Map(), posts = [];
  const app = { posts, cancelled: [], promptVersion: 'p-000000000000', jobs };
  const attempt = (charge) => {
    const budget = openEvaluationBudget(ledgerFile);
    try { const ticket = budget.reserve(evaluationHoldNanos(model, 8192), { model, basis: 'test' }); budget.settle(ticket, charge); }
    finally { budget.close(); }
  };
  const task = (session, id, action, outcome, charge) => tasks.set(session, { id, action, model, effort: 'medium', outcome, repairs: outcome === 'repaired' ? 1 : 0, transportRetries: 0, usageComplete: charge !== null, estimatedCostUsd: charge === null ? null : charge / 1e9, attempts: [{ kind: 'initial', usageComplete: charge !== null }] });
  const hold = () => { const budget = openEvaluationBudget(ledgerFile); try { return budget.reserve(evaluationHoldNanos(model, 8192), { model, basis: 'test' }); } finally { budget.close(); } };
  const settleLater = (ticket, charge) => setTimeout(() => { const budget = openEvaluationBudget(ledgerFile); try { budget.settle(ticket, charge); } finally { budget.close(); } }, 50);
  function settle(session, jobId, behaviour, action) {
    const job = jobs.get(jobId);
    if (behaviour.hang) { job.ticket = hold(); job.cancelCharge = behaviour.cancelCharge; return; }
    if (behaviour.leak) hold(); // an attempt still in flight after the job reported its result
    if (behaviour.clarify) { attempt(1_000_000); task(session, jobId, action, 'ok', 1_000_000); Object.assign(job, { status: 'clarifying', questions: behaviour.clarify, next: behaviour.then }); return; }
    if (behaviour.refused) { Object.assign(job, { status: 'failed', error: BUDGET_REFUSAL }); return; }
    const charge = behaviour.unknownUsage ? null : behaviour.charge ?? 2_000_000;
    attempt(charge);
    if (behaviour.error) { task(session, jobId, action, 'failed', charge); Object.assign(job, { status: 'failed', error: behaviour.error }); return; }
    models.set(jobId, structuredClone(behaviour.model)); task(session, jobId, action, behaviour.repaired ? 'repaired' : 'ok', charge);
    Object.assign(job, { status: 'succeeded', modelId: jobId });
  }
  let next = 0;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const session = /aw_sid=([\w-]+)/.exec(req.headers.cookie ?? '')?.[1] ?? `s${++next}`;
    const send = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json', 'set-cookie': `aw_sid=${session}; Path=/` }); res.end(JSON.stringify(payload)); };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST') posts.push(url.pathname);
    if (url.pathname === '/api/config') return send(200, { mode: 'hosted', fake: false, llmReady: true, hostedModel: model, evaluationBudgetEnabled: true, evaluationBudgetCapNanos: snapshot(ledgerFile).capNanos, evaluation: { ledger: evaluationLedgerId(ledgerFile), promptVersion: app.promptVersion, requests: { generate: { maxTokens: 8192 } } }, ...config });
    if (url.pathname === '/api/quota') return send(200, { lastTask: tasks.get(session) ?? null });
    if (url.pathname === '/api/generate' || url.pathname === '/api/repo') {
      const jobId = `job${++next}`;
      if (body.clarification) {
        const previous = jobs.get(body.clarification.jobId);
        jobs.set(jobId, { status: 'running' }); settle(session, jobId, previous.next, 'generate');
      } else {
        const id = caseOf.get(body.prompt ?? body.url);
        jobs.set(jobId, { status: 'running', id }); settle(session, jobId, script[id], url.pathname === '/api/repo' ? 'repo' : 'generate');
      }
      return send(202, { jobId });
    }
    const jobMatch = /^\/api\/jobs\/([^/]+)(\/cancel)?$/.exec(url.pathname);
    if (jobMatch && jobMatch[2]) {
      const job = jobs.get(jobMatch[1]); app.cancelled.push(jobMatch[1]);
      // The provider reports usage for the cancelled attempt a little later.
      if (job.ticket) settleLater(job.ticket, job.cancelCharge ?? null);
      Object.assign(job, { status: 'cancelled' }); return send(200, {});
    }
    if (jobMatch) { const job = jobs.get(jobMatch[1]); app.polled = true; return send(200, { status: job.status, error: job.error ?? null, questions: job.questions ?? [], modelId: job.modelId ?? null, usagePending: false }); }
    const modelMatch = /^\/api\/models\/([^/]+)$/.exec(url.pathname);
    if (modelMatch) return models.has(modelMatch[1]) ? send(200, { model: models.get(modelMatch[1]) }) : send(404, { error: 'model not found' });
    if (url.pathname === '/api/refine') {
      const behaviour = script[caseOf.get(body.instruction)];
      if (behaviour.noChange) return send(422, { reason: 'no-change', message: 'This instruction did not change the diagram.' });
      attempt(behaviour.charge ?? 1_000_000); task(session, `refine${++next}`, 'refine', 'ok', behaviour.charge ?? 1_000_000);
      models.set(body.modelId, { ...structuredClone(behaviour.model), revision: body.baseRevision + 1 });
      return send(200, { model: models.get(body.modelId) });
    }
    send(404, { error: 'not found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise(resolve => server.close(resolve)));
  app.base = `http://127.0.0.1:${server.address().port}`;
  return app;
}

const allSucceed = {
  checkout: { model: checkout }, 'vague-blog': { model: checkout }, 'upload-seq': { model: checkout }, 'courses-er': { model: checkout },
  'notify-component': { model: checkout }, 'refine-add-notify': { model: checkout }, 'repo-petclinic': { model: petclinic }, 'repo-fastapi-template': { model: fastapi },
};
const quiet = () => {};

describe('screening cases', () => {
  it('covers every diagram type, clarification, refinement and pinned repository imports', () => {
    expect(cases.map(c => c.id)).toHaveLength(8);
    expect(new Set(cases.filter(c => c.kind === 'generation').map(c => c.view))).toEqual(new Set(['architecture', 'sequence', 'er', 'component-detail']));
    expect(cases.filter(c => c.clarification === 'expected').map(c => c.id)).toEqual(['vague-blog']);
    expect(cases.filter(c => c.kind === 'refinement').map(c => c.on)).toEqual(['checkout']);
    for (const repo of cases.filter(c => c.kind === 'repository')) expect(repo.url).toMatch(/\/tree\/[0-9a-f]{40}/);
  });
  it('refuses unknown cases and refinements without their source', () => {
    expect(() => resolveCases({ cases: [{ id: 'nope' }] }, reviewed)).toThrow(/exactly one reviewed case/);
    expect(() => resolveCases({ cases: [{ id: 'refine-add-notify' }] }, reviewed)).toThrow(/source case checkout/);
  });
});

describe('execution order', () => {
  it('runs larger holds first and never a refinement before its source', () => {
    const order = executionOrder('claude-opus-5-5', [cases.find(c => c.id === 'refine-add-notify'), ...cases.filter(c => c.id !== 'refine-add-notify')]).map(c => c.id);
    expect(order.at(-1)).toBe('refine-add-notify');
    const sourceFirst = executionOrder('claude-opus-5-5', [{ id: 'r', kind: 'generation', on: 'g' }, { id: 'g', kind: 'refinement' }]).map(c => c.id);
    expect(sourceFirst).toEqual(['g', 'r']);
  });
  it('lists models largest hold first and says which ones the ledger admits now', () => {
    const plan = planModels(['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'], cases, { availableNanos: 3_000_000_000, frozen: false });
    expect(plan.map(p => [p.model, p.admittedNow])).toEqual([['claude-opus-5-5', false], ['claude-sonnet-5-5', true], ['claude-haiku-5-5', true]]);
    expect(plan[1].headroomNanos).toBe(3_000_000_000 - 2_581_920_000);
  });
});

it('tells budget refusals from other failures', () => {
  expect(isBudgetRefusal(BUDGET_REFUSAL)).toBe(true);
  expect(isBudgetRefusal('Evaluation budget is unavailable. Nothing was sent.')).toBe(true);
  expect(isBudgetRefusal('Evaluation accounting failed after sending. Its spending reservation is retained.')).toBe(false);
  expect(isBudgetRefusal('Provider usage exceeded the reviewed evaluation limits. The budget is frozen for inspection.')).toBe(false);
});

describe('staged run through the application API', () => {
  it('records each outcome separately with the ledger change it caused', async () => {
    const dir = scratch(); const ledgerFile = ledger(dir);
    const app = await fakeApp({ ledgerFile, script: {
      ...allSucceed,
      'vague-blog': { clarify: ['Who reads the blog?'], then: { model: checkout } },
      'upload-seq': { refused: true },
      'courses-er': { unknownUsage: true, error: 'request failed: Connection error.' },
      'notify-component': { error: 'edge e.dangling references missing node node.missing' },
      'repo-petclinic': { model: petclinic, repaired: true },
      'repo-fastapi-template': { unknownUsage: true, error: 'request failed: socket hang up' },
    } });
    await runStage({ base: app.base, ledger: ledgerFile, out: join(dir, 'run'), pollMs: 5, log: quiet });
    const report = JSON.parse(readFileSync(join(dir, 'run', 'report.json'), 'utf8')).summaries[0];
    expect(Object.fromEntries(report.rows.map(r => [r.id, r.status]))).toEqual({
      checkout: 'accepted', 'vague-blog': 'accepted', 'upload-seq': 'budget-blocked', 'courses-er': 'failed',
      'notify-component': 'rejected', 'refine-add-notify': 'accepted', 'repo-petclinic': 'accepted', 'repo-fastapi-template': 'failed',
    });
    expect(report).toMatchObject({ model: 'claude-haiku-5-5', promptVersion: 'p-000000000000', ledger: evaluationLedgerId(ledgerFile) });
    expect(report.semantic).toEqual({ checkout: true });
    expect(report.groundTruth['repo-petclinic'].nodeRecall).toMatch(/^\d+\/\d+$/);
    expect(report.clarification).toEqual({ expectedAndAsked: ['vague-blog'], expectedNotAsked: [], askedUnexpectedly: [] });
    // The clarification question is a paid task but not a diagram attempt.
    expect(report.validity).toMatchObject({ completed: 5, validModels: 4, providerTasks: 7, validFirstAttempt: 3, validAfterRepair: 1, failedTasks: 3 });
    // Every paid attempt the fake server made is in the ledger and attributed to its case.
    const ledgerNow = snapshot(ledgerFile);
    expect(report.cost.settledUsd).toBeCloseTo(ledgerNow.settledNanos / 1e9, 9);
    expect(report.cost.outstandingHoldUsd).toBeCloseTo(2 * evaluationHoldNanos('claude-haiku-5-5', 8192) / 1e9, 9);
    expect(report.cost.unknownAttempts).toBe(2);
    expect(report.cost.casesWithUnrecordedLedger).toBe(0);
    expect(report.cost.perAcceptedUsd).toBeCloseTo(ledgerNow.settledNanos / 1e9 / 4, 9);
    const markdown = readFileSync(join(dir, 'run', 'report.md'), 'utf8');
    expect(markdown).toContain('not statistical evidence');
    expect(markdown).toContain('| budget-blocked | 1 |');
    const record = readEvents(readFileSync(join(dir, 'run', 'claude-haiku-5-5', 'events.jsonl'), 'utf8').split('\n')).records.get('repo-petclinic');
    expect(record.repository).toMatchObject({ pinnedCommit: '500158f732419217507c7656904b8e6aa1bcc0d6' });
    expect(record.repository.evidenceCommits.length).toBeGreaterThan(0);
  });

  it('does not start a case the ledger could not admit, and sends nothing for it', async () => {
    const dir = scratch(); const ledgerFile = ledger(dir, 100_000_000);
    const app = await fakeApp({ ledgerFile, script: allSucceed });
    await runStage({ base: app.base, ledger: ledgerFile, out: join(dir, 'run'), pollMs: 5, log: quiet });
    const { records } = readEvents(readFileSync(join(dir, 'run', 'claude-haiku-5-5', 'events.jsonl'), 'utf8').split('\n'));
    expect([...records.values()].map(r => [r.status, r.notStarted])).toEqual(Array(7).fill(['budget-blocked', true]).concat([['skipped', undefined]]));
    expect(app.posts).toEqual([]);
  });

  it('refuses a server that reserves against another ledger, or serves sample output, before any request', async () => {
    const dir = scratch(); const ledgerFile = ledger(dir); const other = ledger(scratch());
    const app = await fakeApp({ ledgerFile: other, script: allSucceed });
    await expect(runStage({ base: app.base, ledger: ledgerFile, out: join(dir, 'run'), log: quiet })).rejects.toThrow(/different ledger/);
    const sample = await fakeApp({ ledgerFile, script: allSucceed, config: { fake: true } });
    await expect(runStage({ base: sample.base, ledger: ledgerFile, out: join(dir, 'run'), log: quiet })).rejects.toThrow(/sample data disabled/);
    expect([...app.posts, ...sample.posts]).toEqual([]);
  });

  it('resumes without repeating finished cases and refuses a changed prompt version', async () => {
    const dir = scratch(); const ledgerFile = ledger(dir); const out = join(dir, 'run');
    const app = await fakeApp({ ledgerFile, script: allSucceed });
    await runStage({ base: app.base, ledger: ledgerFile, out, only: ['checkout'], pollMs: 5, log: quiet });
    expect(app.posts).toEqual(['/api/generate']);
    await runStage({ base: app.base, ledger: ledgerFile, out, pollMs: 5, log: quiet });
    expect(app.posts.filter(p => p === '/api/generate')).toHaveLength(5);
    app.promptVersion = 'p-111111111111';
    await expect(runStage({ base: app.base, ledger: ledgerFile, out, log: quiet })).rejects.toThrow(/different prompt version/);
  });

  it('marks a stopped case interrupted, cancels its job and leaves it alone unless retried', async () => {
    const dir = scratch(); const ledgerFile = ledger(dir); const out = join(dir, 'run');
    const app = await fakeApp({ ledgerFile, script: { ...allSucceed, checkout: { hang: true, cancelCharge: 3_000_000 } } });
    const controller = new AbortController();
    const running = runStage({ base: app.base, ledger: ledgerFile, out, only: ['checkout'], signal: controller.signal, pollMs: 5, log: quiet });
    // Interrupt once the runner knows the job and is polling it.
    while (!app.polled) await new Promise(r => setTimeout(r, 5));
    controller.abort();
    await running;
    expect(app.cancelled).toHaveLength(1);
    const events = () => readEvents(readFileSync(join(out, 'claude-haiku-5-5', 'events.jsonl'), 'utf8').split('\n')).records.get('checkout');
    expect(events()).toMatchObject({ status: 'interrupted', ledger: { settledNanos: 3_000_000, heldNanos: 0 } });
    await runStage({ base: app.base, ledger: ledgerFile, out, only: ['checkout'], pollMs: 5, log: quiet });
    expect(app.posts.filter(p => p === '/api/generate')).toHaveLength(1);
    const fixed = await fakeApp({ ledgerFile, script: allSucceed });
    await runStage({ base: fixed.base, ledger: ledgerFile, out, only: ['checkout'], retryInterrupted: true, pollMs: 5, log: quiet });
    expect(events().status).toBe('accepted');
    // Cost per case includes the interrupted attempt as well as the retry.
    expect(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).summaries[0].cost.settledUsd).toBeCloseTo(0.005, 9);
  });

  it('reports a case lost by a crashed runner as interrupted, with its ledger effect unknown', async () => {
    const dir = scratch(); const ledgerFile = ledger(dir); const out = join(dir, 'run');
    const app = await fakeApp({ ledgerFile, script: allSucceed });
    await runStage({ base: app.base, ledger: ledgerFile, out, only: ['checkout'], pollMs: 5, log: quiet });
    appendFileSync(join(out, 'claude-haiku-5-5', 'events.jsonl'), JSON.stringify({ type: 'start', id: 'upload-seq', kind: 'generation' }) + '\n');
    await runStage({ base: app.base, ledger: ledgerFile, out, only: ['upload-seq'], pollMs: 5, log: quiet });
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).summaries[0];
    expect(report.rows.find(r => r.id === 'upload-seq')).toMatchObject({ status: 'interrupted', reason: expect.stringContaining('inspect the ledger') });
    expect(report.cost.casesWithUnrecordedLedger).toBe(1);
    expect(app.posts).toEqual(['/api/generate']);
  });
});

describe('one ledger user at a time', () => {
  it('treats attempts already in flight as a baseline, and stops when a case leaves another one running', async () => {
    const dir = scratch(); const ledgerFile = ledger(dir); const out = join(dir, 'run');
    const budget = openEvaluationBudget(ledgerFile); budget.reserve(1_000_000, { model: 'earlier', basis: 'test' }); budget.close();
    const app = await fakeApp({ ledgerFile, script: { ...allSucceed, checkout: { model: checkout, leak: true } } });
    await expect(runStage({ base: app.base, ledger: ledgerFile, out, settleMs: 50, pollMs: 5, log: quiet })).rejects.toThrow(/still in flight/);
    expect(app.posts).toEqual(['/api/generate']);
    const record = readEvents(readFileSync(join(out, 'claude-haiku-5-5', 'events.jsonl'), 'utf8').split('\n')).records.get('checkout');
    expect(record).toMatchObject({ status: 'accepted', ledger: { inFlightAttempts: 1 } });
  });
});

it('runs a skipped refinement once its source has a diagram', async () => {
  const dir = scratch(); const ledgerFile = ledger(dir); const out = join(dir, 'run');
  const app = await fakeApp({ ledgerFile, script: allSucceed });
  await runStage({ base: app.base, ledger: ledgerFile, out, only: ['refine-add-notify'], pollMs: 5, log: quiet });
  await runStage({ base: app.base, ledger: ledgerFile, out, only: ['checkout', 'refine-add-notify'], pollMs: 5, log: quiet });
  const records = readEvents(readFileSync(join(out, 'claude-haiku-5-5', 'events.jsonl'), 'utf8').split('\n')).records;
  expect(records.get('refine-add-notify').status).toBe('accepted');
});

it('separates rejected model output from infrastructure failures', () => {
  const answered = { attempts: [{ kind: 'initial', usageComplete: true }], usageComplete: true, outcome: 'failed' };
  expect(failedStatus('edge references a missing node', answered).status).toBe('rejected');
  expect(failedStatus('request failed: Connection error.', { ...answered, usageComplete: false }).status).toBe('failed');
  expect(failedStatus('codeload fetch failed: 404', null).status).toBe('failed');
  expect(failedStatus(BUDGET_REFUSAL, answered).status).toBe('budget-blocked');
  // A refusal after rejected attempts still names what the provider said.
  const rejected = { outcome: 'failed', usageComplete: false, attempts: [{ kind: 'initial', usageComplete: false, error: 'no response: Connection error.' }, { kind: 'retry', usageComplete: false, error: '400 invalid_request_error: speed: not supported' }] };
  expect(failedStatus(BUDGET_REFUSAL, rejected)).toEqual({ status: 'budget-blocked', reason: `${BUDGET_REFUSAL} Provider: 400 invalid_request_error: speed: not supported` });
});

it('summarizes a model with nothing run without inventing results', () => {
  const summary = summarize({ model: 'claude-sonnet-5-5', promptVersion: 'p', requests: {}, ledger: 'l' }, cases, new Map());
  expect(summary.cases).toMatchObject({ total: 8, 'not-run': 8, accepted: 0 });
  expect(summary.cost.perAcceptedUsd).toBeNull();
  expect(summary.latency.completedP50Ms).toBeNull();
});

it('judges clarification only for cases the model actually answered, and says when nothing was measured', () => {
  const identity = { model: 'claude-haiku-5-5', promptVersion: 'p', requests: {}, ledger: 'l' };
  const failed = summarize(identity, cases, new Map([['vague-blog', { id: 'vague-blog', kind: 'generation', status: 'failed', clarification: { expected: true, asked: false } }]]));
  expect(failed.clarification.expectedNotAsked).toEqual([]);
  const answered = summarize(identity, cases, new Map([['vague-blog', { id: 'vague-blog', kind: 'generation', status: 'accepted', result: { valid: true }, clarification: { expected: true, asked: false } }]]));
  expect(answered.clarification.expectedNotAsked).toEqual(['vague-blog']);
  const markdown = renderMarkdown([failed]);
  expect(markdown).toMatch(/### Semantic gates \(Suite A\)\n\nNo results in this run\./);
  expect(markdown).toMatch(/### Ground truth \(not held out\)\n\nNo results in this run\./);
});

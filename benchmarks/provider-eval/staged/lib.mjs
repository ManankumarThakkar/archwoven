/** Pure parts of the staged evaluation runner: case selection, ordering, status
 * classification, resumable event logs and the per-model summary. No I/O. */
import { HOSTED_MODELS, HOSTED_REQUESTS, evaluationHoldNanos } from '../../../packages/model/dist/index.js';

export const STATUSES = ['accepted', 'rejected', 'failed', 'skipped', 'interrupted', 'budget-blocked'];
const ACTION = { generation: 'generate', refinement: 'refine', repository: 'repo' };
// Refusals raised before anything is sent: the ledger cannot fit the attempt, or cannot be read (fail closed).
const BUDGET_REFUSAL = /Evaluation budget (cannot cover another attempt|is unavailable)/;

/** Screening entries resolved against the reviewed case set, in screening order. */
export function resolveCases(screening, reviewed) {
  const lists = { generation: reviewed.generations, refinement: reviewed.refinements, repository: reviewed.repositories };
  const resolved = screening.cases.map(({ id, clarification }) => {
    const found = Object.entries(lists).flatMap(([kind, list]) => list.filter(c => c.id === id).map(c => ({ kind, ...c })));
    if (found.length !== 1) throw new Error(`Screening case ${id} must match exactly one reviewed case.`);
    return { ...found[0], ...(found[0].kind === 'generation' ? { clarification: clarification ?? 'not-expected' } : {}) };
  });
  for (const c of resolved) if (c.on && !resolved.some(s => s.id === c.on)) throw new Error(`Refinement ${c.id} needs its source case ${c.on} in the same stage.`);
  return resolved;
}

/** The ledger hold for one attempt of this case: its full context and output ceiling. */
export const caseHold = (model, c) => evaluationHoldNanos(model, HOSTED_REQUESTS[ACTION[c.kind]].maxTokens);

/** Largest holds first, while the most headroom remains; a refinement never precedes its source. */
export function executionOrder(model, cases) {
  const pending = [...cases].sort((a, b) => caseHold(model, b) - caseHold(model, a));
  const order = [];
  while (pending.length) {
    const next = pending.findIndex(c => !c.on || order.some(o => o.id === c.on));
    order.push(...pending.splice(Math.max(next, 0), 1));
  }
  return order;
}

export const largestHold = (model, cases) => Math.max(...cases.map(c => caseHold(model, c)));

/** Holds per model against the ledger now. Models are listed largest hold first, the recommended order. */
export function planModels(models, cases, ledger) {
  return models.map(model => {
    const order = executionOrder(model, cases);
    const largest = largestHold(model, cases);
    return {
      model, largestHoldNanos: largest,
      admittedNow: !ledger.frozen && ledger.availableNanos >= largest,
      // Settled spend and holds can grow by this much before this model's largest attempt stops being admitted.
      headroomNanos: Math.max(0, ledger.availableNanos - largest),
      cases: order.map(c => ({ id: c.id, kind: c.kind, holdNanos: caseHold(model, c) })),
    };
  }).sort((a, b) => b.largestHoldNanos - a.largestHoldNanos);
}

export const isBudgetRefusal = text => BUDGET_REFUSAL.test(String(text ?? ''));

/** A task that ended without a diagram. When the provider answered every attempt
 * in full, its output was not accepted: a model-quality result, not an outage. */
export function failedStatus(error, task) {
  const provider = task?.attempts?.findLast(a => a.error)?.error;
  const reason = provider ? `${error} Provider: ${provider}` : String(error);
  if (isBudgetRefusal(error)) return { status: 'budget-blocked', reason };
  const answered = task?.outcome === 'failed' && task.usageComplete && task.attempts?.length > 0 && task.attempts.every(a => a.usageComplete);
  return { status: answered ? 'rejected' : 'failed', reason };
}

/** Recorded results that a resumed run should try again: nothing was attempted for them. */
export const notAttempted = record => record.status === 'skipped' || (record.status === 'budget-blocked' && record.notStarted === true);

/** A completed case is accepted only with a valid final model and, where the case has one, a passing semantic gate. */
export function completedStatus({ valid, semantic }) {
  if (!valid) return { status: 'rejected', reason: 'The final model failed validation.' };
  if (semantic && !semantic.passed) return { status: 'rejected', reason: 'The semantic gate failed.' };
  return { status: 'accepted' };
}

/** Rebuild a model's run from its event log. A case that started without a result was interrupted. */
export function readEvents(lines) {
  const events = lines.filter(Boolean).map(line => JSON.parse(line));
  const runs = events.filter(e => e.type === 'run');
  const records = new Map();
  const started = new Map();
  // Ledger changes add up over every attempt at a case, so a retry never hides earlier spend.
  const spent = new Map();
  for (const e of events) {
    if (e.type === 'start') started.set(e.id, e);
    if (e.type !== 'result') continue;
    const { id, ledger } = e.record;
    const total = spent.get(id) ?? { settledNanos: 0, heldNanos: 0, unknownAttempts: 0, unrecorded: false };
    if (ledger) for (const key of ['settledNanos', 'heldNanos', 'unknownAttempts']) total[key] += ledger[key];
    else if (!notAttempted(e.record)) total.unrecorded = true;
    spent.set(id, total);
    records.set(id, e.record); started.delete(id);
  }
  const lost = [...started.values()].map(e => ({ id: e.id, kind: e.kind, status: 'interrupted', reason: 'The runner stopped before this case finished. Its ledger effect was not recorded; inspect the ledger.', startedAt: e.at }));
  for (const record of lost) {
    records.set(record.id, record);
    spent.set(record.id, { ...(spent.get(record.id) ?? { settledNanos: 0, heldNanos: 0, unknownAttempts: 0 }), unrecorded: true });
  }
  for (const [id, total] of spent) records.set(id, { ...records.get(id), ledgerTotal: total });
  return { config: runs[0]?.config ?? null, records, lost };
}

/** Fields that must not change within one model's run. */
export const runIdentity = config => ({ model: config.hostedModel, promptVersion: config.evaluation.promptVersion, requests: config.evaluation.requests, ledger: config.evaluation.ledger });
export const sameIdentity = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
};
const sum = values => values.reduce((n, v) => n + (v ?? 0), 0);

/** One model's results. Validity, semantic gates, ground truth, clarification and cost stay separate. */
export function summarize(identity, cases, records) {
  const rows = cases.map(c => records.get(c.id) ?? { id: c.id, kind: c.kind, status: 'not-run' });
  const count = status => rows.filter(r => r.status === status).length;
  const completed = rows.filter(r => r.status === 'accepted' || r.status === 'rejected');
  const tasks = rows.flatMap(r => r.tasks ?? []);
  // A clarification question is paid for but is not an attempt at a diagram.
  const attempts = tasks.filter(t => t.role !== 'clarification');
  const spent = r => r.ledgerTotal ?? r.ledger ?? {};
  const generations = cases.filter(c => c.kind === 'generation');
  const asked = id => !!records.get(id)?.clarification?.asked;
  // Not asking can only be judged when the model answered: the case completed.
  const answered = id => ['accepted', 'rejected'].includes(records.get(id)?.status);
  const settled = sum(rows.map(r => spent(r).settledNanos));
  const accepted = count('accepted');
  const latencies = completed.map(r => r.latencyMs).filter(Number.isFinite);
  return {
    ...identity,
    costBasis: HOSTED_MODELS[identity.model]?.costBasis ?? null,
    cases: { total: cases.length, ...Object.fromEntries([...STATUSES, 'not-run'].map(s => [s, count(s)])) },
    validity: {
      completed: completed.length,
      validModels: completed.filter(r => r.result?.valid).length,
      providerTasks: attempts.length,
      validFirstAttempt: attempts.filter(t => t.outcome === 'ok').length,
      validAfterRepair: attempts.filter(t => t.outcome === 'repaired').length,
      failedTasks: attempts.filter(t => t.outcome === 'failed').length,
      repairs: sum(attempts.map(t => t.repairs)), transportRetries: sum(attempts.map(t => t.transportRetries)),
    },
    semantic: Object.fromEntries(rows.filter(r => r.semantic).map(r => [r.id, r.semantic.passed])),
    groundTruth: Object.fromEntries(rows.filter(r => r.truth).map(r => [r.id, r.truth])),
    clarification: {
      expectedAndAsked: generations.filter(c => c.clarification === 'expected' && asked(c.id)).map(c => c.id),
      expectedNotAsked: generations.filter(c => c.clarification === 'expected' && answered(c.id) && !asked(c.id)).map(c => c.id),
      askedUnexpectedly: generations.filter(c => c.clarification !== 'expected' && asked(c.id)).map(c => c.id),
    },
    cost: {
      settledUsd: settled / 1e9,
      reportedUsd: sum(tasks.map(t => t.estimatedCostUsd)),
      tasksWithIncompleteUsage: tasks.filter(t => !t.usageComplete).length,
      outstandingHoldUsd: sum(rows.map(r => spent(r).heldNanos)) / 1e9,
      unknownAttempts: sum(rows.map(r => spent(r).unknownAttempts)),
      casesWithUnrecordedLedger: rows.filter(r => spent(r).unrecorded).length,
      // Includes the cost of every attempted case, not only the accepted ones.
      perAcceptedUsd: accepted ? settled / 1e9 / accepted : null,
    },
    latency: { completedP50Ms: quantile(latencies, 0.5), completedMaxMs: latencies.length ? Math.max(...latencies) : null },
    rows: rows.map(({ id, kind, status, reason }) => ({ id, kind, status, ...(reason ? { reason } : {}) })),
  };
}

const usd = n => (n === null || n === undefined ? '—' : `$${n.toFixed(4)}`);
const seconds = ms => (ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} s`);

/** Side-by-side Markdown for people; report.json keeps every field. */
export function renderMarkdown(summaries) {
  const table = (title, rows) => rows.length ? [`### ${title}`, '', `| | ${summaries.map(s => s.model).join(' | ')} |`, `|---|${summaries.map(() => '---').join('|')}|`,
    ...rows.map(([label, cell]) => `| ${label} | ${summaries.map(cell).join(' | ')} |`), ''] : [`### ${title}`, '', 'No results in this run.', ''];
  const ids = [...new Set(summaries.flatMap(s => s.rows.map(r => r.id)))];
  return [
    '# Staged model evaluation: screening',
    '',
    `> Screening set of ${summaries[0]?.cases.total ?? 0} cases per model. It finds large differences and failures cheaply; it is not statistical evidence. A difference of one or two cases between models may be noise.`,
    '',
    ...table('Configuration', [['Prompt version', s => s.promptVersion], ['Cost basis', s => s.costBasis ?? '—'], ['Ledger', s => s.ledger]]),
    ...table('Case outcomes', [...STATUSES, 'not-run'].map(status => [status, s => String(s.cases[status])])),
    ...table('Per case', ids.map(id => [id, s => s.rows.find(r => r.id === id)?.status ?? '—'])),
    ...table('Validity', [
      ['Valid final models / completed', s => `${s.validity.validModels}/${s.validity.completed}`],
      ['Provider tasks valid on first attempt', s => `${s.validity.validFirstAttempt}/${s.validity.providerTasks}`],
      ['Valid after repair', s => String(s.validity.validAfterRepair)],
      ['Failed tasks', s => String(s.validity.failedTasks)],
      ['Repairs · transport retries', s => `${s.validity.repairs} · ${s.validity.transportRetries}`],
    ]),
    ...table('Semantic gates (Suite A)', [...new Set(summaries.flatMap(s => Object.keys(s.semantic)))].map(id => [id, s => (id in s.semantic ? (s.semantic[id] ? 'pass' : 'fail') : '—')])),
    ...table('Ground truth (not held out)', [...new Set(summaries.flatMap(s => Object.keys(s.groundTruth)))].flatMap(id => [
      [`${id} node recall`, s => s.groundTruth[id]?.nodeRecall ?? '—'],
      [`${id} edge recall`, s => s.groundTruth[id]?.edgeRecall ?? '—'],
      [`${id} source-supported node precision`, s => s.groundTruth[id]?.sourceSupportedNodePrecision ?? '—'],
    ])),
    ...table('Clarification', [
      ['Expected and asked', s => s.clarification.expectedAndAsked.join(', ') || '—'],
      ['Expected, not asked', s => s.clarification.expectedNotAsked.join(', ') || '—'],
      ['Asked unexpectedly', s => s.clarification.askedUnexpectedly.join(', ') || '—'],
    ]),
    ...table('Cost and latency', [
      ['Settled in ledger', s => usd(s.cost.settledUsd)],
      ['Reported by the app', s => usd(s.cost.reportedUsd)],
      ['Per accepted case (all attempts)', s => usd(s.cost.perAcceptedUsd)],
      ['Outstanding holds', s => usd(s.cost.outstandingHoldUsd)],
      ['Unknown-usage attempts', s => String(s.cost.unknownAttempts)],
      ['Cases whose ledger change was not recorded', s => String(s.cost.casesWithUnrecordedLedger)],
      ['Tasks with incomplete usage', s => String(s.cost.tasksWithIncompleteUsage)],
      ['Latency p50 · max (completed cases)', s => `${seconds(s.latency.completedP50Ms)} · ${seconds(s.latency.completedMaxMs)}`],
    ]),
    'Accepted means a valid final model that also passes the case\'s semantic gate where it has one. Ground truth and clarification are reported separately and do not change acceptance. Outstanding holds are reservations whose usage was never reported; they are not counted as spend.',
    '',
  ].join('\n');
}

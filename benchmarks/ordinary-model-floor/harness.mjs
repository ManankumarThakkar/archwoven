#!/usr/bin/env node
/**
 * Archwoven ordinary-model-floor — mirrors the archify benchmark format, adapted
 * to our typed SystemModel. Gates per case: semantic (this harness `check`),
 * deterministic validate (`verify` = validateModel incl. semanticChecks),
 * human visual review (`record-visual` — skipped ≠ pass).
 *
 * Commands: check | verify | record-visual | record-failure | report
 * Exit codes: 0 pass · 1 failure · 2 incomplete matrix.
 * Receipts: <results-dir>/<UTC-date>-<runner>.jsonl; failures pin repositoryCommit
 * + packageSha256 so every defect is reproducible against an exact build.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateModel } from '../../packages/model/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const args = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--results-dir' || argv[i] === '--runner') { i++; continue; }
  if (argv[i].startsWith('--')) continue;
  args.push(argv[i]);
}
const [cmd, ...rest] = args;
const resultsDir = flag('--results-dir', join(here, 'results'));
const runner = flag('--runner', process.env.USER ?? 'local');
const p = (s) => (isAbsolute(s) ? s : resolve(here, s));
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));

const receiptFile = () => join(resultsDir, `${new Date().toISOString().slice(0, 10)}-${runner}.jsonl`);
const record = (r) => {
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  appendFileSync(receiptFile(), JSON.stringify({ ts: new Date().toISOString(), runner, ...r }) + '\n');
};

const readReceipts = () => {
  if (!existsSync(resultsDir)) return [];
  return readdirSync(resultsDir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => readFileSync(join(resultsDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
};

function check(casePath, modelPath) {
  const c = JSON.parse(readFileSync(p(casePath), 'utf8'));
  const model = JSON.parse(readFileSync(p(modelPath), 'utf8'));
  const missing = [];
  const bound = new Map();
  for (const req of c.requirements.nodes) {
    const hit = model.nodes.find((n) => n.kind === req.type && req.labels.some((l) => l.toLowerCase() === String(n.label).toLowerCase()));
    if (hit) bound.set(req.key, hit.id);
    else missing.push(`node "${req.key}" (labels: ${req.labels.join('|')}, type: ${req.type})`);
  }
  for (const rel of c.requirements.relationships) {
    const from = bound.get(rel.from), to = bound.get(rel.to);
    if (!from || !to) continue; // already reported as missing nodes
    if (!model.edges.some((e) => e.from === from && e.to === to)) missing.push(`relationship "${rel.from}"→"${rel.to}"`);
  }
  const pass = missing.length === 0;
  record({ case: c.id, gate: 'semantic', pass, missing });
  if (!pass) { console.error(`check ${c.id}: MISSING\n- ${missing.join('\n- ')}`); process.exit(1); }
  console.log(`check ${c.id}: OK (${bound.size} nodes bound, ${c.requirements.relationships.length} relationships)`);
}

function verify(modelPath, caseId) {
  const model = JSON.parse(readFileSync(p(modelPath), 'utf8'));
  const r = validateModel(model);
  if (caseId) record({ case: caseId, gate: 'validate', pass: r.ok, errors: r.ok ? [] : r.errors });
  if (!r.ok) { console.error(`verify: INVALID\n- ${r.errors.join('\n- ')}`); process.exit(1); }
  console.log('verify: VALID');
}

function recordVisual(caseId, verdict, reviewer) {
  if (!['pass', 'fail', 'skipped'].includes(verdict)) { console.error('verdict must be pass|fail|skipped'); process.exit(2); }
  if (!reviewer) { console.error('visual review must name a human reviewer'); process.exit(2); }
  record({ case: caseId, gate: 'visual-review', pass: verdict === 'pass', verdict, reviewer });
  console.log(`visual ${caseId}: ${verdict} by ${reviewer}`);
}

function recordFailure(caseId, defect) {
  if (!manifest.defectTags.includes(defect)) { console.error(`unknown defect tag "${defect}" — allowed: ${manifest.defectTags.join(', ')}`); process.exit(2); }
  let repositoryCommit = 'unknown';
  try { repositoryCommit = execSync('git rev-parse HEAD', { cwd: join(here, '../..'), encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }
  const distPath = join(here, '../../packages/model/dist/index.js');
  const packageSha256 = existsSync(distPath) ? createHash('sha256').update(readFileSync(distPath)).digest('hex') : 'unbuilt';
  record({ case: caseId, gate: 'failure', defect, repositoryCommit, packageSha256 });
  console.log(`failure recorded: ${caseId}/${defect} @ ${repositoryCommit.slice(0, 7)}`);
}

function report() {
  const receipts = readReceipts().sort((a, b) => String(a.ts).localeCompare(String(b.ts))); // chronological across runners
  const c2k = (r) => `${r.case}:${r.gate}`;
  const latest = new Map(); // `${case}:${gate}` → receipt (last by ts wins)
  for (const r of receipts) if (r.case && r.gate) latest.set(c2k(r), r);
  const clusters = {};
  for (const r of receipts) if (r.gate === 'failure') clusters[r.defect] = (clusters[r.defect] ?? 0) + 1;

  let failures = 0, incomplete = 0;
  for (const c of manifest.cases) {
    const gateEntries = manifest.gates.map((g) => ({ gate: g, receipt: latest.get(`${c}:${g}`) }));
    // skipped ≠ pass, but ≠ fail either: it keeps the case incomplete (exit 2)
    const failed = gateEntries.some(({ gate, receipt }) => receipt && receipt.pass === false && !(gate === 'visual-review' && receipt.verdict === 'skipped'));
    // a recorded defect blocks eligibility until a LATER visual pass clears it
    const lastFailure = receipts.filter((r) => r.case === c && r.gate === 'failure').at(-1);
    const lastVisualPass = receipts.filter((r) => r.case === c && r.gate === 'visual-review' && r.pass === true).at(-1);
    const openDefect = !!lastFailure && (!lastVisualPass || String(lastFailure.ts) >= String(lastVisualPass.ts));
    const missingGates = gateEntries.filter(({ receipt }) => !receipt || receipt.pass !== true).map(({ gate }) => gate);
    if (failed || openDefect) { failures++; console.log(`${c}: FAIL${openDefect ? ` (open defect: ${lastFailure.defect})` : ''}`); }
    else if (missingGates.length) { incomplete++; console.log(`${c}: incomplete (missing: ${missingGates.join(', ')})`); }
    else console.log(`${c}: PASS`);
  }
  const evidenceEligible = failures === 0 && incomplete === 0;
  console.log(`evidenceEligible: ${evidenceEligible}${incomplete ? ' (full matrix incomplete)' : ''}`);
  if (Object.keys(clusters).length) console.log(`defect clusters: ${JSON.stringify(clusters)}`);
  process.exit(failures ? 1 : incomplete ? 2 : 0);
}

const cmds = { check, verify, 'record-visual': recordVisual, 'record-failure': recordFailure, report };
if (!cmd || !cmds[cmd]) { console.error('usage: harness.mjs check <case> <model> | verify <model> [case] | record-visual <case> <pass|fail|skipped> [reviewer] | record-failure <case> <defect-tag> | report'); process.exit(2); }
cmds[cmd](...rest);

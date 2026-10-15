#!/usr/bin/env node
/**
 * Archwoven Suite B — repair-rounds. Mirrors Suite A's skeleton (manifest +
 * cases + receipts + exit-code contract), adapted to measure how the
 * deterministic validator performs as a *repair signal*: does the first
 * validation name the mutated location, can a rules-only repairer fix it
 * from the diagnostic alone, how many rounds to pass.
 *
 * Every case = a deterministic JSON-pointer mutation of the golden fixture +
 * expected diagnostics (derived from real validateModel output, not aspiration)
 * + oracle JSON-pointer repairs.
 *
 * Commands: check <case> | verify | report
 * Exit codes: 0 pass · 1 failure (or tampered receipt) · 2 incomplete matrix.
 * Receipts: <results-dir>/<UTC-date>-<runner>.json pinning repositoryCommit +
 * packageSha256, self-fingerprinted — verify/report reject tampered receipts.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../..');
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
const FIXTURES = { 'valid-full-extended': join(repoRoot, 'packages/model/src/fixtures/valid-full-extended.json') };

async function loadValidator() {
  const dist = join(repoRoot, 'packages/model/dist/index.js');
  if (!existsSync(dist)) execSync('pnpm --filter @archwoven/model build', { cwd: repoRoot, stdio: 'inherit' });
  return import(pathToFileURL(dist).href);
}

const parsePtr = (ptr) => ptr.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));

/** JSON-pointer-ish ops: add (splice into arrays / set on objects), remove, replace. */
function applyOps(model, ops) {
  const m = structuredClone(model);
  for (const op of ops) {
    const segs = parsePtr(op.path);
    let cur = m;
    for (let i = 0; i < segs.length - 1; i++) cur = cur[segs[i]];
    const last = segs.at(-1);
    const idx = last === '-' ? (Array.isArray(cur) ? cur.length : last) : (Array.isArray(cur) ? Number(last) : last);
    if (Array.isArray(cur)) {
      if (op.op === 'remove') cur.splice(idx, 1);
      else if (op.op === 'add') cur.splice(idx, 0, op.value);
      else cur[idx] = op.value;
    } else {
      if (op.op === 'remove') delete cur[last];
      else cur[last] = op.value;
    }
  }
  return m;
}

/**
 * Diagnostic adapter: raw validateModel error strings → the only payload a
 * repairer ever sees: {subject, evidence, supportedFixes}. supportedFixes is
 * derived from the diagnostic text by pattern rules — never from the case file.
 */
function toDiagnostics(errors) {
  return errors.map((e) => {
    const dup = e.match(/^duplicate node id: "([^"]+)"/);
    const seq = e.match(/^view "([^"]+)" message seq must be consecutive/);
    const rev = e.match(/^parentId \d+ must equal revision - 1 \((\d+)\)/);
    const bnd = e.match(/^node in two boundaries: "([^"]+)"/);
    if (dup) return { subject: dup[1], evidence: [e], supportedFixes: ['remove-duplicate-node'] };
    if (seq) return { subject: seq[1], evidence: [e], supportedFixes: ['renumber-message-seq'] };
    if (rev) return { subject: 'parentId', evidence: [e], supportedFixes: ['reset-parent-id'] };
    if (bnd) return { subject: bnd[1], evidence: [e], supportedFixes: ['unwrap-later-boundary'] };
    return { subject: (e.match(/"([^"]+)"/) ?? [])[1] ?? '<root>', evidence: [e], supportedFixes: [] };
  });
}

/**
 * Rules-only repairer stub: consumes ONLY {subject, evidence, supportedFixes}
 * + the model. Fixes only what a mechanical rule can derive from the diagnostic
 * (drop the duplicate, renumber seqs, reset parentId, unwrap the later
 * boundary). Anything needing a human-chosen value (labels, enum kinds, edge
 * targets, restored paths) is honestly recorded as NOT repairable.
 */
function rulesOnlyRepair(model, diagnostics) {
  const m = structuredClone(model);
  const applied = [];
  for (const d of diagnostics) {
    let hit = false;
    if (d.supportedFixes.includes('remove-duplicate-node')) {
      let seen = false;
      for (let i = 0; i < m.nodes.length; i++) {
        if (m.nodes[i].id !== d.subject) continue;
        if (seen) { m.nodes.splice(i, 1); hit = true; break; }
        seen = true;
      }
    } else if (d.supportedFixes.includes('renumber-message-seq')) {
      const v = m.views.find((x) => x.id === d.subject);
      if (v?.sequence) { v.sequence.messages.forEach((msg, i) => { msg.seq = i + 1; }); hit = true; }
    } else if (d.supportedFixes.includes('reset-parent-id')) {
      m.parentId = m.revision - 1; hit = true;
    } else if (d.supportedFixes.includes('unwrap-later-boundary')) {
      const b = m.boundaries.at(-1);
      if (b && b.wraps.includes(d.subject) && b.wraps.length > 1) { b.wraps = b.wraps.filter((w) => w !== d.subject); hit = true; }
    }
    if (!hit) return { repaired: null, applied }; // one unfixable diagnostic → stub cannot pass
    applied.push(d.supportedFixes[0]);
  }
  return { repaired: m, applied };
}

function runCase(c, { validateModel, SystemModelSchema }) {
  const base = JSON.parse(readFileSync(FIXTURES[c.base], 'utf8'));
  const mutated = applyOps(base, c.mutation.ops);
  const r1 = validateModel(mutated);
  const detected = !r1.ok;
  // expected diagnostics must match reality exactly: every expected substring
  // hits a real error AND no unexpected errors appear (drift fails the case).
  const expectedMatch = detected
    && r1.errors.length === c.expectedDiagnostics.length
    && c.expectedDiagnostics.every((d) => r1.errors.some((e) => e.includes(d.contains)));
  const firstDisclosure = detected && c.mutation.subjects.some((s) => r1.errors[0].includes(s));
  const stage = SystemModelSchema.safeParse(mutated).success ? 'graph' : 'schema';
  // rounds: 1 = detection. 2 = rules-only stub attempt from diagnostics alone.
  // 3 = oracle repair (ground truth the stub did not have). null = never passed.
  let roundsToPass = null, stubRepaired = false;
  if (detected) {
    const stub = rulesOnlyRepair(mutated, toDiagnostics(r1.errors));
    if (stub.repaired && validateModel(stub.repaired).ok) { stubRepaired = true; roundsToPass = 2; }
    else if (validateModel(applyOps(mutated, c.oracleRepairs)).ok) roundsToPass = 3;
  }
  const pass = detected && expectedMatch && roundsToPass !== null;
  return { case: c.id, class: c.class, detected, expectedMatch, firstDisclosure, stage, stubRepaired, roundsToPass, pass, diagnostics: r1.errors ?? [] };
}

const readCase = (arg) => {
  if (!arg) { console.error('usage: harness.mjs check <case>'); process.exit(2); }
  return JSON.parse(readFileSync(p(arg), 'utf8'));
};

async function check(caseArg) {
  const c = readCase(caseArg);
  const res = runCase(c, await loadValidator());
  console.log(JSON.stringify(res, null, 2));
  if (!res.pass) {
    if (!res.detected) console.error(`check ${c.id}: mutation NOT detected`);
    else if (!res.expectedMatch) console.error(`check ${c.id}: diagnostics drift from expected`);
    else if (res.roundsToPass === null) console.error(`check ${c.id}: oracle repair did NOT restore validity`);
    process.exit(1);
  }
  console.log(`check ${c.id}: OK (rounds-to-pass ${res.roundsToPass}, first-disclosure ${res.firstDisclosure})`);
}

const fingerprint = (obj) => createHash('sha256').update(JSON.stringify(obj)).digest('hex');

function checkReceiptIntegrity() {
  if (!existsSync(resultsDir)) return [];
  const tampered = [];
  for (const f of readdirSync(resultsDir).filter((f) => f.endsWith('.json'))) {
    const doc = JSON.parse(readFileSync(join(resultsDir, f), 'utf8'));
    const { fingerprint: fp, ...rest } = doc;
    if (fp !== fingerprint(rest)) tampered.push(f);
  }
  return tampered;
}

async function verify() {
  const tampered = checkReceiptIntegrity();
  if (tampered.length) { console.error(`verify: TAMPERED receipts, evidence untrusted: ${tampered.join(', ')}`); process.exit(1); }
  const v = await loadValidator();
  const results = manifest.cases.map((name) => runCase(readCase(join(here, 'cases', `${name}.case.json`)), v));
  let repositoryCommit = 'unknown';
  try { repositoryCommit = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }
  const dist = join(repoRoot, 'packages/model/dist/index.js');
  const packageSha256 = existsSync(dist) ? createHash('sha256').update(readFileSync(dist)).digest('hex') : 'unbuilt';
  const doc = { kind: 'repair-rounds-receipts', suite: manifest.suite, ts: new Date().toISOString(), runner, repositoryCommit, packageSha256, results };
  doc.fingerprint = fingerprint(doc);
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  const file = join(resultsDir, `${doc.ts.slice(0, 10)}-${runner}.json`);
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  const failed = results.filter((r) => !r.pass);
  console.log(`verify: ${results.length - failed.length}/${results.length} cases pass → ${file}`);
  for (const f of failed) console.error(`FAIL ${f.case}`);
  process.exit(failed.length ? 1 : 0);
}

function report() {
  if (!existsSync(resultsDir) || readdirSync(resultsDir).filter((f) => f.endsWith('.json')).length === 0) {
    console.log('report: no receipts — matrix incomplete (run verify)');
    process.exit(2);
  }
  const tampered = checkReceiptIntegrity();
  if (tampered.length) { console.error(`report: TAMPERED receipts, evidence untrusted: ${tampered.join(', ')}`); process.exit(1); }
  const docs = readdirSync(resultsDir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(resultsDir, f), 'utf8')))
    .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const latest = new Map(); // last receipt per case wins
  for (const doc of docs) for (const r of doc.results ?? []) latest.set(r.case, { ...r, ts: doc.ts, repositoryCommit: doc.repositoryCommit });

  let fails = 0;
  for (const name of manifest.cases) {
    const r = latest.get(name);
    if (!r) continue; // reported as missing below
    if (!r.pass) fails++;
    console.log(`${name}: ${r.pass ? 'pass' : 'FAIL'} (rounds ${r.roundsToPass}, first-disclosure ${r.firstDisclosure}, stage ${r.stage}, stub ${r.stubRepaired ? 'fixed' : 'cannot'})`);
  }
  const covered = [...latest.values()];
  const pct = (n) => (covered.length ? `${Math.round((n / covered.length) * 100)}%` : 'n/a');
  const fd = covered.filter((r) => r.firstDisclosure).length;
  const act = covered.filter((r) => r.stubRepaired).length;
  const stages = covered.reduce((a, r) => ({ ...a, [r.stage]: (a[r.stage] ?? 0) + 1 }), {});
  console.log(`rounds-to-pass: ${covered.map((r) => r.roundsToPass ?? 'never').join(', ')}`);
  console.log(`first-disclosure-rate: ${fd}/${covered.length} (${pct(fd)})`);
  console.log(`first-detection-stage: ${JSON.stringify(stages)}`);
  console.log(`actionability (rules-only stub): ${act}/${covered.length} (${pct(act)})`);
  const missing = manifest.cases.filter((c) => !latest.has(c));
  if (fails) { console.log(`evidenceEligible: false (${fails} failed)`); process.exit(1); }
  if (missing.length) { console.log(`evidenceEligible: false (missing: ${missing.join(', ')})`); process.exit(2); }
  console.log('evidenceEligible: true (deterministic validator round-trips only — see README limits)');
  process.exit(0);
}

const cmds = { check, verify, report };
if (!cmd || !cmds[cmd]) { console.error('usage: harness.mjs check <case> | verify | report'); process.exit(2); }
cmds[cmd](...rest);

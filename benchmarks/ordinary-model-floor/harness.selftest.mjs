#!/usr/bin/env node
/**
 * Selftest for the ordinary-model-floor harness — CI-runnable with plain node.
 * Asserts gate exit codes: check 0/1, verify 0/1, report 0/1/2.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const H = join(here, 'harness.mjs');
let pass = 0;
const expect = (name, got, want) => {
  if (got === want) { pass++; console.log(`ok  ${name}`); }
  else { console.error(`FAIL ${name}: exit ${got}, want ${want}`); process.exitCode = 1; }
};
const inDir = (dir) => (...args) => spawnSync('node', [H, ...args, '--results-dir', dir], { encoding: 'utf8', cwd: here });

const CASES = ['todo-api', 'checkout', 'boring-crud'];

const d1 = mkdtempSync(join(tmpdir(), 'aw-bench-pass-'));
const r1 = inDir(d1);
expect('check good → 0', r1('check', 'cases/todo-api.case.json', 'fixtures/good.model.json').status, 0);
expect('check missing-edge → 1', r1('check', 'cases/todo-api.case.json', 'fixtures/missing-edge.model.json').status, 1);
expect('verify good → 0', r1('verify', 'fixtures/good.model.json').status, 0);
expect('verify bad-checks → 1', r1('verify', 'fixtures/bad-checks.model.json').status, 1);
for (const c of CASES) {
  r1('check', `cases/${c}.case.json`, 'fixtures/good.model.json');
  r1('verify', 'fixtures/good.model.json', c);
  expect(`record-visual ${c}`, r1('record-visual', c, 'pass', 'selftest').status, 0);
}
expect('report complete-pass → 0', r1('report').status, 0);
expect('report skipped-visual ≠ pass', (() => { const r = inDir(d1)('record-visual', 'todo-api', 'skipped', 'selftest'); return r.status; })(), 0);
expect('report after skipped-visual → 2', r1('report').status, 2);
rmSync(d1, { recursive: true, force: true });

const d2 = mkdtempSync(join(tmpdir(), 'aw-bench-partial-'));
const r2 = inDir(d2);
r2('check', 'cases/todo-api.case.json', 'fixtures/good.model.json');
expect('report partial → 2', r2('report').status, 2);
rmSync(d2, { recursive: true, force: true });

const d3 = mkdtempSync(join(tmpdir(), 'aw-bench-fail-'));
const r3 = inDir(d3);
r3('check', 'cases/checkout.case.json', 'fixtures/missing-edge.model.json');
expect('report any-failure → 1', r3('report').status, 1);
r3('record-failure', 'checkout', 'node-overlap');
expect('record-failure + report still 1', r3('report').status, 1);
rmSync(d3, { recursive: true, force: true });


// evidence-integrity: named reviewer required; recorded failure blocks eligibility
const d4 = mkdtempSync(join(tmpdir(), 'aw-bench-integ-'));
const r4 = inDir(d4);
expect('record-visual without reviewer → 2', r4('record-visual', 'todo-api', 'pass').status, 2);
for (const c of CASES) {
  r4('check', `cases/${c}.case.json`, 'fixtures/good.model.json');
  r4('verify', 'fixtures/good.model.json', c);
  r4('record-visual', c, 'pass', 'selftest');
}
expect('all gates pass → 0', r4('report').status, 0);
r4('record-failure', 'todo-api', 'label-overlap');
expect('recorded failure blocks eligibility → 1', r4('report').status, 1);
r4('record-visual', 'todo-api', 'pass', 'selftest-round2');
expect('re-review after failure clears block → 0', r4('report').status, 0);
expect('missing-gate diagnostic names right gates', (() => { const d5 = mkdtempSync(join(tmpdir(), 'aw-bench-names-')); const out = inDir(d5)('report').stdout; rmSync(d5, { recursive: true, force: true }); return out.includes('missing: semantic, validate, visual-review') ? 0 : 1; })(), 0);
rmSync(d4, { recursive: true, force: true });

console.log(`selftest: ${pass} checks, exit ${process.exitCode ?? 0}`);
process.exit(process.exitCode ?? 0);

#!/usr/bin/env node
/**
 * Selftest for the ordinary-model-floor harness — CI-runnable with plain node.
 * Asserts gate exit codes: check 0/1, verify 0/1, report 0/1/2.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableValidator } from '../stable-validator.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const H = join(here, 'harness.mjs');
let pass = 0;
let lastRun;
const expect = (name, got, want) => {
  if (got === want) { pass++; console.log(`ok  ${name}`); }
  else {
    console.error(`FAIL ${name}: exit ${got}, want ${want}`);
    if (lastRun?.stderr) console.error(`  stderr: ${lastRun.stderr.trim().split('\n').slice(0, 6).join('\n  ')}`);
    process.exitCode = 1;
  }
};
const validator = await stableValidator();
const inDir = (dir) => (...args) => (lastRun = spawnSync('node', [H, ...args, '--results-dir', dir, '--validator', validator], { encoding: 'utf8', cwd: here }));

const CASES = ['todo-api', 'checkout', 'boring-crud'];

const d1 = mkdtempSync(join(tmpdir(), 'aw-bench-pass-'));
const r1 = inDir(d1);
expect('check good → 0', r1('check', 'cases/todo-api.case.json', 'fixtures/good.model.json').status, 0);
expect('check missing-edge → 1', r1('check', 'cases/todo-api.case.json', 'fixtures/missing-edge.model.json').status, 1);
// Real post-merge provider outputs: naming variants of required nodes bind; near misses do not.
expect('check real todo-api ("Orders Service") → 0', r1('check', 'cases/todo-api.case.json', 'fixtures/postmerge-todo-api.model.json').status, 0);
expect('check real boring-crud ("Catalog DB (PostgreSQL)") → 0', r1('check', 'cases/boring-crud.case.json', 'fixtures/postmerge-boring-crud.model.json').status, 0);
expect('check real checkout → 0', r1('check', 'cases/checkout.case.json', 'fixtures/postmerge-checkout.model.json').status, 0);
expect('check near-miss ("PostgreSQL Replica" is not "PostgreSQL") → 1', r1('check', 'cases/todo-api.case.json', 'fixtures/near-miss.model.json').status, 1);
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

// Oracle strictness: whole names only, and one node cannot satisfy two requirements.
const d5 = mkdtempSync(join(tmpdir(), 'aw-bench-oracle-'));
const r5 = inDir(d5);
const node = (id, kind, label) => ({ id, kind, label, provenance: 'proposed', evidence: [] });
const write = (name, value) => { const f = join(d5, name); writeFileSync(f, JSON.stringify(value)); return f; };
const twoReqs = write('two.case.json', { id: 'two', requirements: { nodes: [{ key: 'a', labels: ['API'], type: 'gateway' }, { key: 'b', labels: ['API Gateway', 'API'], type: 'gateway' }], relationships: [] } });
expect('check one node for two requirements → 1', r5('check', twoReqs, write('one-gateway.model.json', { nodes: [node('g', 'gateway', 'API')], edges: [] })).status, 1);
const userReq = write('user.case.json', { id: 'user', requirements: { nodes: [{ key: 'u', labels: ['User'], type: 'service' }], relationships: [] } });
expect('check "User Service" for "User" → 1', r5('check', userReq, write('user-service.model.json', { nodes: [node('s', 'service', 'User Service')], edges: [] })).status, 1);
expect('check "Users" for "User" → 0', r5('check', userReq, write('users.model.json', { nodes: [node('s', 'service', 'Users')], edges: [] })).status, 0);
rmSync(d5, { recursive: true, force: true });

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

rmSync(dirname(validator), { recursive: true, force: true });
console.log(`selftest: ${pass} checks, exit ${process.exitCode ?? 0}`);
process.exit(process.exitCode ?? 0);

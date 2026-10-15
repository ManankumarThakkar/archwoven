#!/usr/bin/env node
/**
 * Selftest for the repair-rounds harness — CI-runnable with plain node.
 * Asserts gate exit codes: check 0/1/2, verify 0/1 (tampered receipts → 1),
 * report 0/1/2. Mirrors Suite A's selftest style.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const CASES = ['dangling-edge-ref', 'duplicate-node-id', 'missing-required-label', 'invalid-enum-kind', 'revision-mismatch', 'required-path-broken', 'boundary-overlap', 'seq-gap'];

// full happy path: every mutation detected + oracle-repaired, receipts pinned
const d1 = mkdtempSync(join(tmpdir(), 'aw-rr-pass-'));
const r1 = inDir(d1);
for (const c of CASES) expect(`check ${c} → 0`, r1('check', `cases/${c}.case.json`).status, 0);
expect('verify → 0', r1('verify').status, 0);
expect('report complete → 0', r1('report').status, 0);
expect('report names metrics', r1('report').stdout.includes('first-disclosure-rate') && r1('report').stdout.includes('actionability') ? 0 : 1, 0);
const recFile = join(d1, readdirSync(d1)[0]);
const rec = JSON.parse(readFileSync(recFile, 'utf8'));
expect('receipt pins repositoryCommit + packageSha256', typeof rec.repositoryCommit === 'string' && rec.repositoryCommit.length > 0 && typeof rec.packageSha256 === 'string' && rec.packageSha256.length > 0 ? 0 : 1, 0);
expect('receipt covers all 8 cases', rec.results.length === 8 ? 0 : 1, 0);
// tamper: flip one result without re-fingerprinting → both gates reject
rec.results[0].pass = !rec.results[0].pass;
writeFileSync(recFile, JSON.stringify(rec, null, 2) + '\n');
expect('verify tampered receipt → 1', r1('verify').status, 1);
expect('report tampered receipt → 1', r1('report').status, 1);
rmSync(d1, { recursive: true, force: true });

// negative cases: wrong expectation, undetected mutation, usage, empty matrix
// (case files live OUTSIDE the results dir — report treats stray *.json there as receipts)
const d2 = mkdtempSync(join(tmpdir(), 'aw-rr-neg-'));
const dc = mkdtempSync(join(tmpdir(), 'aw-rr-negcases-'));
const r2 = inDir(d2);
const tmpl = JSON.parse(readFileSync(join(here, 'cases', 'dangling-edge-ref.case.json'), 'utf8'));
const wrong = structuredClone(tmpl);
wrong.expectedDiagnostics = [{ code: 'bogus', contains: 'this text never appears' }];
const wrongPath = join(dc, 'wrong.case.json');
writeFileSync(wrongPath, JSON.stringify(wrong));
expect('check wrong-expected-diagnostic → 1', r2('check', wrongPath).status, 1);
const noop = structuredClone(tmpl);
noop.mutation.ops = [{ op: 'replace', path: '/edges/4/to', value: 'datastore.postgres' }]; // same value — nothing breaks
noop.expectedDiagnostics = [];
const noopPath = join(dc, 'noop.case.json');
writeFileSync(noopPath, JSON.stringify(noop));
expect('check undetected (no-op) mutation → 1', r2('check', noopPath).status, 1);
expect('check missing arg → 2', r2('check').status, 2);
expect('unknown command → 2', r2('bogus').status, 2);
expect('report no receipts → 2', r2('report').status, 2);
rmSync(d2, { recursive: true, force: true });
rmSync(dc, { recursive: true, force: true });

// partial matrix: receipts exist but miss cases → incomplete, not pass
const d3 = mkdtempSync(join(tmpdir(), 'aw-rr-partial-'));
const r3 = inDir(d3);
const partial = { kind: 'repair-rounds-receipts', suite: 'repair-rounds', ts: '2026-10-15T00:00:00.000Z', runner: 'selftest', repositoryCommit: 'x'.repeat(40), packageSha256: 'y'.repeat(64), results: [{ case: 'seq-gap', class: 'sequence-integrity', detected: true, expectedMatch: true, firstDisclosure: true, stage: 'graph', stubRepaired: true, roundsToPass: 2, pass: true, diagnostics: [] }] };
const { createHash } = await import('node:crypto');
partial.fingerprint = createHash('sha256').update(JSON.stringify(partial)).digest('hex');
writeFileSync(join(d3, '2026-10-15-selftest.json'), JSON.stringify(partial, null, 2) + '\n');
expect('report partial matrix → 2', r3('report').status, 2);
rmSync(d3, { recursive: true, force: true });

console.log(`selftest: ${pass} checks, exit ${process.exitCode ?? 0}`);
process.exit(process.exitCode ?? 0);

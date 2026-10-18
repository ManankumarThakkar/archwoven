import { afterEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeEvaluationBudget, openEvaluationBudget } from '../../packages/jobs/src/evaluation-budget.ts';

const cli = new URL('./budget.mjs', import.meta.url).pathname;
const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

it('lists unknown usage and leaves resolving to a person at a terminal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aw-budget-cli-')); dirs.push(dir);
  const file = join(dir, 'budget.db'); initializeEvaluationBudget(file, 1000);
  const ledger = openEvaluationBudget(file); const id = ledger.reserve(600, { model: 'claude-sonnet-5-5', basis: 'test' }); ledger.settle(id, null); ledger.close();
  expect(JSON.parse(run('unknown', file).stdout)).toEqual([{ id, model: 'claude-sonnet-5-5', basis: 'test', heldUsd: 0.0000006 }]);
  expect(run('resolve', file, id, '0').stderr).toMatch(/Usage:/);
  const refused = run('resolve', file, id, '0.00', '--evidence', 'Console shows no usage');
  expect(refused.status).not.toBe(0);
  expect(refused.stderr).toMatch(/interactive terminal/);
  expect(JSON.parse(run('unknown', file).stdout)).toHaveLength(1);
});

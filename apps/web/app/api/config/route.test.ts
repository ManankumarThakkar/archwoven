import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluationLedgerId, initializeEvaluationBudget } from '@archwoven/jobs';
import { HOSTED_REQUESTS } from '@archwoven/model';
import { GET } from './route';

const directories: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it('reports the actual evaluation cap without exposing its path or credentials', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aw-budget-config-')); directories.push(directory);
  const file = join(directory, 'private-budget.db'); initializeEvaluationBudget(file, 1000);
  vi.stubEnv('ARCHWOVEN_EVAL_BUDGET_DB', file); vi.stubEnv('ARCHWOVEN_MODE', 'hosted'); vi.stubEnv('ARCHWOVEN_FAKE', '0');
  vi.stubEnv('ANTHROPIC_API_KEY', 'private-value-not-for-response');
  const response = GET(); const body = await response.json();
  expect(body).toMatchObject({ evaluationBudgetEnabled: true, evaluationBudgetCapNanos: 1000 });
  expect(JSON.stringify(body)).not.toContain(file);
  expect(JSON.stringify(body)).not.toContain('private-value-not-for-response');
  expect(response.headers.get('cache-control')).toContain('no-store');
});
it('never advertises a cap if the configured ledger is missing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aw-budget-config-')); directories.push(directory);
  vi.stubEnv('ARCHWOVEN_EVAL_BUDGET_DB', join(directory, 'absent.db'));
  expect(() => GET()).toThrow(/initialized/);
});
it('states the evaluation ledger, prompt version and request shapes only when evaluating', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aw-budget-config-')); directories.push(directory);
  const file = join(directory, 'budget.db'); initializeEvaluationBudget(file, 1000);
  vi.stubEnv('ARCHWOVEN_MODE', 'hosted'); vi.stubEnv('ARCHWOVEN_FAKE', '0'); vi.stubEnv('ARCHWOVEN_HOSTED_MODEL', 'claude-haiku-5-5');
  expect((await GET().json()).evaluation).toBeUndefined();
  vi.stubEnv('ARCHWOVEN_EVAL_BUDGET_DB', file);
  const body = await GET().json();
  expect(body.hostedModel).toBe('claude-haiku-5-5');
  expect(body.evaluation).toEqual({ ledger: evaluationLedgerId(file), promptVersion: expect.stringMatching(/^p-[0-9a-f]{12}$/), requests: HOSTED_REQUESTS });
});

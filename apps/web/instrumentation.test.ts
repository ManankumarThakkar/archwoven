import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeEvaluationBudget } from '@archwoven/jobs';

const sweeper = vi.hoisted(() => ({ start: vi.fn(() => () => {}) }));
vi.mock('./lib/retention', () => ({ startRetentionSweeper: sweeper.start }));

afterEach(() => { vi.unstubAllEnvs(); sweeper.start.mockClear(); });

describe('boot hook retention', () => {
  const boot = async (mode: string | undefined) => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('ARCHWOVEN_DB', join(mkdtempSync(join(tmpdir(), 'aw-boot-')), 'db.sqlite'));
    if (mode) vi.stubEnv('ARCHWOVEN_MODE', mode); else vi.stubEnv('ARCHWOVEN_MODE', '');
    vi.stubEnv('ARCHWOVEN_FAKE', '1');
    const { register } = await import('./instrumentation');
    await register();
  };

  it('starts the nightly retention sweep on hosted deployments', async () => {
    await boot(undefined);
    expect(sweeper.start).toHaveBeenCalledOnce();
  });

  it('never expires diagrams on local deployments', async () => {
    await boot('local');
    expect(sweeper.start).not.toHaveBeenCalled();
  });

  it('does not create SQLite or start retention in isolated preview diagnostics', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('ARCHWOVEN_MODE', 'hosted');
    vi.stubEnv('ARCHWOVEN_FAKE', '0');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('ARCHWOVEN_HOSTING_PROBE', '1');
    vi.stubEnv('ARCHWOVEN_HOSTING_PROBE_TOKEN', 'x'.repeat(48));
    const database = join(mkdtempSync(join(tmpdir(), 'aw-probe-')), 'absent', 'db.sqlite');
    vi.stubEnv('ARCHWOVEN_DB', database);
    const { register } = await import('./instrumentation');
    await register();
    expect(existsSync(database)).toBe(false);
    expect(sweeper.start).not.toHaveBeenCalled();
  });
  it('fails boot before creating application storage if the evaluation ledger is missing', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aw-eval-boot-'));
    vi.stubEnv('NEXT_RUNTIME', 'nodejs'); vi.stubEnv('ARCHWOVEN_MODE', 'hosted'); vi.stubEnv('ARCHWOVEN_FAKE', '0');
    vi.stubEnv('ARCHWOVEN_EVAL_BUDGET_DB', join(directory, 'missing.db'));
    vi.stubEnv('ARCHWOVEN_DB', join(directory, 'app.db'));
    const { register } = await import('./instrumentation');
    await expect(register()).rejects.toThrow(/initialized/);
    expect(existsSync(join(directory, 'app.db'))).toBe(false);
  });
  it('checks the existing evaluation ledger without resetting its cap', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aw-eval-boot-'));
    const file = join(directory, 'budget.db'); initializeEvaluationBudget(file, 100);
    vi.stubEnv('NEXT_RUNTIME', 'nodejs'); vi.stubEnv('ARCHWOVEN_MODE', 'hosted'); vi.stubEnv('ARCHWOVEN_FAKE', '0');
    vi.stubEnv('ARCHWOVEN_EVAL_BUDGET_DB', file); vi.stubEnv('ARCHWOVEN_DB', join(directory, 'app.db'));
    const { register } = await import('./instrumentation');
    await expect(register()).resolves.toBeUndefined();
  });
});

describe('boot hook on Vercel', () => {
  const vercel = (database: string) => {
    for (const [key, value] of Object.entries({ NEXT_RUNTIME: 'nodejs', ARCHWOVEN_MODE: 'hosted', ARCHWOVEN_FAKE: '0', VERCEL: '1', VERCEL_ENV: 'preview', ARCHWOVEN_DB: database })) vi.stubEnv(key, value);
  };

  it('boots a hosted deployment without creating SQLite or starting the retention sweep', async () => {
    const database = join(mkdtempSync(join(tmpdir(), 'aw-vercel-')), 'absent', 'db.sqlite');
    vercel(database);
    for (const [key, value] of Object.entries({ UPSTASH_REDIS_REST_URL: 'https://example-test.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'test-token-not-a-credential', ARCHWOVEN_REDIS_PREFIX: 'archwoven-preview:', ARCHWOVEN_SESSION_SECRET: 's'.repeat(40) })) vi.stubEnv(key, value);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { register } = await import('./instrumentation');
    await register();
    expect(existsSync(database)).toBe(false);
    expect(sweeper.start).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('reports missing hosted job storage at boot, naming the variables but never their values', async () => {
    const database = join(mkdtempSync(join(tmpdir(), 'aw-vercel-')), 'absent', 'db.sqlite');
    vercel(database);
    for (const [key, value] of Object.entries({ UPSTASH_REDIS_REST_URL: 'https://example-test.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'secret-token-value', ARCHWOVEN_REDIS_PREFIX: '', ARCHWOVEN_SESSION_SECRET: '' })) vi.stubEnv(key, value);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { register } = await import('./instrumentation');
    await register();
    const logged = errors.mock.calls.flat().join('\n');
    expect(logged).toMatch(/UPSTASH_REDIS_REST_URL.*ARCHWOVEN_SESSION_SECRET/s);
    expect(logged).not.toContain('secret-token-value');
    expect(existsSync(database)).toBe(false);
    errors.mockRestore();
  });
});

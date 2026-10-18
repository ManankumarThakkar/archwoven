import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
});

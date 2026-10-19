import { afterEach, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

afterEach(() => vi.unstubAllEnvs());

it('does not open SQLite when Next preloads application routes in diagnostic mode', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aw-probe-import-'));
  const database = join(directory, 'must-not-exist', 'data.db');
  vi.stubEnv('ARCHWOVEN_HOSTING_PROBE', '1');
  vi.stubEnv('ARCHWOVEN_DB', database);
  try {
    const { serverDeps } = await import('./server');
    expect(existsSync(database)).toBe(false);
    expect(() => serverDeps.store).toThrow(/diagnostic/i);
    expect(existsSync(database)).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it('never opens SQLite on Vercel, where the hosted application keeps no local database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aw-vercel-import-'));
  const database = join(directory, 'must-not-exist', 'data.db');
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('ARCHWOVEN_DB', database);
  try {
    const { serverDeps } = await import('./server');
    expect(() => serverDeps.store).toThrow(/no local database on Vercel/i);
    expect(existsSync(database)).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

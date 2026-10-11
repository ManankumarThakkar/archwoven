import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deployMode, privacyForMode } from './mode';

describe('deployMode', () => {
  const saved = process.env.ARCHWOVEN_MODE;
  afterEach(() => {
    if (saved === undefined) delete process.env.ARCHWOVEN_MODE;
    else process.env.ARCHWOVEN_MODE = saved;
  });

  it('is "local" when ARCHWOVEN_MODE=local', () => {
    process.env.ARCHWOVEN_MODE = 'local';
    expect(deployMode()).toBe('local');
  });

  it('is "hosted" otherwise', () => {
    delete process.env.ARCHWOVEN_MODE;
    expect(deployMode()).toBe('hosted');
    process.env.ARCHWOVEN_MODE = 'anything-else';
    expect(deployMode()).toBe('hosted');
  });
});

describe('privacyForMode', () => {
  it('local → private · local-only', () => {
    expect(privacyForMode('local')).toEqual({ classification: 'private', boundary: 'local-only' });
  });

  it('hosted → public · external-allowed', () => {
    expect(privacyForMode('hosted')).toEqual({ classification: 'public', boundary: 'external-allowed' });
  });
});

describe('GET /api/config', () => {
  const saved = process.env.ARCHWOVEN_MODE;
  afterEach(() => {
    if (saved === undefined) delete process.env.ARCHWOVEN_MODE;
    else process.env.ARCHWOVEN_MODE = saved;
  });

  it('reports the deploy mode without touching session or secrets', async () => {
    process.env.ARCHWOVEN_MODE = 'local';
    const { GET } = await import('../api/config/route');
    const body = (await (GET()).json()) as { mode: string; fake: boolean };
    expect(body.mode).toBe('local');
    expect(typeof body.fake).toBe('boolean');
  });
});

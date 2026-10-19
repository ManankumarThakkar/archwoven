import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertSafeRuntime, deployMode, privacyForMode } from './mode';

describe('hosted model configuration', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('rejects unsupported hosted configuration at startup', () => {
    vi.stubEnv('ARCHWOVEN_MODE', 'hosted');
    vi.stubEnv('ARCHWOVEN_FAKE', '0');
    vi.stubEnv('ARCHWOVEN_HOSTED_MODEL', 'unknown');
    expect(() => assertSafeRuntime()).toThrow(/Unsupported ARCHWOVEN_HOSTED_MODEL/);
  });
  it('ignores hosted selection in local mode', () => {
    vi.stubEnv('ARCHWOVEN_MODE', 'local');
    vi.stubEnv('ARCHWOVEN_HOSTED_MODEL', 'unknown');
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => assertSafeRuntime()).not.toThrow();
  });
  it('reports the selected hosted model without exposing configuration secrets', async () => {
    vi.stubEnv('ARCHWOVEN_MODE', 'hosted');
    vi.stubEnv('ARCHWOVEN_FAKE', '0');
    vi.stubEnv('ARCHWOVEN_HOSTED_MODEL', 'claude-sonnet-5-5');
    vi.stubEnv('ANTHROPIC_API_KEY', 'do-not-expose-this-value');
    const { GET } = await import('../api/config/route');
    const body = await GET().json();
    expect(body).toMatchObject({ hostedModel: 'claude-sonnet-5-5', llmReady: true });
    expect(JSON.stringify(body)).not.toContain('do-not-expose-this-value');
  });
});

describe('evaluation configuration stays local and explicit', () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each([{ VERCEL: '1' }, { ARCHWOVEN_MODE: 'local' }, { ARCHWOVEN_FAKE: '1' }, { ARCHWOVEN_EVAL_BUDGET_DB: '' }])('rejects an unsafe evaluation environment %j', patch => {
    vi.stubEnv('ARCHWOVEN_MODE', 'hosted'); vi.stubEnv('ARCHWOVEN_FAKE', '0'); vi.stubEnv('VERCEL', '');
    vi.stubEnv('ARCHWOVEN_EVAL_BUDGET_DB', '/tmp/evaluation-budget.db');
    for (const [key, value] of Object.entries(patch)) vi.stubEnv(key, value);
    expect(() => assertSafeRuntime()).toThrow(/evaluation/i);
  });
});

describe('local mode stays off Vercel', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('refuses local mode on Vercel even as an acknowledged demo: it needs a local database Vercel does not keep', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('ARCHWOVEN_MODE', 'local');
    vi.stubEnv('ARCHWOVEN_DEMO_ACK', '1');
    expect(() => assertSafeRuntime()).toThrow(/ARCHWOVEN_MODE=local.*Vercel/);
  });
});

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

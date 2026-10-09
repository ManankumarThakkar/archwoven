import { afterEach, describe, expect, it } from 'vitest';
import { assertSafeRuntime } from './server';

const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]!; }
  try { fn(); } finally {
    for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]!; }
  }
};

describe('assertSafeRuntime (§15 fake/local mode never ships to production)', () => {
  afterEach(() => { delete process.env.ARCHWOVEN_FAKE; delete process.env.ARCHWOVEN_MODE; delete process.env.ARCHWOVEN_DEMO_ACK; });

  it('refuses to boot production with fake model data and no explicit ack', () => {
    withEnv({ NODE_ENV: 'production', ARCHWOVEN_FAKE: '1', ARCHWOVEN_DEMO_ACK: undefined }, () => {
      expect(() => assertSafeRuntime()).toThrow(/fake/i);
    });
  });

  it('refuses production local-mode (quotas compiled out) without ack', () => {
    withEnv({ NODE_ENV: 'production', ARCHWOVEN_MODE: 'local', ARCHWOVEN_DEMO_ACK: undefined }, () => {
      expect(() => assertSafeRuntime()).toThrow(/local/i);
    });
  });

  it('allows production fake with an explicit demo ack', () => {
    withEnv({ NODE_ENV: 'production', ARCHWOVEN_FAKE: '1', ARCHWOVEN_DEMO_ACK: '1' }, () => {
      expect(() => assertSafeRuntime()).not.toThrow();
    });
  });

  it('development runs freely with fake mode', () => {
    withEnv({ NODE_ENV: 'development', ARCHWOVEN_FAKE: '1' }, () => {
      expect(() => assertSafeRuntime()).not.toThrow();
    });
  });
});

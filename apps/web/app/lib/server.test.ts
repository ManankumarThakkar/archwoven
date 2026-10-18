import { afterEach, describe, expect, it, vi } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { assertSafeRuntime } from './mode';

const enc = new TextEncoder();
const ollamaOk = (payload: unknown): Response => {
  const lines = [JSON.stringify({ message: { content: JSON.stringify(payload) } }), JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 100, eval_count: 50 })];
  return new Response(new ReadableStream<Uint8Array>({ start(c) { for (const l of lines) c.enqueue(enc.encode(`${l}\n`)); c.close(); } }), { headers: { 'content-type': 'application/x-ndjson' } });
};

/** Fresh server module with env pinned — routing is decided at wiring time. */
async function freshServer(env: Record<string, string>) {
  vi.resetModules();
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) { prev[k] = process.env[k]; process.env[k] = v; }
  try {
    return { serverDeps: (await import('./server')).serverDeps, prev };
  } catch (e) {
    for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]!; }
    throw e;
  }
}
const restore = (prev: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.resetModules();
};

const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]!; }
  try { fn(); } finally {
    for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]!; }
  }
};

describe('assertSafeRuntime (fake/local mode never ships to production)', () => {
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

describe('serverDeps local routing', () => {
  it('local mode: generate hits ollama behind the guard, never anthropic', async () => {
    const urls: string[] = [];
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => { urls.push(String(input)); return ollamaOk(validFullModel); }) as unknown as typeof fetch;
    const { serverDeps, prev } = await freshServer({ ARCHWOVEN_MODE: 'local', ARCHWOVEN_DB: ':memory:', ARCHWOVEN_FAKE: '' });
    try {
      const out = await serverDeps.generateModel('shop', 'architecture');
      expect(out.ok, JSON.stringify(out.ok ? '' : out.errors)).toBe(true);
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every((u) => u.includes('localhost:11434'))).toBe(true);
      expect(urls.some((u) => u.includes('anthropic'))).toBe(false);
    } finally { globalThis.fetch = prevFetch; restore(prev); }
  });

  it('local mode: refinement + repo assembly also stay on ollama', async () => {
    const urls: string[] = [];
    const prevFetch = globalThis.fetch;
    const ops = [{ op: 'add', target: 'svc.cache', patch: { id: 'svc.cache', kind: 'service', label: 'Cache', provenance: 'proposed' }, baseRevision: validFullModel.revision, summary: '+Cache' }];
    globalThis.fetch = (async (input: unknown) => { urls.push(String(input)); return ollamaOk(ops); }) as unknown as typeof fetch;
    const { serverDeps, prev } = await freshServer({ ARCHWOVEN_MODE: 'local', ARCHWOVEN_DB: ':memory:', ARCHWOVEN_FAKE: '' });
    try {
      const out = await serverDeps.generateRefinement('add cache', validFullModel, 'architecture');
      expect(out.ok, JSON.stringify(out.ok ? '' : out.errors)).toBe(true);
      expect(urls.every((u) => u.includes('localhost:11434'))).toBe(true);
    } finally { globalThis.fetch = prevFetch; restore(prev); }
  });

  it('fake mode wins over local routing: canned model, zero network', async () => {
    let calls = 0;
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () => { calls++; return new Response('{}'); }) as unknown as typeof fetch;
    const { serverDeps, prev } = await freshServer({ ARCHWOVEN_MODE: 'local', ARCHWOVEN_DB: ':memory:', ARCHWOVEN_FAKE: '1' });
    try {
      const out = await serverDeps.generateModel('shop', 'architecture');
      expect(out.ok).toBe(true);
      expect(calls).toBe(0);
    } finally { globalThis.fetch = prevFetch; restore(prev); }
  });
});

describe('session cookie transport', () => {
  it('is Secure on a hosted production deployment and stays usable over http locally and in development', async () => {
    const { sessionCookie } = await import('./server');
    const env = { mode: process.env.ARCHWOVEN_MODE, node: process.env.NODE_ENV };
    const set = (mode: string | undefined, node: string) => { if (mode) process.env.ARCHWOVEN_MODE = mode; else delete process.env.ARCHWOVEN_MODE; (process.env as Record<string, string>).NODE_ENV = node; };
    try {
      set(undefined, 'production');
      expect(sessionCookie('abc')).toBe(`aw_sid=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=${90 * 24 * 3600}; Secure`);
      set('local', 'production');
      expect(sessionCookie('abc')).not.toContain('Secure');
      set(undefined, 'development');
      expect(sessionCookie('abc')).not.toContain('Secure');
    } finally {
      set(env.mode, env.node ?? 'test');
    }
  });
});

describe('client address for abuse limits', () => {
  it.each([
    ['the address appended by the nearest proxy', '198.51.100.1, 203.0.113.7', '203.0.113.7'],
    ['a single forwarded address', '203.0.113.7', '203.0.113.7'],
    ['an IPv6 address', '2001:db8::1', '2001:db8::1'],
    ['surrounding whitespace', '  203.0.113.7  ', '203.0.113.7'],
  ])('uses %s', async (_name, header, expected) => {
    const { clientIp } = await import('./server');
    expect(clientIp(new Headers({ 'x-forwarded-for': header }))).toBe(expected);
  });

  it.each([
    ['a missing header', undefined],
    ['an empty header', ''],
    ['a non-address value', 'unknown'],
    ['a hostname', 'evil.example'],
  ])('reports no address for %s, so no shared bucket is formed', async (_name, header) => {
    const { clientIp } = await import('./server');
    expect(clientIp(new Headers(header === undefined ? {} : { 'x-forwarded-for': header }))).toBeNull();
  });
});

describe('quota messages', () => {
  it('never advertises a sign-in that does not exist, and says what still works', async () => {
    const { quotaMessage } = await import('./server');
    const resetAt = Date.now() + (7 * 60 + 23) * 60_000 + 10_000;
    expect(quotaMessage({ reason: 'credits-exhausted', resetAt })).toBe("You've used today's free credits. They reset in 7h 23m. You can still view, rearrange, rename and export your diagrams.");
    expect(quotaMessage({ reason: 'network-credits-exhausted', resetAt })).toBe("Today's free credits for your network are used up. They reset in 7h 23m. You can still view, rearrange, rename and export your diagrams.");
    expect(quotaMessage({ reason: 'stop-loss' })).toMatch(/temporarily paused/);
    expect(quotaMessage({ reason: 'burst' })).toMatch(/Try again in a minute/);
    for (const reason of ['credits-exhausted', 'network-credits-exhausted'] as const) expect(quotaMessage({ reason, resetAt })).not.toMatch(/sign in|github/i);
  });
});

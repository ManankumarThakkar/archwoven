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

describe('serverDeps local routing (§8/§9)', () => {
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validFullModel, validFullModelExtended } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import { serverDeps } from '../../lib/server';
import { buildCardSvg } from './card';
import { POST } from './route';

const SHA = '0123456789abcdef0123456789abcdef01234567';

// Burst gates compile out in local mode — the hosted 429 ladders are hosted-only.
const QUOTA = process.env.ARCHWOVEN_MODE !== 'local';
const hostedOnly = QUOTA ? it : it.skip;
const req = (body: unknown, cookie = 'aw_sid=test-sess') =>
  new Request('http://localhost/api/share-card', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });

beforeEach(() => {
  serverDeps.store = openStore(':memory:');
  const m = structuredClone(validFullModelExtended);
  for (const x of [...m.nodes, ...m.edges]) for (const ev of x.evidence) { ev.repo = 'foo/bar'; ev.commit = SHA; }
  serverDeps.store.saveRevision('m1', m, 'test-sess');
});

describe('POST /api/share-card', () => {
  it('owner gets a PNG (magic bytes) for a route card', async () => {
    const res = await POST(req({ modelId: 'm1', kind: 'route', from: 'actor.user', to: 'datastore.postgres' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const buf = Buffer.from(await res.arrayBuffer());
    expect([...buf.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('reach card renders too', async () => {
    const res = await POST(req({ modelId: 'm1', kind: 'reach', from: 'gateway.api' }));
    expect(res.status).toBe(200);
  });

  it('other session → 404, unknown model → 404', async () => {
    expect((await POST(req({ modelId: 'm1', kind: 'reach', from: 'gateway.api' }, 'aw_sid=mallory'))).status).toBe(404);
    expect((await POST(req({ modelId: 'ghost', kind: 'reach', from: 'gateway.api' }))).status).toBe(404);
  });

  hostedOnly('burst ladder: 5 cards then 429 with the burst message (weight 0 — credits untouched)', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await POST(req({ modelId: 'm1', kind: 'reach', from: 'gateway.api' }));
      expect(r.status, `call ${i + 1}`).toBe(200);
    }
    const blocked = await POST(req({ modelId: 'm1', kind: 'reach', from: 'gateway.api' }));
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { reason: string; message: string };
    expect(body.reason).toBe('burst');
    expect(body.message).toMatch(/slow down|moment/i);
    expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBe(0);
  });

  it('invalid body → 400', async () => {
    expect((await POST(req({ modelId: 'm1', kind: 'bogus', from: 'gateway.api' }))).status).toBe(400);
    expect((await POST(req({ modelId: 'm1', kind: 'route', from: 'gateway.api' }))).status).toBe(400);
  });
});

describe('buildCardSvg — privacy surface', () => {
  it('contains node labels but never evidence paths or commit SHAs', () => {
    const m = structuredClone(validFullModelExtended);
    m.nodes[0]!.evidence = [{ repo: 'foo/bar', commit: SHA, path: 'src/main/java/SecretLocation.java', lines: [1, 2] }];
    const svg = buildCardSvg(m, 'view.architecture', 'route', 'actor.user', 'datastore.postgres');
    expect(svg).toContain('API Gateway');
    expect(svg).toContain('1200');
    expect(svg).not.toContain('SecretLocation.java');
    expect(svg).not.toContain(SHA);
    expect(svg).not.toContain('foo/bar');
  });
});

describe('share-card burst — local mode and a separate bucket', () => {
  it('local mode: burst compiled out — 7 cards all 200', async () => {
    const prevMode = process.env.ARCHWOVEN_MODE;
    process.env.ARCHWOVEN_MODE = 'local';
    try {
      for (let i = 0; i < 7; i++) {
        const r = await POST(req({ modelId: 'm1', kind: 'reach', from: 'gateway.api' }));
        expect(r.status, `call ${i + 1}`).toBe(200);
      }
    } finally {
      if (prevMode === undefined) delete process.env.ARCHWOVEN_MODE; else process.env.ARCHWOVEN_MODE = prevMode;
    }
  });

  hostedOnly('exhausted card burst does NOT consume the model-call bucket (generate still 202)', async () => {
    for (let i = 0; i < 5; i++) expect((await POST(req({ modelId: 'm1', kind: 'reach', from: 'gateway.api' }))).status).toBe(200);
    expect((await POST(req({ modelId: 'm1', kind: 'reach', from: 'gateway.api' }))).status).toBe(429);
    // the model-call burst key must be untouched by cards
    const sessHits = serverDeps.store.bumpBurst(`sess:test-sess`, 60);
    expect(sessHits, 'cards must not bump the generate bucket').toBe(1);
  });
});

describe('card content follows the requested view', () => {
  it('draws a route card only through connections that view shows', () => {
    const m = structuredClone(validFullModel);
    // A hidden shortcut (like an expanded component's internal link) outside every view.
    m.edges.push({ id: 'e.hidden', from: 'actor.user', to: 'datastore.postgres', type: 'sync', provenance: 'inferred', evidence: [] });
    const overview = buildCardSvg(m, 'view.architecture', 'route', 'actor.user', 'datastore.postgres');
    expect(overview).toContain('API Gateway');
    expect(overview).not.toMatch(/\+\d+ more hops/);
    const unscoped = buildCardSvg(m, 'missing-view', 'route', 'actor.user', 'datastore.postgres');
    expect(unscoped).not.toContain('API Gateway');
  });
});

describe('share cards on Vercel', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('explains that cards are unavailable instead of reaching for a local database', async () => {
    vi.stubEnv('VERCEL', '1');
    const res = await POST(req({ modelId: 'm1', kind: 'route', from: 'actor.user', to: 'datastore.postgres' }));
    expect(res.status).toBe(503);
    expect((await res.json()).message).toMatch(/not available in this deployment.*SVG or PNG/);
  });
});

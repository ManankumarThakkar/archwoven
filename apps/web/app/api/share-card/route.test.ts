import { beforeEach, describe, expect, it } from 'vitest';
import { validFullModelExtended } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import { serverDeps } from '../../lib/server';
import { buildCardSvg } from './card';
import { POST } from './route';

const SHA = '0123456789abcdef0123456789abcdef01234567';
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

  it('burst ladder: 5 cards then 429 with §15 copy (weight 0 — credits untouched)', async () => {
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

describe('buildCardSvg — privacy surface (Review Focus 4)', () => {
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

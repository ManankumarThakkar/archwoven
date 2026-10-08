import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/probe-c', () => {
  it('rejects prototype-chain keys (toString/constructor) with 400, not 500', async () => {
    for (const repo of ['toString', 'constructor', 'valueOf', '__proto__']) {
      const res = await GET(new Request(`http://localhost/api/probe-c?repo=${repo}`));
      expect(res.status, `repo=${repo}`).toBe(400);
    }
  });

  it('extracts allow-listed fixtures', async () => {
    const res = await GET(new Request('http://localhost/api/probe-c?repo=spring-mini'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { counts: { nodes: number } };
    expect(body.counts.nodes).toBeGreaterThan(5);
  });
});

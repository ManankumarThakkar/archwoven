import { beforeEach, expect, it } from 'vitest';
import { openStore, recordUsage } from '@archwoven/jobs';
import { serverDeps } from '../../lib/server';
import { GET } from './route';

beforeEach(() => { serverDeps.store = openStore(':memory:'); });
it('restores only the requesting session task without exposing session or prompt data', async () => {
  recordUsage(serverDeps.store, { sessionId: 'owner', tier: 'anonymous', action: 'refine', modelId: 'model1', view: 'sequence', usage: { provider: 'ollama', model: 'gpt-oss:20b', inputTokens: 50, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, usageComplete: true } });
  const response = await GET(new Request('http://localhost/api/quota', { headers: { cookie: 'aw_sid=owner' } }));
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const owner = await response.json();
  expect(owner.lastTask).toMatchObject({ action: 'refine', view: 'sequence', provider: 'ollama', estimatedCostUsd: 0 });
  expect(JSON.stringify(owner.lastTask)).not.toMatch(/sessionId|owner|prompt/);
  const other = await (await GET(new Request('http://localhost/api/quota', { headers: { cookie: 'aw_sid=another' } }))).json();
  expect(other.lastTask).toBeNull();
});

it('reports the credits a user can actually spend when their network pool is lower than their session pool', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const { IP_POOL } = await import('@archwoven/jobs');
  for (let i = 0; i < IP_POOL - 2; i++) serverDeps.store.reserveCredits(`script-${i}`, day, 1, 6, { ip: '203.0.113.7', pool: IP_POOL });
  const onNetwork = await (await GET(new Request('http://localhost/api/quota', { headers: { cookie: 'aw_sid=newcomer', 'x-forwarded-for': '203.0.113.7' } }))).json();
  expect(onNetwork.remaining).toBe(2);
  const elsewhere = await (await GET(new Request('http://localhost/api/quota', { headers: { cookie: 'aw_sid=newcomer', 'x-forwarded-for': '198.51.100.4' } }))).json();
  expect(elsewhere.remaining).toBe(6);
  const unknown = await (await GET(new Request('http://localhost/api/quota', { headers: { cookie: 'aw_sid=newcomer' } }))).json();
  expect(unknown.remaining).toBe(6);
});

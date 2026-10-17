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

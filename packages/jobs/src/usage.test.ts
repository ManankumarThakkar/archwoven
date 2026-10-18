import { describe, expect, it } from 'vitest';
import { openStore } from './store';
import { costOf, recordUsage } from './quota';

const hosted = { provider: 'anthropic' as const, model: 'claude-opus-5-5', inputTokens: 1000, cacheWriteTokens: 2000, cacheReadTokens: 3000, outputTokens: 500, repairs: 1, transportRetries: 0, latencyMs: 1200, usageComplete: true, attempts: [] };

describe('provider-aware task metering', () => {
  it.each([
    ['claude-sonnet-5-5', 0.0123],
    ['claude-haiku-5-5', 0.00063],
  ])('prices %s from its own rates rather than Opus rates', (model, expected) => {
    expect(costOf({ ...hosted, model })).toBeCloseTo(expected, 10);
  });
  it('applies the Haiku long-context threshold separately to each provider attempt', () => {
    const part = { kind: 'initial' as const, inputTokens: 60_000, outputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0, usageComplete: true };
    expect(costOf({ ...hosted, model: 'claude-haiku-5-5', inputTokens: 120_000, outputTokens: 2000, cacheWriteTokens: 0, cacheReadTokens: 0, attempts: [part, { ...part, kind: 'repair' }] })).toBeCloseTo(0.013, 10);
    expect(costOf({ ...hosted, model: 'claude-haiku-5-5', inputTokens: 120_000, outputTokens: 2000, cacheWriteTokens: 0, cacheReadTokens: 0, attempts: [{ ...part, inputTokens: 120_000, outputTokens: 2000 }] })).toBeCloseTo(0.065, 10);
  });
  it('includes cached input in the tier boundary and does not guess tiers from ambiguous totals', () => {
    const usage = { ...hosted, model: 'claude-haiku-5-5', inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 100_000, outputTokens: 1000, attempts: [] };
    expect(costOf(usage)).toBeCloseTo(0.0015, 10);
    expect(costOf({ ...usage, cacheReadTokens: 100_001 })).toBeNull();
    const part = { kind: 'initial' as const, inputTokens: 1, outputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 100_000, usageComplete: true };
    expect(costOf({ ...usage, inputTokens: 1, attempts: [part] })).toBeCloseTo(0.0075005, 10);
    expect(costOf({ ...usage, inputTokens: 2, attempts: [part] })).toBeNull();
  });
  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('does not price invalid token counters (%s)', inputTokens => {
    expect(costOf({ ...hosted, model: 'claude-haiku-5-5', inputTokens })).toBeNull();
  });
  it('persists the selected model and its price basis without repricing previous tasks', () => {
    const store = openStore(':memory:');
    recordUsage(store, { sessionId: 'owner', tier: 'anonymous', action: 'generate', usage: hosted });
    recordUsage(store, { sessionId: 'owner', tier: 'anonymous', action: 'generate', usage: { ...hosted, model: 'claude-sonnet-5-5' } });
    expect(store.lastTask('owner')).toMatchObject({ model: 'claude-sonnet-5-5', estimatedCostUsd: 0.0123, costBasis: 'anthropic-sonnet-5-5-2026-10-18' });
    expect(store.listCalls('owner')[0]).toMatchObject({ costUsd: 0.0246, task: { costBasis: 'anthropic-opus-5-5-2026-10-17' } });
    expect(store.todayCost()).toBeCloseTo(0.0369, 10);
    store.close();
  });
  it('uses the supported hosted model rates for all token categories', () => {
    expect(costOf(hosted)).toBeCloseTo(0.0246, 10);
  });
  it('does not assign hosted dollars to local inference', () => {
    expect(costOf({ ...hosted, provider: 'ollama', model: 'gpt-oss:20b' })).toBe(0);
  });
  it('does not invent a price for an unknown model or provider', () => {
    expect(costOf({ ...hosted, model: 'unknown-model' })).toBeNull();
    expect(costOf({ ...hosted, provider: 'unknown' })).toBeNull();
  });
  it('preserves requested diagram type and task/provider/model identity independently of action', () => {
    const store = openStore(':memory:');
    const request = { sessionId: 'owner', tier: 'anonymous' as const, action: 'generate' as const, view: 'sequence' as const, taskId: 'task.one', modelId: 'model.one', usage: hosted, outcome: 'repaired' as const };
    recordUsage(store, request);
    const [record] = store.listCalls('owner');
    expect(record).toMatchObject({ view: 'sequence', costUsd: 0.0246, task: { id: 'task.one', action: 'generate', view: 'sequence', modelId: 'model.one', provider: 'anthropic', model: 'claude-opus-5-5', repairs: 1, transportRetries: 0, usageComplete: true, latencyMs: 1200 } });
    expect(store.creditsUsed('owner', new Date().toISOString().slice(0, 10))).toBe(0);
    store.close();
  });
});

it('keeps incomplete usage and unknown prices explicit when restoring a task', () => {
  const store = openStore(':memory:');
  recordUsage(store, { sessionId: 'owner', tier: 'anonymous', action: 'repo', view: 'architecture', taskId: 'partial', usage: { ...hosted, model: 'unknown-model', usageComplete: false }, outcome: 'failed' });
  expect(store.lastTask('owner')).toMatchObject({ id: 'partial', estimatedCostUsd: null, costBasis: 'unavailable', usageComplete: false, outcome: 'failed' });
  expect(store.listCalls('owner')[0]!.costUsd).toBeNull();
  expect(store.lastTask('another-owner')).toBeNull();
  store.close();
});
it('adds only hosted estimates to the daily spend meter in mixed-provider history', () => {
  const store = openStore(':memory:');
  recordUsage(store, { sessionId: 'owner', tier: 'anonymous', action: 'generate', usage: hosted });
  recordUsage(store, { sessionId: 'owner', tier: 'anonymous', action: 'generate', usage: { ...hosted, provider: 'ollama', model: 'gpt-oss:20b' } });
  expect(store.todayCost()).toBeCloseTo(0.0246, 10);
  store.close();
});

it('adds task metadata to an existing database without changing saved revisions or legacy costs', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { DatabaseSync } = await import('node:sqlite');
  const { validFullModel } = await import('@archwoven/model');
  const directory = mkdtempSync(join(tmpdir(), 'archwoven-usage-migration-'));
  const path = join(directory, 'legacy.db');
  try {
    const original = openStore(path);
    original.saveRevision('saved', validFullModel, 'owner');
    original.createJob({ id: 'old-job', modelId: 'saved', kind: 'generate', sessionId: 'owner' });
    original.logCall({ sessionId: 'owner', tier: 'anonymous', view: 'generate', inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5, costUsd: 0.123, retries: 0, outcome: 'ok' });
    original.addCreditsUsed('owner', '2026-10-17', 1);
    original.close();
    const legacy = new DatabaseSync(path);
    legacy.exec('ALTER TABLE call_log DROP COLUMN task_json'); legacy.close();
    const migrated = openStore(path);
    expect(migrated.getRevision('saved')).toEqual(validFullModel);
    expect(migrated.getRevisionOwner('saved')).toBe('owner');
    expect(migrated.getJob('old-job')?.status).toBe('queued');
    expect(migrated.creditsUsed('owner', '2026-10-17')).toBe(1);
    expect(migrated.listCalls('owner')[0]).toMatchObject({ costUsd: 0.123, view: 'generate' });
    expect(migrated.lastTask('owner')).toBeNull(); // No inferred historical identity.
    const task = recordUsage(migrated, { sessionId: 'owner', tier: 'anonymous', action: 'generate', usage: hosted });
    migrated.close();
    const reopened = openStore(path);
    expect(reopened.lastTask('owner')).toEqual(task);
    expect(reopened.lastTask('other')).toBeNull();
    expect(reopened.listCalls('owner')).toHaveLength(2);
    expect(reopened.getRevision('saved')).toEqual(validFullModel);
    reopened.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

import { describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { openStore } from './store';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('jobs store', () => {
  it('saves and reads revisions (latest + specific)', () => {
    const s = openStore(':memory:');
    s.saveRevision("m1", validFullModel);
    const latest = s.getRevision("m1");
    expect(latest?.revision).toBe(validFullModel.revision);
    expect(latest?.title).toBe(validFullModel.title);
    expect(s.getRevision("m1", validFullModel.revision)?.title).toBe(validFullModel.title);
    expect(s.getRevision('nope')).toBeNull();
  });

  it('enforces (model_id, revision) primary key', () => {
    const s = openStore(':memory:');
    s.saveRevision("m1", validFullModel);
    expect(() => s.saveRevision("m1", validFullModel)).toThrow();
  });

  it('runs the job lifecycle queued → running → succeeded', () => {
    const s = openStore(':memory:');
    s.createJob({ id: 'j1', modelId: 'm1', kind: 'generate', idempotencyKey: 'k1' });
    expect(s.getJob('j1')?.status).toBe('queued');
    s.updateJob('j1', { status: 'running', stage: 'generating' });
    expect(s.getJob('j1')?.stage).toBe('generating');
    s.updateJob('j1', { status: 'succeeded' });
    expect(s.getJob('j1')?.status).toBe('succeeded');
  });

  it('logs calls and sums today cost', () => {
    const s = openStore(':memory:');
    s.logCall({ sessionId: 's1', tier: 'anonymous', view: 'architecture', inputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 500, costUsd: 0.014, retries: 0, outcome: 'ok' });
    s.logCall({ sessionId: 's2', tier: 'anonymous', view: 'er', inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 100, costUsd: 0.0024, retries: 1, outcome: 'repaired' });
    expect(s.todayCost()).toBeCloseTo(0.0164, 6);
  });

  it('addCreditsUsed increments atomically and reads back', () => {
    const s = openStore(':memory:');
    const day = '2026-10-08';
    expect(s.addCreditsUsed('s1', day, 1)).toBe(1);
    expect(s.addCreditsUsed('s1', day, 0.25)).toBe(1.25);
    expect(s.addCreditsUsed('s1', day, 1.25)).toBe(2.5);
    expect(s.creditsUsed('s1', day)).toBe(2.5);
    expect(s.creditsUsed('s2', day)).toBe(0);
  });

  it('bumpBurst counts within the rolling window and resets outside it', async () => {
    const s = openStore(':memory:');
    expect(s.bumpBurst('sess-a', 2)).toBe(1);
    expect(s.bumpBurst('sess-a', 2)).toBe(2);
    await sleep(2100);
    expect(s.bumpBurst('sess-a', 2)).toBe(1);
    expect(s.bumpBurst('sess-b', 2)).toBe(1);
  });
});

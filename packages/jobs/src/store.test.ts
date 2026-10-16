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
    s.createJob({ id: 'j1', modelId: 'm1', kind: 'generate', idempotencyKey: 'k1', sessionId: 'sessX' });
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

  it('scopes idempotency-key lookup by session', () => {
    const s = openStore(':memory:');
    s.createJob({ id: 'j1', modelId: 'm1', kind: 'generate', idempotencyKey: 'k1', sessionId: 'sessA' });
    expect(s.findJobByIdempotencyKey('k1', 'sessA')?.id).toBe('j1');
    expect(s.findJobByIdempotencyKey('k1', 'sessB')).toBeNull();
  });

  it.each(['failed', 'cancelled'] as const)('allows a fresh attempt after %s without removing job history', (status) => {
    const s = openStore(':memory:');
    s.createJob({ id: 'old', modelId: 'old', kind: 'repo', idempotencyKey: 'repo-key', sessionId: 'owner' });
    s.updateJob('old', { status, error: 'previous attempt stopped' });
    expect(s.findJobByIdempotencyKey('repo-key', 'owner')).toBeNull();
    s.createJob({ id: 'retry', modelId: 'retry', kind: 'repo', idempotencyKey: 'repo-key', sessionId: 'owner' });
    expect(s.findJobByIdempotencyKey('repo-key', 'owner')?.id).toBe('retry');
    expect(s.getJob('old')).toMatchObject({ status, error: 'previous attempt stopped' });
    expect(s.getJob('old')?.idempotencyKey).toBeUndefined();
    s.close();
  });

  it.each(['queued', 'running', 'succeeded'] as const)('keeps %s attempts deduplicated and scoped to their owner', (status) => {
    const s = openStore(':memory:');
    s.createJob({ id: 'existing', modelId: 'existing', kind: 'repo', idempotencyKey: 'repo-key', sessionId: 'owner' });
    s.updateJob('existing', { status });
    expect(s.findJobByIdempotencyKey('repo-key', 'owner')?.id).toBe('existing');
    expect(() => s.createJob({ id: 'duplicate', modelId: 'duplicate', kind: 'repo', idempotencyKey: 'repo-key', sessionId: 'owner' })).toThrow();
    s.createJob({ id: 'other', modelId: 'other', kind: 'repo', idempotencyKey: 'repo-key', sessionId: 'other-owner' });
    expect(s.findJobByIdempotencyKey('repo-key', 'owner')?.id).toBe('existing');
    s.close();
  });

  it('records ownership on jobs and revisions', () => {
    const s = openStore(':memory:');
    s.createJob({ id: 'j1', modelId: 'm1', kind: 'generate', sessionId: 'sessA' });
    expect(s.getJob('j1')?.sessionId).toBe('sessA');
    s.saveRevision('m1', validFullModel, 'sessA');
    expect(s.getRevisionOwner('m1')).toBe('sessA');
    expect(s.getRevisionOwner('nope')).toBeNull();
  });

  it('reserveCredits spends atomically against the pool', () => {
    const s = openStore(':memory:');
    const day = '2026-10-08';
    for (let i = 1; i <= 6; i++) expect(s.reserveCredits('s1', day, 1, 6), `reserve ${i}`).not.toBeNull();
    expect(s.reserveCredits('s1', day, 1, 6)).toBeNull();
    expect(s.creditsUsed('s1', day)).toBe(6);
  });

  it('reserveCredits rejects a partial that would cross the pool line', () => {
    const s = openStore(':memory:');
    const day = '2026-10-08';
    expect(s.reserveCredits('s2', day, 5.75, 6)).not.toBeNull();
    expect(s.reserveCredits('s2', day, 0.5, 6)).toBeNull();
    expect(s.reserveCredits('s2', day, 0.25, 6)).not.toBeNull();
  });

  it('refundCredits returns credits and clamps at zero', () => {
    const s = openStore(':memory:');
    const day = '2026-10-08';
    s.reserveCredits('s3', day, 1, 6);
    expect(s.refundCredits('s3', day, 1)).toBe(0);
    expect(s.refundCredits('s3', day, 5)).toBe(0);
    expect(s.reserveCredits('s3', day, 1, 6)).not.toBeNull();
  });

  it('marks orphaned running/queued jobs failed on explicit sweep and refunds their reserved credits', () => {
    const file = `${process.env.TMPDIR ?? '/tmp'}/aw-orphan-test-${Date.now()}.db`;
    const s1 = openStore(file);
    s1.createJob({ id: 'j1', modelId: 'm1', kind: 'generate', sessionId: 's4' });
    s1.updateJob('j1', { status: 'running' });
    const day = new Date().toISOString().slice(0, 10);
    s1.reserveCredits('s4', day, 1, 6);
    s1.close();
    const s2 = openStore(file);
    expect(s2.getJob('j1')?.status).toBe('running'); // open alone must never sweep (dev re-evaluates per route bundle)
    expect(s2.sweepOrphans()).toBe(1);
    expect(s2.getJob('j1')?.status).toBe('failed');
    expect(s2.getJob('j1')?.error).toMatch(/restarted/);
    expect(s2.creditsUsed('s4', day)).toBe(0);
    s2.close();
  });
});

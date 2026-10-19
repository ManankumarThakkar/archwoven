import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EXPIRED_COPY, openHostedJobs, RESULT_TTL_SECONDS, WAIT_COPY, type HostedJobLimits } from './hosted-jobs';
import { redisRest } from './spending-ledger';
import { startTestRedis } from './redis-test-server';

// Real Redis only: these tests exist to prove the scripts' atomicity.
const redis = await startTestRedis();
if (!redis && process.env.CI) throw new Error('CI must provide Redis for the hosted job tests.');
afterAll(async () => { await redis?.close(); });

let clock = Date.UTC(2026, 9, 18, 12);
const limits: HostedJobLimits = { maxRunning: 1, maxWaiting: 3, waitMs: 60_000, runMs: 180_000 };
const jobs = () => openHostedJobs({ url: redis!.url, token: redis!.token, prefix: 'archwoven-test:', now: () => clock });
const id = () => randomUUID();
const raw = () => redisRest(redis!.url, redis!.token);

describe.skipIf(!redis)('hosted job lifecycle (real Redis)', () => {
  beforeEach(async () => { await redis!.flush(); clock = Date.UTC(2026, 9, 18, 12); });

  it('admits a job only its owner can see', async () => {
    const queue = jobs(), job = id();
    expect(await queue.admit(job, 'session-a', 'generate', 'k1', limits)).toEqual({ kind: 'admitted' });
    expect(await queue.read(job, 'session-a')).toMatchObject({ status: 'queued', kind: 'generate', queuePosition: 1, usagePending: true, deadlineAt: clock + 240_000 });
    expect(await queue.read(job, 'session-b')).toBeNull();
    expect(await queue.read('not-a-job-id', 'session-a')).toBeNull();
  });

  it('returns the same job for a repeated request, and allows one active job per visitor', async () => {
    const queue = jobs(), first = id();
    await queue.admit(first, 'session-a', 'generate', 'k1', limits);
    expect(await queue.admit(id(), 'session-a', 'generate', 'k1', limits)).toEqual({ kind: 'replay', jobId: first });
    expect(await queue.admit(id(), 'session-a', 'generate', 'k2', limits)).toEqual({ kind: 'busy', jobId: first });
    expect(await queue.admit(id(), 'session-b', 'generate', 'k1', limits)).toEqual({ kind: 'admitted' });
    await queue.claim(first, 'worker-1', limits);
    await queue.finish(first, 'worker-1', 'succeeded', '', { modelId: first, revision: 1 });
    expect(await queue.admit(id(), 'session-a', 'generate', 'k2', limits)).toEqual({ kind: 'admitted' });
  });

  it('starts a fresh job when the same request is retried after its job failed, was cancelled or expired', async () => {
    const queue = jobs(), failed = id();
    await queue.admit(failed, 'a', 'generate', 'same', limits);
    await queue.claim(failed, 'worker-1', limits);
    await queue.finish(failed, 'worker-1', 'failed', 'provider failed');
    const retry = id();
    expect(await queue.admit(retry, 'a', 'generate', 'same', limits)).toEqual({ kind: 'admitted' });
    await queue.cancel(retry, 'a');
    const again = id();
    expect(await queue.admit(again, 'a', 'generate', 'same', limits)).toEqual({ kind: 'admitted' });
    clock += 240_001; // its instance died: past the deadline it reads as failed
    const late = id();
    expect(await queue.admit(late, 'a', 'generate', 'same', limits)).toEqual({ kind: 'admitted' });
    expect(await queue.replayOf('a', 'same')).toBe(late);
  });

  it('limits active jobs per network, so dropping cookies cannot fill the queue', async () => {
    const queue = jobs(), first = id();
    const netLimits = { ...limits, maxWaiting: 8, maxPerNetwork: 2 };
    expect(await queue.admit(first, 'a', 'generate', undefined, netLimits, '203.0.113.9')).toEqual({ kind: 'admitted' });
    expect(await queue.admit(id(), 'b', 'generate', undefined, netLimits, '203.0.113.9')).toEqual({ kind: 'admitted' });
    expect(await queue.admit(id(), 'c', 'generate', undefined, netLimits, '203.0.113.9')).toEqual({ kind: 'network-busy' });
    expect(await queue.admit(id(), 'd', 'generate', undefined, netLimits, '198.51.100.7')).toEqual({ kind: 'admitted' });
    await queue.cancel(first, 'a');
    expect(await queue.admit(id(), 'e', 'generate', undefined, netLimits, '203.0.113.9')).toEqual({ kind: 'admitted' });
  });

  it('bounds the waiting list', async () => {
    const queue = jobs();
    for (const owner of ['a', 'b', 'c']) expect(await queue.admit(id(), owner, 'generate', undefined, limits)).toEqual({ kind: 'admitted' });
    expect(await queue.admit(id(), 'd', 'generate', undefined, limits)).toEqual({ kind: 'queue-full' });
  });

  it('starts jobs first in, first out, within the running limit', async () => {
    const queue = jobs(), a = id(), b = id();
    await queue.admit(a, 'a', 'generate', undefined, limits); clock += 1;
    await queue.admit(b, 'b', 'generate', undefined, limits);
    expect(await queue.claim(b, 'worker-b', limits)).toEqual({ kind: 'wait', position: 2 });
    expect(await queue.claim(a, 'worker-a', limits)).toEqual({ kind: 'claimed' });
    expect(await queue.claim(b, 'worker-b', limits)).toEqual({ kind: 'wait', position: 1 });
    expect(await queue.read(b, 'b')).toMatchObject({ status: 'queued', queuePosition: 1 });
    await queue.finish(a, 'worker-a', 'failed', 'provider failed');
    expect(await queue.claim(b, 'worker-b', limits)).toEqual({ kind: 'claimed' });
  });

  it('lets exactly one of many competing instances run a job', async () => {
    const job = id();
    await jobs().admit(job, 'a', 'generate', undefined, { ...limits, maxRunning: 5 });
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => jobs().claim(job, `worker-${i}`, { ...limits, maxRunning: 5 })));
    expect(results.filter(r => r.kind === 'claimed')).toHaveLength(1);
    expect(results.filter(r => r.kind === 'not-queued')).toHaveLength(11);
  });

  it('records an outcome only from the instance that claimed the job', async () => {
    const queue = jobs(), job = id();
    await queue.admit(job, 'a', 'generate', undefined, limits);
    await queue.claim(job, 'worker-1', limits);
    expect(await queue.finish(job, 'worker-2', 'succeeded', '', { modelId: 'x' })).toBe('stale');
    expect(await queue.read(job, 'a')).toMatchObject({ status: 'running' });
  });

  it('cancels a waiting job outright and flags a running one for its executor', async () => {
    const queue = jobs(), waiting = id(), running = id();
    await queue.admit(running, 'a', 'generate', undefined, limits); clock += 1;
    await queue.admit(waiting, 'b', 'generate', undefined, limits);
    expect(await queue.claim(running, 'worker-1', limits)).toEqual({ kind: 'claimed' });
    expect(await queue.cancel(waiting, 'someone-else')).toBe('not-found');
    expect(await queue.cancel(waiting, 'b')).toBe('cancelled');
    expect(await queue.read(waiting, 'b')).toMatchObject({ status: 'cancelled', usagePending: false, queuePosition: null });
    expect(await queue.cancel(running, 'a')).toBe('cancelled');
    expect(await queue.cancelRequested(running)).toBe(true);
    expect(await queue.read(running, 'a')).toMatchObject({ status: 'cancelled', usagePending: true });
    // The visitor may start again at once; the aborted run still holds its slot until its executor stops.
    expect(await queue.admit(id(), 'a', 'generate', undefined, limits)).toEqual({ kind: 'admitted' });
    expect(await queue.finish(running, 'worker-1', 'succeeded', '', { modelId: running })).toBe('stale');
    expect(await queue.read(running, 'a')).toMatchObject({ status: 'cancelled', usagePending: false, modelId: null });
    expect(await queue.cancel(running, 'a')).toBe('cancelled');
  });

  it('stops reporting usage as pending for a cancelled job whose executor died', async () => {
    const queue = jobs(), job = id();
    await queue.admit(job, 'a', 'generate', undefined, limits);
    await queue.claim(job, 'worker-1', limits);
    await queue.cancel(job, 'a');
    expect(await queue.read(job, 'a')).toMatchObject({ status: 'cancelled', usagePending: true });
    clock += 240_001;
    expect(await queue.read(job, 'a')).toMatchObject({ status: 'cancelled', usagePending: false });
  });

  it('fails a job whose executor never finished, once its deadline passes, and never runs it again', async () => {
    const queue = jobs(), job = id();
    await queue.admit(job, 'a', 'generate', undefined, limits);
    await queue.claim(job, 'worker-1', limits);
    clock += 240_001;
    expect(await queue.read(job, 'a')).toMatchObject({ status: 'failed', error: EXPIRED_COPY, usagePending: false });
    expect(await queue.claim(job, 'worker-2', limits)).toEqual({ kind: 'not-queued', status: 'failed' });
    expect(await queue.finish(job, 'worker-1', 'succeeded')).toBe('stale');
    // Its running slot is free again.
    const next = id();
    await queue.admit(next, 'b', 'generate', undefined, limits);
    expect(await queue.claim(next, 'worker-3', limits)).toEqual({ kind: 'claimed' });
  });

  it('gives up on a job that waited too long, without running it', async () => {
    const queue = jobs(), blocker = id(), late = id();
    await queue.admit(blocker, 'a', 'generate', undefined, limits);
    expect(await queue.claim(blocker, 'worker-1', limits)).toEqual({ kind: 'claimed' });
    clock += 1;
    await queue.admit(late, 'b', 'generate', undefined, limits);
    clock += 60_001;
    expect(await queue.claim(late, 'worker-2', limits)).toEqual({ kind: 'expired' });
    expect(await queue.abandon(late, WAIT_COPY)).toBe('failed');
    expect(await queue.read(late, 'b')).toMatchObject({ status: 'failed', error: WAIT_COPY, usagePending: false });
  });

  it('keeps clarification questions with the job', async () => {
    const queue = jobs(), job = id();
    await queue.admit(job, 'a', 'generate', undefined, limits);
    await queue.claim(job, 'worker-1', limits);
    await queue.finish(job, 'worker-1', 'clarifying', '', { clarification: JSON.stringify({ prompt: 'A blog', view: 'architecture', questions: ['Who writes?'] }) });
    expect(await queue.read(job, 'a')).toMatchObject({ status: 'clarifying', questions: ['Who writes?'], clarification: { prompt: 'A blog' } });
    expect(await queue.admit(id(), 'a', 'generate', undefined, limits)).toEqual({ kind: 'admitted' });
  });

  it('finds a replayed request without admitting it, and forgets an answered clarification', async () => {
    const queue = jobs(), job = id();
    expect(await queue.replayOf('a', 'clarification:abc')).toBeNull();
    await queue.admit(job, 'a', 'generate', 'clarification:abc', limits);
    expect(await queue.replayOf('a', 'clarification:abc')).toBe(job);
    expect(await queue.replayOf('b', 'clarification:abc')).toBeNull();
    await queue.claim(job, 'worker-1', limits);
    await queue.finish(job, 'worker-1', 'clarifying', '', { clarification: JSON.stringify({ prompt: 'A blog', view: 'architecture', questions: ['Who writes?'] }) });
    await queue.scrubClarification(job);
    expect(await queue.read(job, 'a')).toMatchObject({ status: 'clarifying', clarification: null, questions: [] });
  });

  it('saves a refined model only over the revision it was based on, and only for its owner', async () => {
    const queue = jobs(), model = id();
    expect(await queue.putModel(model, 'a', { revision: 1, title: 'v1' }, null)).toBe('ok');
    expect(await queue.putModel(model, 'b', { revision: 2, title: 'stolen' }, 1)).toBe('not-owner');
    expect(await queue.putModel(model, 'a', { revision: 3, title: 'late' }, 2)).toBe('stale');
    expect(await queue.putModel(model, 'a', { revision: 2, title: 'v2' }, 1)).toBe('ok');
    expect(await queue.getOwned('model', model, 'a')).toEqual({ revision: 2, title: 'v2' });
    // A model the server no longer holds (expired) is recorded again from its owner's refinement.
    const fresh = id();
    expect(await queue.putModel(fresh, 'a', { revision: 5 }, 4)).toBe('ok');
    await queue.putOwned('result', fresh, 'a', { ops: [] });
    expect(await queue.getOwned('result', fresh, 'a')).toEqual({ ops: [] });
    expect(await queue.getOwned('result', fresh, 'b')).toBeNull();
  });

  it('expires job state and owned results after 24 hours, keyed without raw session ids', async () => {
    const queue = jobs(), job = id();
    await queue.admit(job, 'session-secret-value', 'generate', 'k1', limits);
    await queue.putOwned('model', job, 'session-secret-value', { title: 'Shop' });
    expect(await queue.getOwned('model', job, 'session-secret-value')).toEqual({ title: 'Shop' });
    expect(await queue.getOwned('model', job, 'another-session')).toBeNull();
    expect(await queue.deleteOwned('model', job, 'another-session')).toBe(false);
    const call = raw();
    const keys = await call(['KEYS', 'archwoven-test:*']) as string[];
    expect(keys.join(' ')).not.toContain('session-secret-value');
    for (const key of keys.filter(k => /:(job|model|jobs:idem):/.test(k))) {
      const ttl = await call(['TTL', key]) as number;
      expect(ttl).toBeGreaterThan(RESULT_TTL_SECONDS - 5);
      expect(ttl).toBeLessThanOrEqual(RESULT_TTL_SECONDS);
    }
  });

  it('rejects malformed job ids and idempotency keys before contacting Redis', async () => {
    const queue = jobs();
    await expect(queue.admit('x', 'a', 'generate', undefined, limits)).rejects.toThrow(/job id/);
    await expect(queue.admit(id(), 'a', 'generate', 'bad key with spaces', limits)).rejects.toThrow(/idempotency/);
  });
});

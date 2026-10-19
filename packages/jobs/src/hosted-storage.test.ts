import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { openHostedJobs } from './hosted-jobs';
import { redisRest } from './spending-ledger';
import { startTestRedis } from './redis-test-server';
import { HOSTED_JOB_STORAGE_BYTES, HOSTED_JOB_STORAGE_RECORDS, HOSTED_MODEL_BYTES } from './hosted-storage';

const redis = await startTestRedis();
if (!redis && process.env.CI) throw new Error('CI must provide Redis.');
afterAll(async () => { await redis?.close(); });
const prefix = 'storage-test:';
const raw = () => redisRest(redis!.url, redis!.token);
const jobs = (bytes: number, records: number) => openHostedJobs({ url: redis!.url, token: redis!.token, prefix, storageLimits: { bytes, records } });

describe.skipIf(!redis)('hosted payload capacity (real Redis)', () => {
  beforeEach(async () => { await redis!.flush(); });

  it('bounds live diagrams even when edits renew the expiry of older copies', async () => {
    const store = jobs(1024, 2), a = randomUUID(), b = randomUUID(), c = randomUUID();
    await store.restoreModel(a, 'a', { revision: 1 });
    await store.restoreModel(b, 'b', { revision: 1 });
    await raw()(['EXPIRE', `${prefix}model:${a}`, 60]);
    expect(await store.putModel(a, 'a', { revision: 2 }, 1)).toBe('ok');
    expect(await raw()(['TTL', `${prefix}model:${a}`])).toBeGreaterThan(86_390);
    expect(await store.restoreModel(c, 'c', { revision: 1 })).toBe('storage-full');
    expect(await store.modelState(c, 'c')).toEqual({ owner: 'absent', model: null });
  });

  it('counts UTF-8 bytes rather than JavaScript characters', async () => {
    const model = { revision: 1, label: '界'.repeat(20) };
    const store = jobs(JSON.stringify(model).length, 10);
    expect(await store.restoreModel(randomUUID(), 'a', model)).toBe('storage-full');
  });

  it('refuses an AI job before admission when its result cannot be reserved', async () => {
    const store = jobs(1024, 2), id = randomUUID();
    expect(await store.admit(id, 'a', 'generate', 'one', { maxRunning: 1, maxWaiting: 3, waitMs: 60_000, runMs: 180_000 })).toEqual({ kind: 'storage-full' });
    expect(await store.read(id, 'a')).toBeNull();
  });

  it('checks competing writes atomically, across server instances', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, n) => jobs(1024, 2).restoreModel(randomUUID(), `owner-${n}`, { revision: 1 })));
    expect(results.filter(r => r === 'ok')).toHaveLength(2);
    expect(results.filter(r => r === 'storage-full')).toHaveLength(10);
    expect(await jobs(1024, 2).storageUsage()).toEqual({ bytes: 28, records: 2 });
  });

  it('accounts for replacement deltas, rejects growth without changing the copy and permits shrinking', async () => {
    const id = randomUUID(), small = { revision: 1 }, size = Buffer.byteLength(JSON.stringify(small));
    const store = jobs(size, 1);
    await store.restoreModel(id, 'a', small);
    expect(await store.putModel(id, 'a', { revision: 2, label: 'too big' }, 1)).toBe('storage-full');
    expect((await store.modelState(id, 'a')).model).toEqual(small);
    expect(await store.putModel(id, 'a', { revision: 2 }, 1)).toBe('ok');
    expect(await store.storageUsage()).toEqual({ bytes: size, records: 1 });
    expect(await store.deleteOwned('model', id, 'other')).toBe(false);
    expect(await store.storageUsage()).toEqual({ bytes: size, records: 1 });
    expect(await store.deleteOwned('model', id, 'a')).toBe(true);
    expect(await store.storageUsage()).toEqual({ bytes: 0, records: 0 });
    expect(await store.restoreModel(randomUUID(), 'a', small)).toBe('ok');
  });

  it('reclaims expired payloads without shortening the expiry of active copies', async () => {
    const a = randomUUID(), b = randomUUID(), store = jobs(1024, 1);
    await store.restoreModel(a, 'a', { revision: 1 });
    // Move both the Redis key and its accounting deadline to an already-expired instant.
    await raw()(['DEL', `${prefix}model:${a}`]);
    await raw()(['ZADD', `${prefix}storage:expires`, 0, `${prefix}model:${a}`]);
    expect(await store.restoreModel(b, 'b', { revision: 1 })).toBe('ok');
    expect(await store.storageUsage()).toEqual({ bytes: 14, records: 1 });
    expect(await raw()(['TTL', `${prefix}model:${b}`])).toBeGreaterThan(86_390);
  });

  it('does not delete a live copy renewed by an old instance during upgrade', async () => {
    const store = jobs(1024, 2), id = randomUUID(), key = `${prefix}model:${id}`;
    await store.restoreModel(id, 'a', { revision: 1 });
    const newer = { revision: 2, label: 'renewed by the previous release' };
    await raw()(['HSET', key, 'value', JSON.stringify(newer), 'revision', 2]);
    await raw()(['EXPIRE', key, 86_400]);
    await raw()(['ZADD', `${prefix}storage:expires`, 0, key]);
    for (const suffix of ['expires', 'bytes', 'records']) await raw()(['PEXPIRE', `${prefix}storage:${suffix}`, 1000]);
    expect(await store.storageUsage()).toEqual({ bytes: Buffer.byteLength(JSON.stringify(newer)), records: 1 });
    expect((await store.modelState(id, 'a')).model).toEqual(newer);
    for (const suffix of ['expires', 'bytes', 'records']) expect(await raw()(['PTTL', `${prefix}storage:${suffix}`])).toBeGreaterThan(86_390_000);
  });

  it('reserves capacity atomically and does not reserve again for a replay', async () => {
    const opts = { maxRunning: 2, maxWaiting: 20, waitMs: 60_000, runMs: 180_000 };
    const store = jobs(HOSTED_JOB_STORAGE_BYTES, HOSTED_JOB_STORAGE_RECORDS), ids = Array.from({ length: 8 }, randomUUID);
    const results = await Promise.all(ids.map((id, n) => store.admit(id, `owner-${n}`, 'generate', 'same', opts)));
    expect(results.filter(r => r.kind === 'admitted')).toHaveLength(1);
    expect(results.filter(r => r.kind === 'storage-full')).toHaveLength(7);
    const n = results.findIndex(r => r.kind === 'admitted');
    expect(await store.admit(randomUUID(), `owner-${n}`, 'generate', 'same', opts)).toEqual({ kind: 'replay', jobId: ids[n] });
    expect(await store.storageUsage()).toEqual({ bytes: HOSTED_JOB_STORAGE_BYTES, records: HOSTED_JOB_STORAGE_RECORDS });
    expect(await store.restoreModel(randomUUID(), 'other', { revision: 1 })).toBe('storage-full');
  });

  it('transfers a reservation to payloads, protects it from another finisher and releases the remainder', async () => {
    const store = jobs(HOSTED_JOB_STORAGE_BYTES, HOSTED_JOB_STORAGE_RECORDS), id = randomUUID();
    const opts = { maxRunning: 1, maxWaiting: 3, waitMs: 60_000, runMs: 180_000 };
    await store.admit(id, 'a', 'refine', 'k', opts);
    await store.claim(id, 'worker', opts);
    const claim = { jobId: id, claimant: 'worker' }, model = { revision: 1, label: '界' };
    expect(await store.finish(id, 'wrong-worker', 'failed')).toBe('stale');
    expect(await store.abandon(id, 'a competing runner lost')).toBe('running');
    expect(await store.putModel(id, 'a', model, null, claim)).toBe('ok');
    expect(await store.putOwned('result', id, 'a', { model }, claim)).toBe('ok');
    expect(await store.putOwned('lasttask', store.ownerOf('a'), 'a', { outcome: 'ok' }, claim)).toBe('ok');
    expect(await store.storageUsage()).toEqual({ bytes: HOSTED_JOB_STORAGE_BYTES, records: HOSTED_JOB_STORAGE_RECORDS });
    await store.finish(id, 'worker', 'succeeded');
    const size = [model, { model }, { outcome: 'ok' }].reduce((n, value) => n + Buffer.byteLength(JSON.stringify(value)), 0);
    expect(await store.storageUsage()).toEqual({ bytes: size, records: 3 });
  });

  it('releases unused capacity for cancellation, abandonment and dead instances', async () => {
    let clock = Date.now();
    const store = openHostedJobs({ url: redis!.url, token: redis!.token, prefix, now: () => clock });
    const opts = { maxRunning: 1, maxWaiting: 3, waitMs: 60_000, runMs: 180_000 };
    const queued = randomUUID();
    await store.admit(queued, 'a', 'generate', 'k1', opts);
    await store.cancel(queued, 'a');
    expect(await store.storageUsage()).toEqual({ bytes: 0, records: 0 });
    const running = randomUUID();
    await store.admit(running, 'a', 'generate', 'k2', opts);
    await store.claim(running, 'worker', opts);
    await store.cancel(running, 'a');
    expect((await store.storageUsage()).bytes).toBe(HOSTED_JOB_STORAGE_BYTES);
    await store.finish(running, 'worker', 'failed');
    expect(await store.storageUsage()).toEqual({ bytes: 0, records: 0 });
    const abandoned = randomUUID();
    await store.admit(abandoned, 'a', 'generate', 'k3', opts);
    await store.abandon(abandoned, 'busy');
    expect(await store.storageUsage()).toEqual({ bytes: 0, records: 0 });
    const dead = randomUUID();
    await store.admit(dead, 'a', 'generate', 'k4', opts);
    clock += 240_001;
    expect((await store.read(dead, 'a'))?.status).toBe('failed');
    expect(await store.storageUsage()).toEqual({ bytes: 0, records: 0 });
    const cancelledDead = randomUUID();
    await store.admit(cancelledDead, 'a', 'generate', 'k5', opts);
    await store.claim(cancelledDead, 'worker', opts);
    await store.cancel(cancelledDead, 'a');
    clock += 240_001;
    expect((await store.read(cancelledDead, 'a'))?.usagePending).toBe(false);
    expect(await store.storageUsage()).toEqual({ bytes: 0, records: 0 });
  });

  it('bounds every hosted model in UTF-8 bytes and leaves rejected writes uncharged', async () => {
    const store = jobs(32 * 1024 * 1024, 256), id = randomUUID();
    const model = { revision: 1, label: '界'.repeat(HOSTED_MODEL_BYTES / 2) };
    expect(await store.restoreModel(id, 'a', model)).toBe('too-large');
    expect(await store.putModel(id, 'a', model, null)).toBe('too-large');
    expect(await store.putOwned('model', id, 'a', model)).toBe('too-large');
    expect(await store.storageUsage()).toEqual({ bytes: 0, records: 0 });
  });
});

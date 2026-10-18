import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openSpendingLedger, redisRest, SpendingLedgerUnavailable, type SpendingCaps } from './spending-ledger';
import { startTestRedis, type TestRedis } from './redis-test-server';

// Real Redis only: these tests exist to prove the Lua scripts' atomicity and accounting.
const redis: TestRedis | null = await startTestRedis();
if (!redis && process.env.CI) throw new Error('CI must provide Redis for the spending ledger tests.');
afterAll(async () => { await redis?.close(); });
beforeEach(async () => { await redis?.flush(); redis?.setDown(false); });

const OCT_31_LATE = Date.UTC(2026, 9, 31, 23, 59, 59, 900);
const NOV_1 = Date.UTC(2026, 10, 1, 0, 0, 1);
const window = { start: Date.UTC(2026, 9, 1), end: Date.UTC(2027, 9, 1) };
const caps: SpendingCaps = { annualNanos: 10_000, monthNanos: 1_000, visitorDayNanos: 300, networkDayNanos: 500 };
const identity = { model: 'claude-opus-5-5', basis: 'test' };
let clock = Date.UTC(2026, 9, 18, 12);
function ledger(prefix = 'archwoven-test:') {
  return openSpendingLedger({ url: redis!.url, token: redis!.token, prefix, now: () => clock });
}
const raw = () => redisRest(redis!.url, redis!.token);
const id = () => randomUUID();
const who = (visitor: string, network: string | null = 'net-a') => ({ visitor, network });

describe.skipIf(!redis)('hosted spending ledger (real Redis)', () => {
  it('initializes once and never replaces an existing ledger', async () => {
    const spend = ledger();
    expect(await spend.initialize(window, caps)).toBe('initialized');
    expect(await spend.initialize(window, { ...caps, annualNanos: 99_999 })).toBe('exists');
    expect((await spend.status())!.caps.annualNanos).toBe(10_000);
    await expect(spend.initialize(window, { ...caps, visitorDayNanos: 2_000 })).rejects.toThrow(/nest/);
  });

  it('refuses before the ledger exists, outside its year, and while paused', async () => {
    const spend = ledger();
    expect(await spend.reserve(id(), 10, who('v'), identity)).toEqual({ ok: false, reason: 'ledger-missing' });
    await spend.initialize(window, caps);
    clock = window.end; expect(await spend.reserve(id(), 10, who('v'), identity)).toEqual({ ok: false, reason: 'ledger-expired' });
    clock = window.start - 1; expect(await spend.reserve(id(), 10, who('v'), identity)).toEqual({ ok: false, reason: 'ledger-expired' });
    clock = Date.UTC(2026, 9, 18, 12);
    await spend.setPaused(true, 'operator');
    expect(await spend.reserve(id(), 10, who('v'), identity)).toEqual({ ok: false, reason: 'paused' });
    await spend.setPaused(false);
    expect(await spend.reserve(id(), 10, who('v'), identity)).toEqual({ ok: true });
  });

  it('names the first cap that a hold would cross', async () => {
    const spend = ledger(); await spend.initialize(window, caps);
    expect(await spend.reserve(id(), 300, who('v1'), identity)).toEqual({ ok: true });
    expect(await spend.reserve(id(), 1, who('v1'), identity)).toEqual({ ok: false, reason: 'visitor-exhausted' });
    expect(await spend.reserve(id(), 200, who('v2'), identity)).toEqual({ ok: true });
    expect(await spend.reserve(id(), 1, who('v3'), identity)).toEqual({ ok: false, reason: 'network-exhausted' });
    expect(await spend.reserve(id(), 300, who('v3', 'net-b'), identity)).toEqual({ ok: true });
    expect(await spend.reserve(id(), 200, who('v4', 'net-c'), identity)).toEqual({ ok: true });
    expect(await spend.reserve(id(), 1, who('v5', 'net-d'), identity)).toEqual({ ok: false, reason: 'month-exhausted' });
    // A visitor without a verified network is limited by its own and the shared caps only.
    expect(await spend.reserve(id(), 1, who('v6', null), identity)).toEqual({ ok: false, reason: 'month-exhausted' });
  });

  it('admits exactly what fits when many instances reserve at once', async () => {
    const spend = ledger(); await spend.initialize(window, { ...caps, visitorDayNanos: 1_000, networkDayNanos: 1_000 });
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => ledger().reserve(id(), 100, who(`v${i}`, `n${i}`), identity)));
    expect(results.filter(r => r.ok)).toHaveLength(10);
    expect((await spend.status())!.month).toMatchObject({ heldNanos: 1_000, settledNanos: 0 });
  });

  it('reserves and settles each attempt once', async () => {
    const spend = ledger(); await spend.initialize(window, caps);
    const attempt = id();
    expect(await spend.reserve(attempt, 100, who('v'), identity)).toEqual({ ok: true });
    expect(await spend.reserve(attempt, 100, who('v'), identity)).toEqual({ ok: false, reason: 'duplicate' });
    expect((await spend.status())!.month.heldNanos).toBe(100);
    expect(await spend.settle(attempt, 40)).toBe('settled');
    expect(await spend.settle(attempt, 40)).toBe('already-settled');
    expect(await spend.settle(attempt, null)).toBe('already-settled');
    expect((await spend.status())!.month).toMatchObject({ heldNanos: 0, settledNanos: 40 });
    expect(await spend.settle(id(), 1)).toBe('missing');
  });

  it('keeps the whole hold when usage is unknown, and pauses everything when a charge exceeds its hold', async () => {
    const spend = ledger(); await spend.initialize(window, caps);
    const lost = id(), over = id();
    await spend.reserve(lost, 100, who('v'), identity);
    expect(await spend.settle(lost, null)).toBe('unknown');
    expect(await spend.settle(lost, 0)).toBe('already-unknown');
    expect((await spend.status())!).toMatchObject({ month: { heldNanos: 100 }, unknownAttempts: 1 });
    await spend.reserve(over, 50, who('v2'), identity);
    expect(await spend.settle(over, 80)).toBe('settled-over-hold');
    expect((await spend.status())!).toMatchObject({ paused: true, pausedReason: 'A charge exceeded its hold.', month: { heldNanos: 100, settledNanos: 80 } });
    expect(await spend.reserve(id(), 1, who('v3'), identity)).toEqual({ ok: false, reason: 'paused' });
  });

  it('settles into the month that admitted the attempt, and starts the next month fresh', async () => {
    const spend = ledger(); await spend.initialize(window, { ...caps, visitorDayNanos: 1_000, networkDayNanos: 1_000 });
    clock = OCT_31_LATE;
    const late = id();
    expect(await spend.reserve(late, 1_000, who('v'), identity)).toEqual({ ok: true });
    expect(await spend.reserve(id(), 1, who('v2', 'n2'), identity)).toEqual({ ok: false, reason: 'month-exhausted' });
    clock = NOV_1;
    expect(await spend.settle(late, 600)).toBe('settled');
    const call = raw();
    expect(await call(['HMGET', 'archwoven-test:spend:totals:month:2026-10', 'settled', 'held'])).toEqual(['600', '0']);
    expect((await spend.status())!.month).toEqual({ id: '2026-11', settledNanos: 0, heldNanos: 0 });
    expect(await spend.reserve(id(), 1_000, who('v'), identity)).toEqual({ ok: true });
    expect((await spend.status())!.year).toEqual({ settledNanos: 600, heldNanos: 1_000 });
    clock = Date.UTC(2026, 9, 18, 12);
  });

  it('never expires financial records, stores no raw identities, and expires only per-day totals', async () => {
    const spend = ledger(); await spend.initialize(window, caps);
    const attempt = id();
    await spend.reserve(attempt, 100, who('visitor-raw-id', '203.0.113.9'), identity);
    const call = raw();
    const keys = (await call(['KEYS', 'archwoven-test:*'])) as string[];
    expect(keys.join(' ')).not.toMatch(/visitor-raw-id|203\.0\.113\.9/);
    for (const key of keys) {
      const ttl = await call(['TTL', key]) as number;
      if (/totals:(visitor|network):/.test(key)) expect(ttl).toBeGreaterThan(30 * 86_400);
      else expect(ttl).toBe(-1);
    }
    expect(keys).toContain(`archwoven-test:spend:attempt:${attempt}`);
  });

  it('releases a reservation in full when nothing was sent', async () => {
    const spend = ledger(); await spend.initialize(window, caps);
    const attempt = id();
    await spend.reserve(attempt, 300, who('v'), identity);
    expect(await spend.settle(attempt, 0)).toBe('settled');
    expect((await spend.status())!.month).toMatchObject({ heldNanos: 0, settledNanos: 0 });
    expect(await spend.reserve(id(), 300, who('v'), identity)).toEqual({ ok: true });
  });

  it('lets the owner resolve unknown usage from outside evidence, never above its hold', async () => {
    const spend = ledger(); await spend.initialize(window, caps);
    const lost = id(), settled = id();
    await spend.reserve(lost, 100, who('v'), identity); await spend.settle(lost, null);
    await spend.reserve(settled, 100, who('v2'), identity); await spend.settle(settled, 10);
    expect(await spend.unknownAttempts()).toEqual([{ id: lost, model: 'claude-opus-5-5', reservedNanos: 100, reservedAt: clock }]);
    expect(await spend.resolveUnknown(lost, 101, 'console')).toBe('over-hold');
    expect(await spend.resolveUnknown(settled, 0, 'console')).toBe('not-unknown');
    expect(await spend.resolveUnknown(lost, 0, 'Console shows no usage that day')).toBe('resolved');
    expect(await spend.resolveUnknown(lost, 0, 'again')).toBe('not-unknown');
    expect((await spend.status())!).toMatchObject({ unknownAttempts: 0, month: { heldNanos: 0, settledNanos: 10 } });
    expect(await raw()(['HGET', `archwoven-test:spend:attempt:${lost}`, 'evidence'])).toBe('Console shows no usage that day');
    await expect(spend.resolveUnknown(lost, 0, '  ')).rejects.toThrow(/evidence/);
  });

  it('starts a new annual window only after the current one has ended', async () => {
    const spend = ledger(); await spend.initialize(window, caps);
    const next = { start: window.end, end: Date.UTC(2028, 9, 1) };
    expect(await spend.renew(next)).toBe('still-open');
    clock = window.end + 1000;
    expect(await spend.renew({ start: window.end - 1, end: next.end })).toBe('overlaps');
    expect(await spend.renew(next)).toBe('renewed');
    expect(await spend.reserve(id(), 100, who('v'), identity)).toEqual({ ok: true });
    expect((await spend.status())!).toMatchObject({ start: next.start, year: { heldNanos: 100 } });
    clock = Date.UTC(2026, 9, 18, 12);
  });

  it('keeps separate prefixes apart', async () => {
    await ledger('archwoven-test:').initialize(window, caps);
    expect(await ledger('archwoven-preview-test:').reserve(id(), 1, who('v'), identity)).toEqual({ ok: false, reason: 'ledger-missing' });
  });

  it('reports an outage instead of admitting or settling', async () => {
    const spend = ledger(); await spend.initialize(window, caps);
    const attempt = id();
    await spend.reserve(attempt, 100, who('v'), identity);
    redis!.setDown(true);
    await expect(spend.reserve(id(), 1, who('v2'), identity)).rejects.toBeInstanceOf(SpendingLedgerUnavailable);
    await expect(spend.settle(attempt, 10)).rejects.toBeInstanceOf(SpendingLedgerUnavailable);
    redis!.setDown(false);
    expect(await spend.settle(attempt, 10)).toBe('settled');
  });

  it('rejects malformed prefixes, ids and amounts before contacting Redis', async () => {
    expect(() => openSpendingLedger({ url: redis!.url, token: redis!.token, prefix: 'Archwoven' })).toThrow(/prefix/);
    const spend = ledger();
    await expect(spend.reserve('not-a-uuid', 1, who('v'), identity)).rejects.toThrow(/attempt id/);
    await expect(spend.reserve(id(), 0, who('v'), identity)).rejects.toThrow(/amount/);
    await expect(spend.reserve(id(), 1.5, who('v'), identity)).rejects.toThrow(/amount/);
    await expect(spend.settle(id(), -1)).rejects.toThrow(/amount/);
  });
});

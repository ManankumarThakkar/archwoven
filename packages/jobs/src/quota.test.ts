import { describe, expect, it } from 'vitest';
import { openStore } from './store';
import { reserve, refundCredits, recordUsage, costOf, STOP_LOSS_USD, IP_POOL, BURST } from './quota';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const day = () => new Date().toISOString().slice(0, 10);
const usage = { provider: 'anthropic', model: 'claude-opus-5-5', inputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 500 };

// Hosted gates only — in local mode quotas compile out entirely (own test below),
// so the parity CI run (ARCHWOVEN_MODE=local) skips these by design (§15).
const hostedOnly = process.env.ARCHWOVEN_MODE === 'local' ? describe.skip : describe;

hostedOnly('quota (§15 weighted credits, reserve-then-refund)', () => {
  it('anonymous gets exactly 6 reserved generations then credits-exhausted with reset countdown', async () => {
    const s = openStore(':memory:');
    // burstWindowSec tiny + spaced so the 5/min burst gate doesn't shadow the daily-credit gate
    const win = { sessionId: 'a', tier: 'anonymous' as const, action: 'generate' as const, ip: '1.1.1.1', burstWindowSec: 0.05 };
    for (let i = 0; i < 6; i++) {
      await sleep(60);
      const r = reserve(s, win);
      expect(r.ok, `gen ${i + 1}`).toBe(true);
      if (r.ok) expect(r.remaining).toBe(6 - (i + 1));
    }
    await sleep(60);
    const r = reserve(s, win);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('credits-exhausted');
      expect(r.resetAt).toBeGreaterThan(Date.now());
      expect(r.resetAt).toBeLessThanOrEqual(Date.now() + 86_400_000);
    }
    expect(s.creditsUsed('a', day())).toBe(6);
  });

  it('parallel reserves cannot bypass the pool (TOCTOU regression)', async () => {
    const s = openStore(':memory:');
    // tiny burst window, spaced: burst never binds, credits do — the point is
    // that no completion/refund happens between reserves, yet the pool still holds.
    const req = { sessionId: 'racer', tier: 'anonymous' as const, action: 'generate' as const, ip: '9.9.9.9', burstWindowSec: 0.001 };
    let ok = 0;
    for (let i = 0; i < 7; i++) {
      await sleep(2);
      if (reserve(s, req).ok) ok++;
    }
    expect(ok).toBe(6);
    expect(s.creditsUsed('racer', day())).toBe(6);
  });

  it('refund returns the credit so a failed job does not burn quota', async () => {
    const s = openStore(':memory:');
    const req = { sessionId: 'f1', tier: 'anonymous' as const, action: 'generate' as const, ip: '1.1.1.1', burstWindowSec: 0.001 };
    for (let i = 0; i < 6; i++) {
      await sleep(2);
      expect(reserve(s, req).ok).toBe(true);
    }
    await sleep(2);
    expect(reserve(s, req).ok).toBe(false);
    refundCredits(s, 'f1', day(), 1);
    await sleep(2);
    expect(reserve(s, req).ok).toBe(true);
  });

  it('refinement reserves 0.25 — four refinements spend one credit', () => {
    const s = openStore(':memory:');
    for (let i = 0; i < 4; i++) {
      const r = reserve(s, { sessionId: 'b', tier: 'anonymous', action: 'refine', ip: '2.2.2.2' });
      expect(r.ok).toBe(true);
    }
    expect(s.creditsUsed('b', day())).toBeCloseTo(1, 6);
  });

  it('view switches and exports are free', () => {
    const s = openStore(':memory:');
    for (let i = 0; i < 50; i++) {
      const r = reserve(s, { sessionId: 'c', tier: 'anonymous', action: 'view', ip: '2.2.2.2' });
      expect(r.ok).toBe(true);
    }
    expect(s.creditsUsed('c', day())).toBe(0);
  });

  it('global stop-loss trips at $15/day across all sessions', () => {
    const s = openStore(':memory:');
    const big = { provider: 'anthropic', model: 'claude-opus-5-5', inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
    const n = Math.ceil(STOP_LOSS_USD / costOf({ ...big, outputTokens: 1000 })!) + 1;
    for (let i = 0; i < n; i++) {
      s.logCall({ sessionId: `x${i}`, tier: 'github', view: 'architecture', ...big, outputTokens: 1000, costUsd: costOf({ ...big, outputTokens: 1000 }), retries: 0, outcome: 'ok' });
    }
    expect(s.todayCost()).toBeGreaterThanOrEqual(STOP_LOSS_USD);
    const r = reserve(s, { sessionId: 'new-one', tier: 'anonymous', action: 'generate', ip: '3.3.3.3' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('stop-loss');
    // stop-loss must not have spent the caller's credits
    expect(s.creditsUsed('new-one', day())).toBe(0);
  });

  it('burst limit: 6th model request in the window is throttled', () => {
    const s = openStore(':memory:');
    for (let i = 0; i < 5; i++) {
      const r = reserve(s, { sessionId: 'd', tier: 'github', action: 'generate', ip: '4.4.4.4' });
      expect(r.ok, `req ${i + 1}`).toBe(true);
    }
    const r = reserve(s, { sessionId: 'd', tier: 'github', action: 'generate', ip: '4.4.4.4' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('burst');
    // a burst rejection must give back the credit it tentatively reserved
    expect(s.creditsUsed('d', day())).toBe(5);
  });

  it('recordUsage logs the call for metering without spending credits', () => {
    const s = openStore(':memory:');
    recordUsage(s, { sessionId: 'm1', tier: 'anonymous', action: 'generate', usage, retries: 1, outcome: 'repaired' });
    expect(s.todayCost()).toBeCloseTo(costOf(usage)!, 9);
    expect(s.creditsUsed('m1', day())).toBe(0);
  });

  it('garbage burst window falls back to the 60s default instead of NaN', () => {
    const s = openStore(':memory:');
    const req = { sessionId: 'g1', tier: 'anonymous' as const, action: 'generate' as const, ip: '5.5.5.5', burstWindowSec: Number('garbage') };
    for (let i = 0; i < 5; i++) expect(reserve(s, req).ok, `req ${i + 1}`).toBe(true);
    expect(reserve(s, req).ok).toBe(false);
  });

  it('local mode compiles quotas out entirely', () => {
    const s = openStore(':memory:');
    process.env.ARCHWOVEN_MODE = 'local';
    try {
      for (let i = 0; i < 100; i++) {
        const r = reserve(s, { sessionId: 'e', tier: 'anonymous', action: 'generate', ip: '5.5.5.5' });
        expect(r.ok).toBe(true);
      }
    } finally {
      delete process.env.ARCHWOVEN_MODE;
    }
  });
});

hostedOnly('network credit pool (SPEC §15: IP as secondary bucket key)', () => {
  const gen = (sessionId: string, ip: string | null) => ({ sessionId, tier: 'anonymous' as const, action: 'generate' as const, ip, burstWindowSec: 0.001 });
  /** Reservations 2 ms apart, so the per-session burst window never shadows the credit pools. */
  const spaced = async (n: number, make: (i: number) => Parameters<typeof reserve>[1], s: ReturnType<typeof openStore>) => { const out = []; for (let i = 0; i < n; i++) { await sleep(2); out.push(reserve(s, make(i))); } return out; };

  it('stops fresh sessions from one network after its daily pool, without spending the refused session\'s credit', async () => {
    const s = openStore(':memory:');
    expect((await spaced(IP_POOL, i => gen(`fresh-${i}`, '203.0.113.7'), s)).every(r => r.ok)).toBe(true);
    await sleep(2);
    const refused = reserve(s, gen('one-more', '203.0.113.7'));
    expect(refused).toMatchObject({ ok: false, reason: 'network-credits-exhausted' });
    if (!refused.ok) expect(refused.resetAt).toBeGreaterThan(Date.now());
    expect(s.creditsUsed('one-more', day())).toBe(0);
  });

  it('frees network credit when a failed job is refunded', async () => {
    const s = openStore(':memory:');
    expect((await spaced(IP_POOL, i => gen(`fresh-${i}`, '203.0.113.7'), s)).every(r => r.ok)).toBe(true);
    await sleep(2);
    expect(reserve(s, gen('before-refund', '203.0.113.7')).ok).toBe(false);
    refundCredits(s, 'fresh-0', day(), 1);
    expect(reserve(s, gen('after-refund', '203.0.113.7')).ok).toBe(true);
  });

  it('keeps networks independent', async () => {
    const s = openStore(':memory:');
    expect((await spaced(IP_POOL, i => gen(`fresh-${i}`, '203.0.113.7'), s)).every(r => r.ok)).toBe(true);
    expect(reserve(s, gen('elsewhere', '198.51.100.4')).ok).toBe(true);
  });

  it('never pools users whose address is unknown', async () => {
    const s = openStore(':memory:');
    expect((await spaced(IP_POOL + 5, i => gen(`unknown-${i}`, null), s)).every(r => r.ok)).toBe(true);
  });

  it('still applies the per-session pool first', async () => {
    const s = openStore(':memory:');
    expect((await spaced(6, () => gen('one', '203.0.113.7'), s)).every(r => r.ok)).toBe(true);
    await sleep(2);
    expect(reserve(s, gen('one', '203.0.113.7'))).toMatchObject({ ok: false, reason: 'credits-exhausted' });
  });

  it('does not share a burst bucket between users whose address is unknown', () => {
    const s = openStore(':memory:');
    const fast = (id: string) => ({ ...gen(id, null), burstWindowSec: 60 });
    for (let i = 0; i < BURST.ip + 3; i++) expect(reserve(s, fast(`burst-${i}`)).ok).toBe(true);
  });
});

hostedOnly('remaining credits reflect the tighter pool', () => {
  it('reports the network headroom when it is below the session headroom', async () => {
    const s = openStore(':memory:');
    for (let i = 0; i < IP_POOL - 2; i++) { await sleep(2); reserve(s, { sessionId: `fill-${i}`, tier: 'anonymous', action: 'generate', ip: '203.0.113.7', burstWindowSec: 0.001 }); }
    await sleep(2);
    const r = reserve(s, { sessionId: 'newcomer', tier: 'anonymous', action: 'generate', ip: '203.0.113.7', burstWindowSec: 0.001 });
    expect(r).toEqual({ ok: true, remaining: 1 });
  });
});

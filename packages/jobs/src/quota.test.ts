import { describe, expect, it } from 'vitest';
import { openStore } from './store';
import { checkQuota, charge, costOf, STOP_LOSS_USD } from './quota';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const day = () => new Date().toISOString().slice(0, 10);
const usage = { inputTokens: 1000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 500 };

describe('quota (§15 weighted credits)', () => {
  it('anonymous gets exactly 6 generations then credits-exhausted with reset countdown', async () => {
    const s = openStore(':memory:');
    // burstWindowSec tiny + spaced so the 5/min burst gate doesn't shadow the daily-credit gate
    const win = { sessionId: 'a', tier: 'anonymous' as const, action: 'generate' as const, ip: '1.1.1.1', burstWindowSec: 0.05 };
    for (let i = 0; i < 6; i++) {
      await sleep(60);
      const r = checkQuota(s, win);
      expect(r.ok, `gen ${i + 1}`).toBe(true);
      charge(s, { sessionId: 'a', tier: 'anonymous', action: 'generate', usage });
    }
    await sleep(60);
    const r = checkQuota(s, win);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('credits-exhausted');
      expect(r.resetAt).toBeGreaterThan(Date.now());
      expect(r.resetAt).toBeLessThanOrEqual(Date.now() + 86_400_000);
    }
  });

  it('refinement costs 0.25 — four refinements spend one credit', () => {
    const s = openStore(':memory:');
    for (let i = 0; i < 4; i++) charge(s, { sessionId: 'b', tier: 'anonymous', action: 'refine', usage });
    expect(s.creditsUsed('b', day())).toBeCloseTo(1, 6);
  });

  it('view switches and exports are free', () => {
    const s = openStore(':memory:');
    for (let i = 0; i < 50; i++) {
      const r = checkQuota(s, { sessionId: 'c', tier: 'anonymous', action: 'view', ip: '2.2.2.2' });
      expect(r.ok).toBe(true);
    }
    expect(s.creditsUsed('c', day())).toBe(0);
  });

  it('global stop-loss trips at $15/day across all sessions', () => {
    const s = openStore(':memory:');
    const big = { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
    const n = Math.ceil(STOP_LOSS_USD / costOf({ ...big, outputTokens: 1000 })) + 1;
    for (let i = 0; i < n; i++) {
      s.logCall({ sessionId: `x${i}`, tier: 'github', view: 'architecture', ...big, outputTokens: 1000, costUsd: costOf({ ...big, outputTokens: 1000 }), retries: 0, outcome: 'ok' });
    }
    expect(s.todayCost()).toBeGreaterThanOrEqual(STOP_LOSS_USD);
    const r = checkQuota(s, { sessionId: 'new-one', tier: 'anonymous', action: 'generate', ip: '3.3.3.3' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('stop-loss');
  });

  it('burst limit: 6th model request in the window is throttled', () => {
    const s = openStore(':memory:');
    for (let i = 0; i < 5; i++) {
      const r = checkQuota(s, { sessionId: 'd', tier: 'github', action: 'generate', ip: '4.4.4.4' });
      expect(r.ok, `req ${i + 1}`).toBe(true);
    }
    const r = checkQuota(s, { sessionId: 'd', tier: 'github', action: 'generate', ip: '4.4.4.4' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('burst');
  });

  it('costOf prices cached reads at cache rate, not input rate (§10)', () => {
    const cached = costOf({ inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 1_000_000, outputTokens: 0 });
    expect(cached).toBeCloseTo(0.2, 6);
  });

  it('local mode compiles quotas out entirely', () => {
    const s = openStore(':memory:');
    process.env.ARCHWOVEN_MODE = 'local';
    try {
      for (let i = 0; i < 100; i++) {
        const r = checkQuota(s, { sessionId: 'e', tier: 'anonymous', action: 'generate', ip: '5.5.5.5' });
        expect(r.ok).toBe(true);
      }
    } finally {
      delete process.env.ARCHWOVEN_MODE;
    }
  });
});

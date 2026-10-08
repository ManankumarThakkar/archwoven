import type { Store, Tier } from './store';

/** §15 LOCKED numbers — tunable via config review post-launch, not per-call. */
export const TIERS: Record<Tier, { pool: number }> = {
  anonymous: { pool: 6 },
  github: { pool: 30 },
};
export const WEIGHTS = { generate: 1, repo: 2, refine: 0.25, view: 0 } as const;
/** USD per MTok (§10): cached reads at $0.20 — pricing wrong here trips the stop-loss 20× early. */
export const PRICES = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };
export const STOP_LOSS_USD = 15;
export const BURST = { session: 5, ip: 20 };

export type Action = keyof typeof WEIGHTS;
export interface Usage {
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

export const localMode = () => process.env.ARCHWOVEN_MODE === 'local';

export function costOf(u: Usage): number {
  return (u.inputTokens * PRICES.input + u.cacheWriteTokens * PRICES.cacheWrite + u.cacheReadTokens * PRICES.cacheRead + u.outputTokens * PRICES.output) / 1e6;
}

const nextUtcMidnight = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
};

export type QuotaResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: 'credits-exhausted' | 'stop-loss' | 'burst'; resetAt?: number };

/**
 * Gate a model-calling request: stop-loss → daily credits → burst.
 * Burst is bumped only when the request passes every gate (rejected calls
 * never reach the model, so they don't consume burst budget).
 */
export function checkQuota(
  store: Store,
  req: { sessionId: string; tier: Tier; action: Action; ip: string; burstWindowSec?: number },
): QuotaResult {
  if (localMode()) return { ok: true, remaining: Infinity };

  if (store.todayCost() >= STOP_LOSS_USD) return { ok: false, reason: 'stop-loss' };

  const weight = WEIGHTS[req.action];
  const used = store.creditsUsed(req.sessionId, new Date().toISOString().slice(0, 10));
  if (used + weight > TIERS[req.tier].pool) return { ok: false, reason: 'credits-exhausted', resetAt: nextUtcMidnight() };

  if (weight > 0) {
    const win = req.burstWindowSec ?? 60;
    if (store.bumpBurst(`sess:${req.sessionId}`, win) > BURST.session) return { ok: false, reason: 'burst', resetAt: Date.now() + win * 1000 };
    if (store.bumpBurst(`ip:${req.ip}`, win) > BURST.ip) return { ok: false, reason: 'burst', resetAt: Date.now() + win * 1000 };
  }

  return { ok: true, remaining: TIERS[req.tier].pool - used - weight };
}

/** Record the completed call and spend its credits (§15 accounting = eval data, one table). */
export function charge(
  store: Store,
  req: { sessionId: string; tier: Tier; action: Action; usage: Usage; retries?: number; outcome?: 'ok' | 'repaired' | 'failed' },
): number {
  const cost = costOf(req.usage);
  store.logCall({ sessionId: req.sessionId, tier: req.tier, view: req.action, ...req.usage, costUsd: cost, retries: req.retries ?? 0, outcome: req.outcome ?? 'ok' });
  const day = new Date().toISOString().slice(0, 10);
  const used = store.addCreditsUsed(req.sessionId, day, WEIGHTS[req.action]);
  return TIERS[req.tier].pool - used;
}

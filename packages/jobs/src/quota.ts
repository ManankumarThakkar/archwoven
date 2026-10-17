import { randomUUID } from 'node:crypto';
import type { TaskReport, TaskUsage, TokenUsage, ViewType } from '@archwoven/model';
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
/** Legacy injected adapters may omit identity; that is unpriced, never guessed. */
export interface Usage extends TokenUsage {
  provider?: string;
  model?: string;
  effort?: TaskUsage['effort'];
  latencyMs?: number;
  repairs?: number;
  transportRetries?: number;
  usageComplete?: boolean;
  attempts?: TaskUsage['attempts'];
}

export const localMode = () => process.env.ARCHWOVEN_MODE === 'local';

/** Standard direct-API Opus 5.5 rates verified 2026-10-17. No batch, fast
 * mode, geographic premium or local-compute cost is inferred from token counts. */
export function costOf(u: Usage): number | null {
  if (u.provider === 'ollama' || u.provider === 'demo') return 0;
  if (u.provider !== 'anthropic' || !/^claude-opus-5-5(?:-[0-9]{8})?$/.test(u.model ?? '')) return null;
  if (![u.inputTokens, u.outputTokens, u.cacheWriteTokens, u.cacheReadTokens].every(value => Number.isSafeInteger(value) && value >= 0)) return null;
  return (u.inputTokens * PRICES.input + u.cacheWriteTokens * PRICES.cacheWrite + u.cacheReadTokens * PRICES.cacheRead + u.outputTokens * PRICES.output) / 1e6;
}

const nextUtcMidnight = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
};

export type QuotaResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: 'credits-exhausted' | 'stop-loss' | 'burst'; resetAt?: number };

export const burstWindow = (raw: number | undefined): number =>
  raw !== undefined && Number.isFinite(raw) && raw > 0 ? raw : 60;

/**
 * Gate a model-calling request: stop-loss → daily credits (atomically reserved) → burst.
 * The credit reservation is a single SQL statement — there is no read-then-write
 * window for parallel requests to race through. If burst then rejects, the reserved
 * credit is refunded. A reserved credit is refunded by the caller (refundCredits)
 * when the job ultimately fails; burst budget stays spent (rate, not quota).
 */
export function reserve(
  store: Store,
  req: { sessionId: string; tier: Tier; action: Action; ip: string; burstWindowSec?: number },
): QuotaResult {
  if (localMode()) return { ok: true, remaining: Infinity };

  if (store.todayCost() >= STOP_LOSS_USD) return { ok: false, reason: 'stop-loss' };

  const weight = WEIGHTS[req.action];
  const day = new Date().toISOString().slice(0, 10);
  const pool = TIERS[req.tier].pool;
  const used = store.reserveCredits(req.sessionId, day, weight, pool);
  if (used === null) return { ok: false, reason: 'credits-exhausted', resetAt: nextUtcMidnight() };

  if (weight > 0) {
    const win = burstWindow(req.burstWindowSec);
    if (store.bumpBurst(`sess:${req.sessionId}`, win) > BURST.session) {
      store.refundCredits(req.sessionId, day, weight);
      return { ok: false, reason: 'burst', resetAt: Date.now() + win * 1000 };
    }
    if (store.bumpBurst(`ip:${req.ip}`, win) > BURST.ip) {
      store.refundCredits(req.sessionId, day, weight);
      return { ok: false, reason: 'burst', resetAt: Date.now() + win * 1000 };
    }
  }

  return { ok: true, remaining: pool - used };
}

/** Give back a reserved credit when the job it reserved for did not succeed. */
export function refundCredits(store: Store, sessionId: string, day: string, weight: number): void {
  store.refundCredits(sessionId, day, weight);
}

/**
 * Meter the call (§15: every model call logs to SQLite — success, repaired or
 * failed; this is the stop-loss input and the §11 eval data). Credits were
 * already reserved at the gate; this never touches the credit ledger.
 */
export function recordUsage(
  store: Store,
  req: { sessionId: string; tier: Tier; action: Action | 'expand'; view?: ViewType; taskId?: string; modelId?: string; usage: Usage; retries?: number; outcome?: 'ok' | 'repaired' | 'failed' },
): TaskReport {
  const cost = costOf(req.usage);
  const provider = ['anthropic', 'ollama', 'demo'].includes(req.usage.provider ?? '') ? req.usage.provider as TaskUsage['provider'] : 'unknown';
  const task: TaskReport = {
    id: req.taskId ?? randomUUID(), action: req.action, view: req.view ?? null, modelId: req.modelId ?? null,
    provider, model: req.usage.model ?? 'unknown', effort: req.usage.effort ?? 'medium',
    inputTokens: req.usage.inputTokens, outputTokens: req.usage.outputTokens, cacheWriteTokens: req.usage.cacheWriteTokens, cacheReadTokens: req.usage.cacheReadTokens,
    latencyMs: req.usage.latencyMs ?? 0, repairs: req.usage.repairs ?? req.retries ?? 0, transportRetries: req.usage.transportRetries ?? 0,
    usageComplete: req.usage.usageComplete ?? false, attempts: req.usage.attempts ?? [],
    estimatedCostUsd: cost, costBasis: provider === 'ollama' ? 'local-inference' : provider === 'demo' ? 'demo' : cost === null ? 'unavailable' : 'anthropic-opus-5-5-2026-10-17',
    outcome: req.outcome ?? 'ok',
  };
  store.logCall({ sessionId: req.sessionId, tier: req.tier, view: req.view ?? req.action, inputTokens: task.inputTokens, outputTokens: task.outputTokens, cacheWriteTokens: task.cacheWriteTokens, cacheReadTokens: task.cacheReadTokens, costUsd: cost, retries: task.repairs, outcome: task.outcome, task });
  return task;
}

import { randomUUID } from 'node:crypto';
import type { TaskReport, TaskUsage, TokenUsage, ViewType } from '@archwoven/model';
import { HOSTED_MODELS, hostedModelProfile } from '@archwoven/model';
import type { Store, Tier } from './store';

/** Fixed limits: change them through a reviewed config change, not per call. */
export const TIERS: Record<Tier, { pool: number }> = {
  anonymous: { pool: 6 },
  github: { pool: 30 },
};
export const WEIGHTS = { generate: 1, repo: 2, refine: 0.25, view: 0 } as const;
/** USD per MTok: cached reads at $0.20 — pricing wrong here trips the stop-loss 20× early. */
export const PRICES = HOSTED_MODELS['claude-opus-5-5'].prices;
export const STOP_LOSS_USD = 15;
export const BURST = { session: 5, ip: 20 };
/** Secondary bucket: daily credits shared by every anonymous session on one network address
 *  (about four people behind an office or school NAT). Tunable with the post-launch quota review. */
export const IP_POOL = 24;

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

/** Reviewed standard direct-API rates. No batch, fast
 * mode, geographic premium or local-compute cost is inferred from token counts. */
export function costOf(u: Usage): number | null {
  if (u.provider === 'ollama' || u.provider === 'demo') return 0;
  const profile = u.provider === 'anthropic' ? hostedModelProfile(u.model) : undefined;
  if (!profile) return null;
  const keys = ['inputTokens', 'outputTokens', 'cacheWriteTokens', 'cacheReadTokens'] as const;
  const valid = (part: TokenUsage) => keys.every(key => Number.isSafeInteger(part[key]) && part[key] >= 0)
    && Number.isSafeInteger(part.inputTokens + part.cacheWriteTokens + part.cacheReadTokens);
  if (!valid(u)) return null;
  const price = (part: TokenUsage, multiplier = 1) => multiplier * (part.inputTokens * profile.prices.input
    + part.cacheWriteTokens * profile.prices.cacheWrite + part.cacheReadTokens * profile.prices.cacheRead
    + part.outputTokens * profile.prices.output) / 1e6;
  if (u.model !== 'claude-haiku-5-5') return price(u);
  const tier = (part: TokenUsage) => part.inputTokens + part.cacheWriteTokens + part.cacheReadTokens > 100_000 ? 5 : 1;
  if (u.attempts?.length) {
    if (!u.attempts.every(valid) || !keys.every(key => u.attempts!.reduce((sum, part) => sum + part[key], 0) === u[key])) return null;
    return u.attempts.reduce((sum, part) => sum + price(part, tier(part)), 0);
  }
  // An aggregate above the boundary could be one long call or several short
  // calls. Without attempt evidence its tier cannot be reconstructed honestly.
  return tier(u) === 1 ? price(u) : null;
}

const nextUtcMidnight = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
};

/** What a user can actually spend today: the tighter of their session pool and their network's pool. */
export function creditsRemaining(store: Store, req: { sessionId: string; tier: Tier; ip: string | null }, day = new Date().toISOString().slice(0, 10)): number {
  const session = TIERS[req.tier].pool - store.creditsUsed(req.sessionId, day);
  const network = req.ip ? IP_POOL - store.networkCreditsUsed(req.ip, day) : Infinity;
  return Math.max(0, Math.min(session, network));
}

export type QuotaResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: 'credits-exhausted' | 'network-credits-exhausted' | 'stop-loss' | 'burst'; resetAt?: number };

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
  /** `ip` is null when the client address cannot be determined: no network pool or IP burst then applies. */
  req: { sessionId: string; tier: Tier; action: Action; ip: string | null; burstWindowSec?: number },
): QuotaResult {
  if (localMode()) return { ok: true, remaining: Infinity };

  if (store.todayCost() >= STOP_LOSS_USD) return { ok: false, reason: 'stop-loss' };

  const weight = WEIGHTS[req.action];
  const day = new Date().toISOString().slice(0, 10);
  const pool = TIERS[req.tier].pool;
  const used = weight > 0 && req.ip ? store.reserveCredits(req.sessionId, day, weight, pool, { ip: req.ip, pool: IP_POOL }) : store.reserveCredits(req.sessionId, day, weight, pool);
  if (used === null) return { ok: false, reason: 'credits-exhausted', resetAt: nextUtcMidnight() };
  if (used === 'network') return { ok: false, reason: 'network-credits-exhausted', resetAt: nextUtcMidnight() };

  if (weight > 0) {
    const win = burstWindow(req.burstWindowSec);
    if (store.bumpBurst(`sess:${req.sessionId}`, win) > BURST.session) {
      store.refundCredits(req.sessionId, day, weight);
      return { ok: false, reason: 'burst', resetAt: Date.now() + win * 1000 };
    }
    // An unknown address is never one shared bucket: it would throttle every proxy-less user together.
    if (req.ip && store.bumpBurst(`ip:${req.ip}`, win) > BURST.ip) {
      store.refundCredits(req.sessionId, day, weight);
      return { ok: false, reason: 'burst', resetAt: Date.now() + win * 1000 };
    }
  }

  return { ok: true, remaining: creditsRemaining(store, req, day) };
}

/** Give back a reserved credit when the job it reserved for did not succeed. */
export function refundCredits(store: Store, sessionId: string, day: string, weight: number): void {
  store.refundCredits(sessionId, day, weight);
}

/**
 * Meter the call (every model call logs to SQLite — success, repaired or
 * failed; this is the stop-loss input and the evaluation data). Credits were
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
    estimatedCostUsd: cost, costBasis: provider === 'ollama' ? 'local-inference' : provider === 'demo' ? 'demo' : cost === null ? 'unavailable' : hostedModelProfile(req.usage.model)!.costBasis,
    outcome: req.outcome ?? 'ok',
  };
  store.logCall({ sessionId: req.sessionId, tier: req.tier, view: req.view ?? req.action, inputTokens: task.inputTokens, outputTokens: task.outputTokens, cacheWriteTokens: task.cacheWriteTokens, cacheReadTokens: task.cacheReadTokens, costUsd: cost, retries: task.repairs, outcome: task.outcome, task });
  return task;
}

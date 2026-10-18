/** Reviewed direct-API, global, standard-speed rates in USD per million tokens.
 * 5-minute cache writes only. https://platform.claude.com/docs/en/about-claude/pricing
 * Verified 2026-10-18. Shared by request configuration and task metering; no I/O.
 */
export const HOSTED_MODELS = {
  'claude-opus-5-5': {
    prices: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
    costBasis: 'anthropic-opus-5-5-2026-10-17',
  },
  'claude-sonnet-5-5': {
    prices: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
    costBasis: 'anthropic-sonnet-5-5-2026-10-18',
  },
  'claude-haiku-5-5': {
    prices: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
    costBasis: 'anthropic-haiku-5-5-2026-10-18',
  },
} as const;

export type HostedModelId = keyof typeof HOSTED_MODELS;

/** Reviewed hosted request shapes per action. `effort: null` means the request
 * sends no effort and the provider default applies; `outputSchema` means a JSON
 * schema constrains the output. Call sites read their output ceiling here. */
export const HOSTED_REQUESTS = {
  generate: { maxTokens: 8192, effort: null, outputSchema: false },
  repo: { maxTokens: 8192, effort: null, outputSchema: false },
  repoSourceMap: { maxTokens: 2048, effort: null, outputSchema: false },
  refine: { maxTokens: 4000, effort: 'low', outputSchema: true },
  expand: { maxTokens: 4000, effort: 'low', outputSchema: true },
} as const;
export type HostedAction = keyof typeof HOSTED_REQUESTS;

/** Largest context an evaluation attempt may report. Holds assume all of it is billed. */
export const EVALUATION_CONTEXT_CEILING = 1_000_000;
/** Worst-case cost of one hosted attempt in nano-USD, as the evaluation ledger
 * reserves it: the full context at the highest input rate plus the output
 * ceiling, at Haiku's higher long-context tier. */
export function evaluationHoldNanos(model: HostedModelId, maxTokens: number): number {
  const { prices } = HOSTED_MODELS[model];
  const multiplier = model === 'claude-haiku-5-5' ? 5 : 1;
  return EVALUATION_CONTEXT_CEILING * (Math.max(prices.input, prices.cacheWrite, prices.cacheRead) * 1000) * multiplier
    + maxTokens * (prices.output * 1000) * multiplier;
}
export type HostedCostBasis = (typeof HOSTED_MODELS)[HostedModelId]['costBasis'];
export const DEFAULT_HOSTED_MODEL: HostedModelId = 'claude-opus-5-5';

export function resolveHostedModelId(value?: string): HostedModelId {
  const model = value?.trim() || DEFAULT_HOSTED_MODEL;
  if (!Object.hasOwn(HOSTED_MODELS, model)) {
    throw new Error('Unsupported ARCHWOVEN_HOSTED_MODEL. Choose claude-opus-5-5, claude-sonnet-5-5 or claude-haiku-5-5.');
  }
  return model as HostedModelId;
}

/** Preserve already-supported dated Opus records; do not infer rates for unknown models. */
export function hostedModelProfile(model?: string) {
  if (model && Object.hasOwn(HOSTED_MODELS, model)) return HOSTED_MODELS[model as HostedModelId];
  if (/^claude-opus-5-5-[0-9]{8}$/.test(model ?? '')) return HOSTED_MODELS[DEFAULT_HOSTED_MODEL];
  return undefined;
}

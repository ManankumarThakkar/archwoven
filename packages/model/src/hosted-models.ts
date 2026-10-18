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

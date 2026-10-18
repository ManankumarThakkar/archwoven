import { describe, expect, it } from 'vitest';
import { HOSTED_REQUESTS, evaluationHoldNanos, resolveHostedModelId } from './hosted-models';

describe('server-selected hosted model', () => {
  it('keeps the default and accepts only reviewed model IDs', () => {
    expect(resolveHostedModelId()).toBe('claude-opus-5-5');
    expect(resolveHostedModelId('  ')).toBe('claude-opus-5-5');
    expect(resolveHostedModelId(' claude-sonnet-5-5 ')).toBe('claude-sonnet-5-5');
    expect(resolveHostedModelId('claude-haiku-5-5')).toBe('claude-haiku-5-5');
  });
  it('rejects unsupported configuration without reflecting the supplied value', () => {
    expect(() => resolveHostedModelId('accidental-secret-value')).toThrow(/Unsupported ARCHWOVEN_HOSTED_MODEL/);
    expect(() => resolveHostedModelId('accidental-secret-value')).not.toThrow(/accidental-secret-value/);
  });
});

describe('evaluation holds', () => {
  it.each([
    ['claude-opus-5-5', 8192, 5_163_840_000], ['claude-sonnet-5-5', 8192, 2_581_920_000], ['claude-haiku-5-5', 8192, 645_480_000],
    ['claude-opus-5-5', 4000, 5_080_000_000], ['claude-haiku-5-5', 4000, 635_000_000],
  ] as const)('reserves the full reviewed context and %s output ceiling (%i tokens)', (model, maxTokens, nanos) => {
    expect(evaluationHoldNanos(model, maxTokens)).toBe(nanos);
  });
  it('names one output ceiling per hosted action, none above the 8k limit', () => {
    expect(Object.fromEntries(Object.entries(HOSTED_REQUESTS).map(([action, request]) => [action, request.maxTokens])))
      .toEqual({ generate: 8192, repo: 8192, repoSourceMap: 2048, refine: 4000, expand: 4000 });
  });
});

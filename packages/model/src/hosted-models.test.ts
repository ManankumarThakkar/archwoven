import { describe, expect, it } from 'vitest';
import { resolveHostedModelId } from './hosted-models';

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

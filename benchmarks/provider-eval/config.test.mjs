import { expect, it } from 'vitest';
import { assertLegacyEvalServer } from './config.mjs';

const config = { mode: 'hosted', fake: false, llmReady: true, hostedModel: 'claude-opus-5-5', evaluationBudgetEnabled: true };
it('accepts only the real hosted model the legacy report can price', () => {
  expect(() => assertLegacyEvalServer(config)).not.toThrow();
  for (const change of [{ fake: true }, { mode: 'local' }, { llmReady: false }, { hostedModel: 'claude-sonnet-5-5' }, { hostedModel: 'claude-haiku-5-5' }, { hostedModel: undefined }, { evaluationBudgetEnabled: false }, { evaluationBudgetEnabled: undefined }]) {
    expect(() => assertLegacyEvalServer({ ...config, ...change })).toThrow();
  }
});

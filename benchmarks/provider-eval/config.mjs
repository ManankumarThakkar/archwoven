/** The legacy runner's cache-savings calculation is Opus-specific. Refuse
 * other models and sample/local output before starting any evaluation task. */
export function assertLegacyEvalServer(config) {
  if (config?.mode !== 'hosted' || config.fake !== false || config.llmReady !== true) {
    throw new Error('Evaluation requires a configured hosted provider with sample data disabled.');
  }
  if (config.hostedModel !== 'claude-opus-5-5') {
    throw new Error('The legacy evaluation runner supports only claude-opus-5-5; use a model-aware staged runner for comparisons.');
  }
}

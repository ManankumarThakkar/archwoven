import type { ViewType } from './schema';

export interface TokenUsage {
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}
export interface AttemptUsage extends TokenUsage {
  kind: 'initial' | 'repair' | 'retry';
  usageComplete: boolean;
}
/** Provider-reported counters, independent of diagram JSON and user credits. */
export interface TaskUsage extends TokenUsage {
  provider: 'anthropic' | 'ollama' | 'demo' | 'unknown';
  model: string;
  effort: 'low' | 'medium' | 'high';
  latencyMs: number;
  repairs: number;
  transportRetries: number;
  usageComplete: boolean;
  attempts: AttemptUsage[];
}
export interface TaskReport extends TaskUsage {
  id: string;
  action: 'generate' | 'repo' | 'refine' | 'expand' | 'view';
  view: ViewType | null;
  modelId: string | null;
  outcome: 'ok' | 'repaired' | 'failed';
  estimatedCostUsd: number | null;
  costBasis: 'anthropic-opus-5-5-2026-10-17' | 'local-inference' | 'demo' | 'unavailable';
}

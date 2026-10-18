// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import type { TaskReport } from '@archwoven/model';
import { TaskUsageSummary } from './TaskUsageSummary';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });

it.each([true, false])('does not round a small paid task to zero (complete: %s)', usageComplete => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const task: TaskReport = {
    id: 'tiny', modelId: null, action: 'refine', view: 'architecture', outcome: 'ok',
    provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'low', inputTokens: 0,
    outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, latencyMs: 1,
    attempts: [], repairs: 0, transportRetries: 0, usageComplete,
    estimatedCostUsd: 0.0000005, costBasis: 'anthropic-haiku-5-5-2026-10-18',
  };
  act(() => root.render(<TaskUsageSummary task={task} />));
  expect(host.querySelector('summary')?.textContent).toContain(`${usageComplete ? '' : '≥ '}$0.0000005 API estimate`);
  act(() => root.unmount());
});

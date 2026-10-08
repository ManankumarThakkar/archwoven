import type { ViewType } from '@archwoven/model';

/** Real generation stages surfaced by /api/jobs polling. */
export const STAGES = ['validating', 'generating', 'validating-output', 'laying-out'] as const;
export type Stage = (typeof STAGES)[number];

export type WorkspaceState =
  | { kind: 'idle'; prefill?: { prompt: string; view: ViewType } }
  | { kind: 'clarifying'; questions: string[] }
  | { kind: 'running'; stage: Stage }
  | { kind: 'success'; modelId: string; revision: number }
  | { kind: 'partial'; modelId: string; revision: number; gaps: string[] }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' }
  | { kind: 'stale'; latestRevision: number }
  | { kind: 'quota-blocked'; reason: string; resetAt: number }
  | { kind: 'paused'; message: string };

export type Event =
  | { type: 'GENERATE' }
  | { type: 'CLARIFY'; questions: string[] }
  | { type: 'STAGE'; stage: Stage }
  | { type: 'SUCCESS'; modelId: string; revision: number }
  | { type: 'PARTIAL'; modelId: string; revision: number; gaps: string[] }
  | { type: 'ERROR'; message: string }
  | { type: 'CANCEL' }
  | { type: 'STALE'; latestRevision: number }
  | { type: 'QUOTA_BLOCKED'; reason: string; resetAt: number }
  | { type: 'PAUSE'; message: string }
  | { type: 'EXAMPLE_SELECT'; prompt: string; view: ViewType }
  | { type: 'RESET' };

export const initial: WorkspaceState = { kind: 'idle' };

const running = (stage: Stage): WorkspaceState => ({ kind: 'running', stage });

/**
 * Pure reducer for the workspace. Kept UI-free so the transitions are unit-testable:
 * an example click only prefills (never GENERATE), quota/stale carry their payload
 * so the UI can render a countdown / rebase without extra fetches.
 */
export function next(state: WorkspaceState, event: Event): WorkspaceState {
  switch (event.type) {
    case 'GENERATE':
      return running('validating');
    case 'CLARIFY':
      return state.kind === 'running' ? state : { kind: 'clarifying', questions: event.questions };
    case 'STAGE':
      return state.kind === 'running' ? running(event.stage) : state;
    case 'SUCCESS':
      return state.kind === 'running' ? { kind: 'success', modelId: event.modelId, revision: event.revision } : state;
    case 'PARTIAL':
      return state.kind === 'running' ? { kind: 'partial', modelId: event.modelId, revision: event.revision, gaps: event.gaps } : state;
    case 'ERROR':
      return state.kind === 'running' ? { kind: 'error', message: event.message } : state;
    case 'CANCEL':
      return state.kind === 'running' ? { kind: 'cancelled' } : state;
    case 'STALE':
      return { kind: 'stale', latestRevision: event.latestRevision };
    case 'QUOTA_BLOCKED':
      return { kind: 'quota-blocked', reason: event.reason, resetAt: event.resetAt };
    case 'PAUSE':
      return { kind: 'paused', message: event.message };
    case 'EXAMPLE_SELECT':
      return { kind: 'idle', prefill: { prompt: event.prompt, view: event.view } };
    case 'RESET':
      return { kind: 'idle' };
  }
}

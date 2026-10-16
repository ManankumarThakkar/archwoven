import type { ViewType } from '@archwoven/model';

/** Real generation stages surfaced by /api/jobs polling (queued = §15 concurrency slot). */
export const STAGES = ['queued', 'validating', 'generating', 'fetching', 'extracting', 'designing', 'validating-output', 'laying-out', 'saving'] as const;
export type Stage = (typeof STAGES)[number];

export type Mode = 'describe' | 'repo';

export type WorkspaceState =
  | { kind: 'idle'; mode?: Mode; prefill?: { prompt?: string; view?: ViewType; url?: string; subdir?: string; ref?: string } }
  | { kind: 'clarifying'; questions: string[] }
  | { kind: 'running'; stage: Stage }
  | { kind: 'success'; modelId: string; revision: number }
  | { kind: 'partial'; modelId: string; revision: number; gaps: string[] }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' }
  | { kind: 'stale'; latestRevision: number }
  | { kind: 'quota-blocked'; reason: string; resetAt: number; message: string }
  | { kind: 'paused'; message: string };

export type Event =
  | { type: 'GENERATE' }
  | { type: 'RESTORED'; modelId: string; revision: number; gaps: string[] }
  | { type: 'RESTORE_FAILED'; message: string }
  | { type: 'CLARIFY'; questions: string[] }
  | { type: 'STAGE'; stage: Stage }
  | { type: 'SUCCESS'; modelId: string; revision: number }
  | { type: 'PARTIAL'; modelId: string; revision: number; gaps: string[] }
  | { type: 'ERROR'; message: string }
  | { type: 'CANCEL' }
  | { type: 'STALE'; latestRevision: number }
  | { type: 'REBASE'; modelId: string; revision: number }
  | { type: 'QUOTA_BLOCKED'; reason: string; resetAt: number; message: string }
  | { type: 'PAUSE'; message: string }
  | { type: 'EXAMPLE_SELECT'; prompt: string; view: ViewType }
  | { type: 'MODE'; mode: Mode }
  | { type: 'REPO_SELECT'; url: string; subdir?: string; ref?: string }
  | { type: 'GENERATE_REPO' }
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
    case 'RESTORED':
      return event.gaps.length
        ? { kind: 'partial', modelId: event.modelId, revision: event.revision, gaps: event.gaps }
        : { kind: 'success', modelId: event.modelId, revision: event.revision };
    case 'RESTORE_FAILED':
      return { kind: 'error', message: event.message };
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
    // A 409 rebase keeps the user working: show the latest model, don't blank the canvas.
    case 'REBASE':
      return { kind: 'success', modelId: event.modelId, revision: event.revision };
    case 'QUOTA_BLOCKED':
      return { kind: 'quota-blocked', reason: event.reason, resetAt: event.resetAt, message: event.message };
    case 'PAUSE':
      return { kind: 'paused', message: event.message };
    case 'EXAMPLE_SELECT':
      return { kind: 'idle', mode: state.kind === 'idle' ? state.mode : undefined, prefill: { ...(state.kind === 'idle' ? state.prefill : undefined), prompt: event.prompt, view: event.view } };
    // Mode switch preserves both drafts independently — switching never drops what the other mode holds.
    case 'MODE':
      return state.kind === 'running' ? state : { kind: 'idle', mode: event.mode, prefill: state.kind === 'idle' ? state.prefill : undefined };
    // Repo chips prefill URL/subdir/ref only — never auto-generate (scenario 1 parity).
    case 'REPO_SELECT':
      return state.kind === 'running' ? state : { kind: 'idle', mode: 'repo', prefill: { ...(state.kind === 'idle' ? state.prefill : undefined), url: event.url, subdir: event.subdir, ref: event.ref } };
    case 'GENERATE_REPO':
      return running('queued');
    case 'RESET':
      return { kind: 'idle' };
  }
}

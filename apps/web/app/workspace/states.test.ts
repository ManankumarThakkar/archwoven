import { describe, expect, it } from 'vitest';
import { next, initial, STAGES } from './states';
import type { Event, WorkspaceState } from './states';

const run = (events: Event[]): WorkspaceState => events.reduce(next, initial);

describe('workspace state machine', () => {
  it('generate walks every stage in order then succeeds', () => {
    let s = next(initial, { type: 'GENERATE' });
    expect(s).toEqual({ kind: 'running', stage: 'validating' });
    for (const stage of ['generating', 'validating-output', 'laying-out'] as const) {
      s = next(s, { type: 'STAGE', stage });
      expect(s).toEqual({ kind: 'running', stage });
    }
    expect(STAGES).toEqual(['validating', 'generating', 'validating-output', 'laying-out']);
    s = next(s, { type: 'SUCCESS', modelId: 'm1', revision: 1 });
    expect(s).toEqual({ kind: 'success', modelId: 'm1', revision: 1 });
  });

  it('quota-blocked carries the reset countdown data', () => {
    const resetAt = Date.now() + 3_600_000;
    const s = run([{ type: 'QUOTA_BLOCKED', reason: 'credits-exhausted', resetAt }]);
    expect(s).toEqual({ kind: 'quota-blocked', reason: 'credits-exhausted', resetAt });
  });

  it('example click fills input but never enters running (scenario 1)', () => {
    const s = run([{ type: 'EXAMPLE_SELECT', prompt: 'E-commerce platform', view: 'architecture' }]);
    expect(s.kind).toBe('idle');
    expect(s.kind === 'idle' && s.prefill).toEqual({ prompt: 'E-commerce platform', view: 'architecture' });
  });

  it('partial carries the open gaps forward', () => {
    const s = run([
      { type: 'GENERATE' },
      { type: 'PARTIAL', modelId: 'm1', revision: 1, gaps: ['repo→datastore mapping not statically provable'] },
    ]);
    expect(s).toEqual({ kind: 'partial', modelId: 'm1', revision: 1, gaps: ['repo→datastore mapping not statically provable'] });
  });

  it('cancel from running stops; stale from success flags rebase', () => {
    expect(run([{ type: 'GENERATE' }, { type: 'CANCEL' }])).toEqual({ kind: 'cancelled' });
    const ok = run([{ type: 'GENERATE' }, { type: 'SUCCESS', modelId: 'm1', revision: 3 }]);
    expect(next(ok, { type: 'STALE', latestRevision: 5 })).toEqual({ kind: 'stale', latestRevision: 5 });
  });

  it('reset returns to idle from any terminal state', () => {
    expect(run([{ type: 'QUOTA_BLOCKED', reason: 'burst', resetAt: 1 }, { type: 'RESET' }])).toEqual({ kind: 'idle' });
  });
});

import { describe, expect, it } from 'vitest';
import { next, initial, STAGES } from './states';
import type { Event, WorkspaceState } from './states';

const run = (events: Event[]): WorkspaceState => events.reduce(next, initial);

describe('workspace state machine', () => {
  it('generate walks every stage in order then succeeds', () => {
    let s = next(initial, { type: 'GENERATE' });
    expect(s).toEqual({ kind: 'running', stage: 'validating' });
    for (const stage of ['generating', 'validating-output', 'laying-out', 'saving'] as const) {
      s = next(s, { type: 'STAGE', stage });
      expect(s).toEqual({ kind: 'running', stage });
    }
    expect(STAGES).toEqual(['queued', 'validating', 'generating', 'validating-output', 'laying-out', 'saving']);
    // a queued job (concurrency cap) re-enters running at the queued stage
    s = next(next(initial, { type: 'GENERATE' }), { type: 'STAGE', stage: 'queued' });
    expect(s).toEqual({ kind: 'running', stage: 'queued' });
    s = next(s, { type: 'SUCCESS', modelId: 'm1', revision: 1 });
    expect(s).toEqual({ kind: 'success', modelId: 'm1', revision: 1 });
  });

  it('quota-blocked carries the reset countdown and the honest server copy', () => {
    const resetAt = Date.now() + 3_600_000;
    const s = run([{ type: 'QUOTA_BLOCKED', reason: 'credits-exhausted', resetAt, message: "You've used today's free generations — resets in 1h 0m. Sign in with GitHub for 30/day." }]);
    expect(s.kind).toBe('quota-blocked');
    if (s.kind === 'quota-blocked') {
      expect(s.reason).toBe('credits-exhausted');
      expect(s.resetAt).toBe(resetAt);
      expect(s.message).toMatch(/resets in/);
    }
  });

  it('every stage renders a real label — never "undefined"', () => {
    const labels: Record<string, string> = {
      queued: 'Queued', validating: 'Validating', generating: 'Designing',
      'validating-output': 'Checking', 'laying-out': 'Arranging', saving: 'Saving',
    };
    for (const stage of STAGES) {
      expect(labels[stage], `label for ${stage}`).toBeTruthy();
    }
  });

  it('a 409 rebase returns to success with the latest model instead of hiding the canvas', () => {
    const s = run([
      { type: 'GENERATE' },
      { type: 'SUCCESS', modelId: 'm1', revision: 2 },
      { type: 'REBASE', modelId: 'm1', revision: 5 },
    ]);
    expect(s).toEqual({ kind: 'success', modelId: 'm1', revision: 5 });
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
    expect(run([{ type: 'QUOTA_BLOCKED', reason: 'burst', resetAt: 1, message: 'Slow down a touch' }, { type: 'RESET' }])).toEqual({ kind: 'idle' });
  });
});

'use client';

import { useReducer } from 'react';
import type { ViewType } from '@archwoven/model';
import { initial, next } from './states';
import type { Event, Stage } from './states';
import { ControlPanel } from './ControlPanel';

const STAGE_LABEL: Record<Stage, string> = {
  validating: 'Validating your description',
  generating: 'Designing the architecture',
  'validating-output': 'Checking the model',
  'laying-out': 'Arranging the diagram',
};

export default function WorkspacePage() {
  const [state, dispatch] = useReducer(next, initial);
  const remaining = 6; // real remaining is wired in Task 9 (quota ladder)

  const poll = async (jobId: string) => {
    for (;;) {
      const res = await fetch(`/api/jobs/${jobId}`);
      const job = (await res.json()) as { status: string; stage?: Stage | null; modelId: string; revision: number; error?: string | null };
      if (job.status === 'running' && job.stage) { dispatch({ type: 'STAGE', stage: job.stage }); await new Promise((r) => setTimeout(r, 400)); continue; }
      if (job.status === 'succeeded') { dispatch({ type: 'SUCCESS', modelId: job.modelId, revision: job.revision }); return; }
      dispatch({ type: 'ERROR', message: job.error ?? 'generation failed' });
      return;
    }
  };

  const generate = async (prompt: string, view: ViewType) => {
    dispatch({ type: 'GENERATE' });
    const res = await fetch('/api/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, view, idempotencyKey: crypto.randomUUID() }),
    });
    if (res.status === 429) {
      const q = (await res.json()) as { reason: string; resetAt?: number };
      dispatch({ type: 'QUOTA_BLOCKED', reason: q.reason, resetAt: q.resetAt ?? Date.now() + 60_000 });
      return;
    }
    if (!res.ok) { dispatch({ type: 'ERROR', message: (await res.text()) || 'request failed' }); return; }
    const { jobId } = (await res.json()) as { jobId: string };
    void poll(jobId);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#070b14', color: '#e5e7eb' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #1f2937' }}>
        <strong style={{ fontSize: '1.1rem' }}>Arch<span style={{ color: '#5eead4' }}>woven</span></strong>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#111a2e', color: '#93c5fd' }}>🔒 private · external-allowed</span>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#111a2e', color: '#fbbf24' }}>◐ {remaining}/6 credits today</span>
      </header>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <ControlPanel running={state.kind === 'running'} remaining={remaining} onGenerate={generate} />
        <main style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24, color: '#8b98b8' }}>
          <CanvasPlaceholder state={state} onReset={() => dispatch({ type: 'RESET' })} />
        </main>
      </div>
    </div>
  );
}

function CanvasPlaceholder({ state, onReset }: { state: ReturnType<typeof next>; onReset: () => void }) {
  if (state.kind === 'running') return <div style={{ textAlign: 'center' }}><div style={{ fontSize: '1.2rem', marginBottom: 8 }}>{STAGE_LABEL[state.stage]}…</div><div style={{ fontSize: 12 }}>stage: {state.stage}</div></div>;
  if (state.kind === 'quota-blocked') {
    const mins = Math.max(0, Math.round((state.resetAt - Date.now()) / 60_000));
    return <div style={{ textAlign: 'center', maxWidth: 360 }}>
      <div style={{ fontSize: '1.1rem', color: '#fbbf24', marginBottom: 8 }}>Daily free generations used up</div>
      <div>Resets in {Math.floor(mins / 60)}h {mins % 60}m. Sign in with GitHub for 30/day.</div>
      <button onClick={onReset} style={{ marginTop: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' }}>Start over</button>
    </div>;
  }
  if (state.kind === 'error') return <div style={{ textAlign: 'center', color: '#f87171' }}>Something went wrong: {state.message}<div><button onClick={onReset} style={{ marginTop: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' }}>Try again</button></div></div>;
  if (state.kind === 'success' || state.kind === 'partial') return <div style={{ textAlign: 'center' }}>Model ready (rev {state.revision}). Canvas + inspector arrive in the next milestone.{state.kind === 'partial' && <div style={{ color: '#fbbf24', marginTop: 8, fontSize: 12 }}>{state.gaps.join(' · ')}</div>}</div>;
  if (state.kind === 'cancelled') return <div>Cancelled. <button onClick={onReset} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' }}>Reset</button></div>;
  if (state.kind === 'stale') return <div style={{ color: '#fbbf24' }}>This diagram changed elsewhere (latest rev {state.latestRevision}). Reload to continue.</div>;
  if (state.kind === 'clarifying') return <div>A few clarifying questions: {state.questions.join(' · ')}</div>;
  if (state.kind === 'paused') return <div>Paused: {state.message}</div>;
  return <div>Pick an example or describe a system to begin.</div>;
}

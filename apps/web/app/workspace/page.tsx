'use client';

import { useReducer, useState } from 'react';
import type { EditOp, SystemModel, ViewType } from '@archwoven/model';
import { initial, next } from './states';
import type { Stage } from './states';
import { ControlPanel } from './ControlPanel';
import { Canvas } from './Canvas';
import { Inspector } from './InspectorPanel';
import { inspectorFor } from './inspector';
import { RefineBar } from './RefineBar';
import { summarizeOps, pushHistory, undo } from './refine-flow';
import { buildSvg } from '../../lib/export-svg';

const STAGE_LABEL: Record<Stage, string> = {
  validating: 'Validating your description',
  generating: 'Designing the architecture',
  'validating-output': 'Checking the model',
  'laying-out': 'Arranging the diagram',
};

export default function WorkspacePage() {
  const [state, dispatch] = useReducer(next, initial);
  const [model, setModel] = useState<SystemModel | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<SystemModel[]>([]);
  const [summary, setSummary] = useState('');
  const [refining, setRefining] = useState(false);
  const [activeView, setActiveView] = useState<string>('');
  const remaining = 6; // real remaining is wired in Task 9 (quota ladder)

  const loadModel = async (id: string) => {
    const res = await fetch(`/api/models/${id}`);
    if (res.ok) { const m = (await res.json()).model as SystemModel; setModel(m); setHistory([m]); setActiveView(m.views[0]?.id ?? ''); }
  };

  const poll = async (jobId: string) => {
    for (;;) {
      const res = await fetch(`/api/jobs/${jobId}`);
      const job = (await res.json()) as { status: string; stage?: Stage | null; modelId: string; revision: number; error?: string | null };
      if (job.status === 'running' && job.stage) { dispatch({ type: 'STAGE', stage: job.stage }); await new Promise((r) => setTimeout(r, 400)); continue; }
      if (job.status === 'succeeded') { setModelId(job.modelId); dispatch({ type: 'SUCCESS', modelId: job.modelId, revision: job.revision }); void loadModel(job.modelId); return; }
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

  const refine = async (instruction: string) => {
    if (!model || !modelId) return;
    setRefining(true);
    try {
      const res = await fetch('/api/refine', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId, baseRevision: model.revision, instruction, view: model.views.find((v) => v.id === activeView)?.type ?? 'architecture' }),
      });
      if (res.status === 409) { const b = (await res.json()) as { model: SystemModel }; setModel(b.model); dispatch({ type: 'STALE', latestRevision: b.model.revision }); return; }
      if (res.status === 429) { const q = (await res.json()) as { reason: string; resetAt?: number }; dispatch({ type: 'QUOTA_BLOCKED', reason: q.reason, resetAt: q.resetAt ?? Date.now() + 60_000 }); return; }
      if (!res.ok) { dispatch({ type: 'ERROR', message: (await res.text()) || 'refine failed' }); return; }
      const { ops, model: nextModel } = (await res.json()) as { ops: EditOp[]; model: SystemModel };
      setHistory((h) => pushHistory(h, model));
      setModel(nextModel);
      setSummary(summarizeOps(ops));
    } finally {
      setRefining(false);
    }
  };

  const doUndo = () => {
    const { model: prev, stack } = undo(history);
    if (prev) { setModel(prev); setHistory(stack); setSummary(''); setSelected(null); }
  };

  const doExport = async (kind: 'svg' | 'png') => {
    if (!model || !activeView) return;
    const svg = await buildSvg(model, activeView);
    let blob = new Blob([svg], { type: 'image/svg+xml' });
    if (kind === 'png') {
      try {
        const { ensureResvg, renderPng } = await import('../../probes/render/export');
        await ensureResvg(fetch('/resvg/index_bg.wasm').then((r) => r.arrayBuffer()));
        const png = await renderPng(svg, []);
        blob = new Blob([png as unknown as BlobPart], { type: 'image/png' });
      } catch { /* fonts/wasm unavailable → fall back to SVG */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `archwoven-${activeView}.${kind === 'png' ? 'png' : 'svg'}`; a.click();
    URL.revokeObjectURL(url);
  };

  const showCanvas = (state.kind === 'success' || state.kind === 'partial') && model;
  const viewTabs = model?.views ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#070b14', color: '#e5e7eb' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #1f2937' }}>
        <strong style={{ fontSize: '1.1rem' }}>Arch<span style={{ color: '#5eead4' }}>woven</span></strong>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#111a2e', color: '#93c5fd' }}>🔒 private · external-allowed</span>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#111a2e', color: '#fbbf24' }}>◐ {remaining}/6 credits today</span>
      </header>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <ControlPanel running={state.kind === 'running'} remaining={remaining} onGenerate={generate} />
        {showCanvas ? (
          <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 5, display: 'flex', gap: 6 }}>
              {viewTabs.map((v) => (
                <button key={v.id} onClick={() => setActiveView(v.id)} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid ' + (v.id === activeView ? '#5eead4' : '#1f2937'), background: v.id === activeView ? '#0f2e2b' : '#111a2e', color: '#cbd5e1', cursor: 'pointer' }}>{v.type}</button>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}><Canvas model={model} viewId={activeView || viewTabs[0]?.id || ''} onSelect={setSelected} /></div>
            <RefineBar busy={refining} summary={summary} canUndo={history.length > 1} onRefine={refine} onUndo={doUndo} onExport={doExport} />
          </main>
        ) : (
          <main style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24, color: '#8b98b8' }}>
            <CanvasPlaceholder state={state} onReset={() => dispatch({ type: 'RESET' })} />
          </main>
        )}
        {showCanvas && <Inspector payload={selected ? inspectorFor(model, selected) : null} />}
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

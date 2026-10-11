'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import type { EditOp, SystemModel, ViewType } from '@archwoven/model';
import { initial, next } from './states';
import type { Mode, Stage } from './states';
import { ControlPanel, type RepoForm } from './ControlPanel';
import { Canvas } from './Canvas';
import { Inspector } from './InspectorPanel';
import { inspectorFor } from './inspector';
import { RefineBar } from './RefineBar';
import { summarizeOps, pushHistory, undo, idempotencyKeyFor } from './refine-flow';
import { buildSvg } from '../../lib/export-svg';

const STAGE_LABEL: Record<Stage, string> = {
  queued: 'Queued for a free slot',
  validating: 'Validating your description',
  generating: 'Designing the architecture',
  fetching: 'Fetching the repository',
  extracting: 'Reading the code',
  designing: 'Designing the architecture',
  'validating-output': 'Checking the model',
  'laying-out': 'Arranging the diagram',
  saving: 'Saving your diagram',
};

const QUOTA_TITLE: Record<string, string> = {
  'credits-exhausted': 'Daily free generations used up',
  burst: 'Too many at once',
  'stop-loss': 'Generations paused for today',
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
  const [remaining, setRemaining] = useState<number | null>(null);
  const [pool, setPool] = useState(6);
  const [fake, setFake] = useState(false);
  const [deploy, setDeploy] = useState<'hosted' | 'local'>('hosted');
  const [queuedPos, setQueuedPos] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('describe');
  const modelIdRef = useRef<string | null>(null);
  const jobIdRef = useRef<string | null>(null);

  const rememberModel = (id: string) => {
    modelIdRef.current = id;
    if (typeof window !== 'undefined') sessionStorage.setItem('aw_modelId', id);
  };

  const loadModel = async (id: string) => {
    const res = await fetch(`/api/models/${id}`);
    if (res.ok) {
      const m = (await res.json()).model as SystemModel;
      setModel(m);
      setHistory([m]);
      setActiveView((v) => v || m.views[0]?.id || '');
      rememberModel(id);
    }
  };

  // Restore the last model after a reload without spending a fresh credit.
  useEffect(() => {
    void (async () => {
      const q = await fetch('/api/quota').then((r) => r.json()).catch(() => null);
      if (q) { setRemaining(q.remaining); setPool(q.pool); setFake(q.fake); }
      const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => null);
      if (cfg?.mode === 'local' || cfg?.mode === 'hosted') setDeploy(cfg.mode);
      const saved = sessionStorage.getItem('aw_modelId');
      if (saved) void loadModel(saved);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const poll = async (jobId: string) => {
    const deadline = Date.now() + 120_000;
    let misses = 0;
    for (;;) {
      let job: { status: string; stage?: Stage | null; modelId: string; revision: number; queuePosition?: number | null; gaps?: string[]; error?: string | null } | null = null;
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (res.status === 404) { dispatch({ type: 'ERROR', message: 'This generation no longer exists — please try again.' }); return; }
        job = await res.json();
        misses = 0;
      } catch {
        if (++misses >= 5) { dispatch({ type: 'ERROR', message: 'Connection lost — your diagram may still finish; reload to check.' }); return; }
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      if (!job) continue;
      if (job.status === 'queued') {
        setQueuedPos(job.queuePosition ?? null);
        dispatch({ type: 'STAGE', stage: 'queued' });
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      if (job.status === 'running') {
        setQueuedPos(null);
        if (job.stage) dispatch({ type: 'STAGE', stage: job.stage });
        if (Date.now() > deadline) { dispatch({ type: 'ERROR', message: 'This is taking longer than expected — try again in a moment.' }); return; }
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      if (job.status === 'cancelled') { setQueuedPos(null); dispatch({ type: 'CANCEL' }); return; }
      if (job.status === 'succeeded') {
        setQueuedPos(null);
        setModelId(job.modelId);
        if (job.gaps && job.gaps.length > 0) dispatch({ type: 'PARTIAL', modelId: job.modelId, revision: job.revision, gaps: job.gaps });
        else dispatch({ type: 'SUCCESS', modelId: job.modelId, revision: job.revision });
        void loadModel(job.modelId);
        return;
      }
      dispatch({ type: 'ERROR', message: job.error ?? 'generation failed' });
      return;
    }
  };

  const generate = async (prompt: string, view: ViewType) => {
    dispatch({ type: 'GENERATE' });
    const res = await fetch('/api/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, view, idempotencyKey: idempotencyKeyFor(prompt, view) }),
    });
    if (res.status === 429) {
      const q = (await res.json()) as { reason: string; message?: string; resetAt?: number };
      dispatch({ type: 'QUOTA_BLOCKED', reason: q.reason, resetAt: q.resetAt ?? Date.now() + 60_000, message: q.message ?? '' });
      return;
    }
    if (!res.ok) { dispatch({ type: 'ERROR', message: (await res.text()) || 'request failed' }); return; }
    const { jobId, remaining } = (await res.json()) as { jobId: string; remaining?: number };
    if (typeof remaining === 'number') setRemaining(remaining);
    jobIdRef.current = jobId;
    void poll(jobId);
  };

  const generateRepo = async (form: RepoForm) => {
    dispatch({ type: 'GENERATE_REPO' });
    const res = await fetch('/api/repo', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, view: 'architecture', idempotencyKey: idempotencyKeyFor(`${form.url}|${form.subdir ?? ''}|${form.ref ?? ''}`, 'architecture') }),
    });
    if (res.status === 429) {
      const q = (await res.json()) as { reason: string; message?: string; resetAt?: number };
      dispatch({ type: 'QUOTA_BLOCKED', reason: q.reason, resetAt: q.resetAt ?? Date.now() + 60_000, message: q.message ?? '' });
      return;
    }
    if (!res.ok) { dispatch({ type: 'ERROR', message: (await res.text()) || 'request failed' }); return; }
    const { jobId, remaining } = (await res.json()) as { jobId: string; remaining?: number };
    if (typeof remaining === 'number') setRemaining(remaining);
    jobIdRef.current = jobId;
    void poll(jobId);
  };

  const cancelJob = async () => {
    const id = jobIdRef.current;
    if (!id) return;
    await fetch(`/api/jobs/${id}/cancel`, { method: 'POST' }).catch(() => undefined);
    // the poll observes `cancelled` and dispatches CANCEL — no double transition here
  };

  const refine = async (instruction: string) => {
    if (!model || !modelId) return;
    setRefining(true);
    try {
      const res = await fetch('/api/refine', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId, baseRevision: model.revision, instruction, view: model.views.find((v) => v.id === activeView)?.type ?? 'architecture' }),
      });
      if (res.status === 409) {
        const b = (await res.json()) as { model: SystemModel };
        setModel(b.model);
        setHistory([b.model]);
        setSummary('The diagram changed elsewhere — showing the latest version.');
        dispatch({ type: 'REBASE', modelId, revision: b.model.revision });
        return;
      }
      if (res.status === 429) {
        const q = (await res.json()) as { reason: string; message?: string; resetAt?: number };
        dispatch({ type: 'QUOTA_BLOCKED', reason: q.reason, resetAt: q.resetAt ?? Date.now() + 60_000, message: q.message ?? '' });
        return;
      }
      if (!res.ok) { dispatch({ type: 'ERROR', message: (await res.text()) || 'refine failed' }); return; }
      const { ops, model: nextModel, remaining } = (await res.json()) as { ops: EditOp[]; model: SystemModel; remaining?: number };
      setHistory((h) => pushHistory(h, model));
      setModel(nextModel);
      setSummary(summarizeOps(ops));
      if (typeof remaining === 'number') setRemaining(remaining);
    } finally {
      setRefining(false);
    }
  };

  const doUndo = async () => {
    const { model: prev, stack } = undo(history);
    if (!prev || !modelId) return;
    const res = await fetch(`/api/models/${modelId}/undo`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prevRevision: prev.revision }),
    });
    if (!res.ok) { dispatch({ type: 'ERROR', message: (await res.text()) || 'undo failed' }); return; }
    const { model: undone } = (await res.json()) as { model: SystemModel };
    setModel(undone);
    setHistory(stack);
    setSummary('');
    setSelected(null);
  };

  const doExport = async (kind: 'svg' | 'png') => {
    if (!model || !activeView) return;
    const svg = await buildSvg(model, activeView);
    let blob = new Blob([svg], { type: 'image/svg+xml' });
    let ext = 'svg';
    if (kind === 'png') {
      try {
        const { ensureResvg, renderPng } = await import('../../probes/render/export');
        await ensureResvg(fetch('/resvg/index_bg.wasm').then((r) => r.arrayBuffer()));
        const png = await renderPng(svg, []);
        blob = new Blob([png as unknown as BlobPart], { type: 'image/png' });
        ext = 'png';
      } catch { /* fonts/wasm unavailable → fall back to SVG, honestly named */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `archwoven-${activeView}.${ext}`; a.click();
    URL.revokeObjectURL(url);
  };

  const showCanvas = (state.kind === 'success' || state.kind === 'partial') && model;
  const viewTabs = model?.views ?? [];
  // Pre-model chip states the deployment's processing location — never a hardcoded claim.
  const privacy = model ? `🔒 ${model.privacy.classification} · ${model.privacy.boundary}` : `🔒 ${deploy === 'local' ? 'private · local-only' : 'public · external-allowed'}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#070b14', color: '#e5e7eb' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #1f2937' }}>
        <strong style={{ fontSize: '1.1rem' }}>Arch<span style={{ color: '#5eead4' }}>woven</span></strong>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#111a2e', color: '#93c5fd' }}>{privacy}</span>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#111a2e', color: '#fbbf24' }}>◐ {remaining ?? pool}/{pool} credits today</span>
        {fake && <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#3b0d0d', color: '#fca5a5' }}>DEMO DATA</span>}
        {state.kind === 'partial' && state.gaps.length > 0 && (
          <span title={state.gaps.join('\n')} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#3b2f0d', color: '#fbbf24' }}>⚠ {state.gaps.length} gaps</span>
        )}
      </header>
      <div className="workspace-shell" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <ControlPanel
          running={state.kind === 'running'}
          remaining={remaining ?? pool}
          mode={mode}
          prefill={state.kind === 'idle' ? state.prefill : undefined}
          onMode={(m) => { setMode(m); dispatch({ type: 'MODE', mode: m }); }}
          onGenerate={generate}
          onGenerateRepo={generateRepo}
          onRepoExample={(url, ref) => dispatch({ type: 'REPO_SELECT', url, ref })}
          onCancel={cancelJob}
        />
        {showCanvas ? (
          <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 5, display: 'flex', gap: 6 }}>
              {viewTabs.map((v) => (
                <button key={v.id} onClick={() => setActiveView(v.id)} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid ' + (v.id === activeView ? '#5eead4' : '#1f2937'), background: v.id === activeView ? '#0f2e2b' : '#111a2e', color: '#cbd5e1', cursor: 'pointer' }}>{v.type}</button>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}><Canvas model={model} modelId={modelId ?? ''} viewId={activeView || viewTabs[0]?.id || ''} onSelect={setSelected} /></div>
            <RefineBar busy={refining} summary={summary} canUndo={history.length > 1} onRefine={refine} onUndo={doUndo} onExport={doExport} />
          </main>
        ) : (
          <main style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24, color: '#8b98b8' }}>
            <CanvasPlaceholder state={state} queuedPos={queuedPos} onReset={() => dispatch({ type: 'RESET' })} />
          </main>
        )}
        {showCanvas && <Inspector payload={selected ? inspectorFor(model, selected) : null} gaps={state.kind === 'partial' ? state.gaps : undefined} />}
      </div>
    </div>
  );
}

function CanvasPlaceholder({ state, queuedPos, onReset }: { state: ReturnType<typeof next>; queuedPos: number | null; onReset: () => void }) {
  if (state.kind === 'running') {
    const label = STAGE_LABEL[state.stage] ?? state.stage;
    return <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '1.2rem', marginBottom: 8 }}>{label}…</div>
      {state.stage === 'queued' && queuedPos !== null && <div style={{ fontSize: 12 }}>queue position: {queuedPos}</div>}
      <div style={{ fontSize: 12 }}>stage: {state.stage}</div>
    </div>;
  }
  if (state.kind === 'quota-blocked') {
    const mins = state.resetAt ? Math.max(0, Math.round((state.resetAt - Date.now()) / 60_000)) : null;
    return <div style={{ textAlign: 'center', maxWidth: 360 }}>
      <div style={{ fontSize: '1.1rem', color: '#fbbf24', marginBottom: 8 }}>{QUOTA_TITLE[state.reason] ?? 'Generations paused'}</div>
      <div>{state.message || (mins !== null ? `Resets in ${Math.floor(mins / 60)}h ${mins % 60}m.` : 'Please try again later.')}</div>
      <button onClick={onReset} style={{ marginTop: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' }}>Start over</button>
    </div>;
  }
  if (state.kind === 'error') return <div style={{ textAlign: 'center', color: '#f87171' }}>Something went wrong: {state.message}<div><button onClick={onReset} style={{ marginTop: 12, padding: '6px 12px', borderRadius: '8px', border: '1px solid #334155', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' }}>Try again</button></div></div>;
  if (state.kind === 'success' || state.kind === 'partial') return <div style={{ textAlign: 'center' }}>Model ready (rev {state.revision}). Canvas + inspector arrive in the next milestone.{state.kind === 'partial' && <div style={{ color: '#fbbf24', marginTop: 8, fontSize: 12 }}>{state.gaps.join(' · ')}</div>}</div>;
  if (state.kind === 'cancelled') return <div>Cancelled. <button onClick={onReset} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' }}>Reset</button></div>;
  if (state.kind === 'stale') return <div style={{ color: '#fbbf24' }}>This diagram changed elsewhere (latest rev {state.latestRevision}). Reload to continue.</div>;
  if (state.kind === 'clarifying') return <div>A few clarifying questions: {state.questions.join(' · ')}</div>;
  if (state.kind === 'paused') return <div>Paused: {state.message}</div>;
  return <div>Pick an example or describe a system to begin.</div>;
}

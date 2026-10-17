'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import type { EditOp, SystemModel, ViewType } from '@archwoven/model';
import { SystemModelSchema } from '@archwoven/model';
import { initial, next } from './states';
import type { Mode, Stage } from './states';
import { ControlPanel, type RepoForm } from './ControlPanel';
import { Canvas } from './Canvas';
import { ClarificationPanel } from './ClarificationPanel';
import { Inspector } from './InspectorPanel';
import { inspectorFor } from './inspector';
import { passportFor } from './passport';
import { RefineBar } from './RefineBar';
import { summarizeOps, pushHistory, undo, idempotencyKeyFor } from './refine-flow';
import { buildSvg } from '../../lib/export-svg';
import type { DirectEdit } from '../../lib/direct-edit';

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

async function responseMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown; errors?: unknown };
    if (typeof body.message === 'string' && body.message) return body.message;
    if (typeof body.error === 'string' && body.error) return body.error;
    if (Array.isArray(body.errors)) {
      const messages = body.errors.filter((error): error is string => typeof error === 'string');
      if (messages.length) return messages.join('; ');
    }
    return fallback;
  } catch {
    return text && !text.trimStart().startsWith('<') ? text : fallback;
  }
}

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
  const [llmReady, setLlmReady] = useState(true);
  const [queuedPos, setQueuedPos] = useState<number | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('describe');
  const [restoring, setRestoring] = useState(true);
  const loadSequence = useRef(0);
  const jobIdRef = useRef<string | null>(null);
  const mutationRef = useRef(false);
  const generationRef = useRef(false);
  const [clarification, setClarification] = useState<{ jobId: string; questions: string[]; preferredView?: ViewType } | null>(null);

  const rememberModel = (id: string) => {
    try { sessionStorage.setItem('aw_modelId', id); } catch { /* storage can be disabled */ }
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.has('model') && hash.get('model') !== id) {
      for (const key of ['focus', 'lens', 'route', 'chapter', 'relation', 'view']) hash.delete(key);
    }
    hash.set('model', id);
    window.history.replaceState(null, '', `#${hash}`);
  };

  const loadModel = async (id: string, gaps?: string[], preferredView?: ViewType) => {
    const sequence = ++loadSequence.current;
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(res.status === 404
        ? 'This saved diagram is unavailable in this browser session. Open it in the browser that created it, or create a new diagram.'
        : 'Could not open the saved diagram. Check your connection and reload.');
      const m = SystemModelSchema.parse((await res.json()).model);
      if (sequence !== loadSequence.current) return;
      const hashView = new URLSearchParams(window.location.hash.slice(1)).get('view');
      setModel(m);
      setModelId(id);
      setHistory([m]);
      setSelected(null);
      const chosen = (preferredView ? m.views.find(v => v.type === preferredView) : m.views.find(v => v.id === hashView))?.id ?? m.views[0]?.id ?? '';
      setActiveView(chosen);
      rememberModel(id);
      const hash = new URLSearchParams(window.location.hash.slice(1));
      if (chosen) hash.set('view', chosen);
      window.history.replaceState(null, '', `#${hash}`);
      dispatch({ type: 'RESTORED', modelId: id, revision: m.revision, gaps: [...new Set([...(gaps ?? []), ...m.openQuestions.map((q) => q.text)])] });
      return true;
    } catch (err) {
      if (sequence !== loadSequence.current) return;
      dispatch({ type: 'RESTORE_FAILED', message: err instanceof Error ? err.message : 'Could not open the saved diagram. Reload to try again.' });
    }
  };

  // Restore the last model after a reload without spending a fresh credit.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const q = await fetch('/api/quota').then((r) => r.json()).catch(() => null);
      if (q) { setRemaining(q.remaining); setPool(q.pool); setFake(q.fake); }
      const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => null);
      if (cfg?.mode === 'local' || cfg?.mode === 'hosted') setDeploy(cfg.mode);
      if (typeof cfg?.fake === 'boolean') setFake(cfg.fake);
      if (cfg?.llmReady === false) setLlmReady(false);
      if (cancelled) return;
      const hash = new URLSearchParams(window.location.hash.slice(1));
      let saved: string | null = null;
      try { saved = sessionStorage.getItem('aw_modelId'); } catch { /* permalink still works */ }
      const id = hash.get('model') || saved;
      if (id) await loadModel(id);
      else if (['focus', 'lens', 'route', 'chapter', 'relation'].some((key) => hash.has(key))) {
        dispatch({ type: 'RESTORE_FAILED', message: 'This link does not include a saved diagram. Open the original diagram and copy its full address, or create a new diagram.' });
      }
      setRestoring(false);
    })();
    return () => { cancelled = true; ++loadSequence.current; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const poll = async (jobId: string, preferredView?: ViewType) => {
    let runningSince: number | null = null;
    let misses = 0;
    for (;;) {
      let job: { status: string; stage?: Stage | null; modelId: string; revision: number; queuePosition?: number | null; deadlineAt?: number | null; gaps?: string[]; questions?: string[]; remaining?: number | null; error?: string | null } | null = null;
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
        if (res.status === 404) { dispatch({ type: 'ERROR', message: 'This generation no longer exists — please try again.' }); return; }
        if (!res.ok) throw new Error('Could not read job status');
        job = await res.json();
        if (!job || !['queued', 'running', 'cancelled', 'succeeded', 'failed', 'clarifying'].includes(job.status)
          || (job.status === 'succeeded' && (typeof job.modelId !== 'string' || !job.modelId))) {
          throw new Error('Invalid job status');
        }
        misses = 0;
      } catch {
        if (++misses >= 5) { dispatch({ type: 'ERROR', message: 'Connection lost — your diagram may still finish. Retry the same input to reconnect to the job.' }); return; }
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      if (job.status === 'queued') {
        setQueuedPos(job.queuePosition ?? null);
        dispatch({ type: 'STAGE', stage: 'queued' });
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      if (job.status === 'running') {
        runningSince ??= Date.now();
        setQueuedPos(null);
        if (job.stage) dispatch({ type: 'STAGE', stage: job.stage });
        const deadline = typeof job.deadlineAt === 'number' ? job.deadlineAt : runningSince + 180_000;
        if (Date.now() > deadline + 10_000) { dispatch({ type: 'ERROR', message: 'The server has not confirmed completion. Retry the same input to reconnect to the job.' }); return; }
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      if (job.status === 'clarifying') {
        if (!Array.isArray(job.questions) || job.questions.length < 1 || job.questions.length > 3 || job.questions.some(q => typeof q !== 'string' || !q.trim())) {
          dispatch({ type: 'ERROR', message: 'Could not read the clarification. Retry the same description to reconnect.' }); return;
        }
        setQueuedPos(null);
        if (typeof job.remaining === 'number') setRemaining(job.remaining);
        setClarification({ jobId, questions: job.questions, preferredView });
        dispatch({ type: 'CLARIFY', questions: job.questions });
        return;
      }
      if (job.status === 'cancelled') { setQueuedPos(null); dispatch({ type: 'CANCEL' }); return; }
      if (job.status === 'succeeded') {
        setQueuedPos(null);
        if (await loadModel(job.modelId, job.gaps, preferredView)) setClarification(null);
        return;
      }
      dispatch({ type: 'ERROR', message: job.error ?? 'generation failed' });
      return;
    }
  };

  const submitGeneration = async (url: string, body: object, preferredView?: ViewType) => {
    generationRef.current = true;
    jobIdRef.current = null;
    setCancelError(null);
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (res.status === 429) {
        const q = (await res.json()) as { reason: string; message?: string; resetAt?: number };
        dispatch({ type: 'QUOTA_BLOCKED', reason: q.reason, resetAt: q.resetAt ?? Date.now() + 60_000, message: q.message ?? '' });
        return;
      }
      if (!res.ok) { dispatch({ type: 'ERROR', message: await responseMessage(res, 'Could not start generation. Please try again.') }); return; }
      const { jobId, remaining } = (await res.json()) as { jobId?: unknown; remaining?: number };
      if (typeof jobId !== 'string' || !jobId) throw new Error('Missing job ID');
      if (typeof remaining === 'number') setRemaining(remaining);
      jobIdRef.current = jobId;
      await poll(jobId, preferredView);
    } catch {
      dispatch({ type: 'ERROR', message: 'Could not start generation. Check your connection and try again; retrying the same input will reconnect to any job already started.' });
    } finally { generationRef.current = false; jobIdRef.current = null; }
  };

  const generate = async (prompt: string, view: ViewType) => {
    if(mutationRef.current || generationRef.current)return;
    dispatch({ type: 'GENERATE' });
    await submitGeneration('/api/generate', { prompt, view, idempotencyKey: idempotencyKeyFor(prompt, view) }, view);
  };

  const generateRepo = async (form: RepoForm) => {
    if(mutationRef.current || generationRef.current)return;
    dispatch({ type: 'GENERATE_REPO' });
    await submitGeneration('/api/repo', { ...form, view: 'architecture', idempotencyKey: idempotencyKeyFor(`${form.url}|${form.subdir ?? ''}|${form.ref ?? ''}`, 'architecture') }, 'architecture');
  };

  const continueClarification = async (answers: string[] | null) => {
    if (!clarification || mutationRef.current || generationRef.current) return;
    dispatch({ type: 'GENERATE' });
    await submitGeneration('/api/generate', { clarification: answers === null
      ? { jobId: clarification.jobId, skip: true }
      : { jobId: clarification.jobId, answers } }, clarification.preferredView);
  };

  const cancelJob = async () => {
    const id = jobIdRef.current;
    if (!id) return;
    setCancelError(null);
    try {
      const res = await fetch(`/api/jobs/${id}/cancel`, { method: 'POST' });
      if (!res.ok) setCancelError(await responseMessage(res, 'Could not cancel. The job is still being checked; try Cancel again.'));
    } catch {
      setCancelError('Could not reach the server to cancel. The job is still being checked; try Cancel again.');
    }
    // the poll observes `cancelled` and dispatches CANCEL — no double transition here
  };

  const refine = async (instruction: string) => {
    if (!model || !modelId || mutationRef.current) return;
    mutationRef.current=true;
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
      if (!res.ok) { setSummary(await responseMessage(res, 'Refinement failed. Please try again.')); return; }
      const { ops, model: nextModel, remaining } = (await res.json()) as { ops: EditOp[]; model: SystemModel; remaining?: number };
      setHistory((h) => pushHistory(h, nextModel));
      setModel(nextModel);
      setSummary(summarizeOps(ops));
      if (typeof remaining === 'number') setRemaining(remaining);
    } catch {
      setSummary('Could not refine the diagram. Check your connection before trying again.');
    } finally {
      mutationRef.current=false;
      setRefining(false);
    }
  };

  const doUndo = async () => {
    const { model: prev, stack } = undo(history);
    if (!prev || !modelId || !model || mutationRef.current || history.length<2) return;
    mutationRef.current=true;setRefining(true);
    try {
      const res = await fetch(`/api/models/${modelId}/undo`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prevRevision: prev.revision, baseRevision:model.revision }),
      });
      if(res.status===409){const body=await res.json();setModel(body.model);setHistory([body.model]);setSummary('The diagram changed elsewhere. Review the latest version before undoing.');return;}
      if (!res.ok) { setSummary(await responseMessage(res, 'Undo failed. Please try again.')); return; }
      const { model: undone } = (await res.json()) as { model: SystemModel };
      setModel(undone);
      setHistory(stack);
      setSummary('');
      setSelected(null);
    } catch {
      setSummary('Could not undo the change. Check your connection before trying again.');
    } finally {
      mutationRef.current=false;setRefining(false);
    }
  };

  const directEdit = async(action:DirectEdit):Promise<boolean> => {
    if(!model||!modelId||mutationRef.current)return false;
    mutationRef.current=true;setRefining(true);setSummary('Saving change…');
    try {
      const response=await fetch(`/api/models/${modelId}/edit`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({baseRevision:model.revision,action})});
      if(response.status===409){const body=await response.json();const latest=SystemModelSchema.parse(body.model);setModel(latest);setHistory([latest]);setSummary('The diagram changed elsewhere. Review the latest version and try again.');return false;}
      if(!response.ok){setSummary(await responseMessage(response,'Could not save this change. Try again.'));return false;}
      const accepted=SystemModelSchema.parse((await response.json()).model);
      setModel(accepted);setHistory(h=>pushHistory(h,accepted));setSummary(action.type==='rename'?'Name saved.':'Positions saved.');return true;
    }catch{setSummary('Could not save this change. Check your connection and try again.');return false;}
    finally{mutationRef.current=false;setRefining(false);}
  };

  const doExport = async (kind: 'svg' | 'png') => {
    if (!model || !activeView) return;
    setSummary('Preparing export…');
    try {
      const svg = await buildSvg(model, activeView);
      let blob = new Blob([svg], { type: 'image/svg+xml' });
      let ext = 'svg';
      if (kind === 'png') {
        try {
          const { ensureResvg, renderPng } = await import('../../probes/render/export');
          const [wasm, ...fonts] = await Promise.all([
            '/resvg/index_bg.wasm', '/fonts/inter-400.woff2', '/fonts/inter-600.woff2',
          ].map(async (path) => {
            const res = await fetch(path);
            if (!res.ok) throw new Error(`Export asset unavailable: ${path}`);
            const bytes = new Uint8Array(await res.arrayBuffer());
            if (!bytes.byteLength) throw new Error(`Export asset empty: ${path}`);
            return bytes;
          }));
          await ensureResvg(wasm!);
          const png = await renderPng(svg, fonts);
          blob = new Blob([png as unknown as BlobPart], { type: 'image/png' });
          ext = 'png';
        } catch { /* fall back to SVG, honestly named and reported below */ }
      }
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url; a.download = `archwoven-${activeView}.${ext}`; a.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      setSummary(kind === 'png' && ext === 'svg' ? 'PNG export unavailable. Downloaded SVG instead.' : `${ext.toUpperCase()} downloaded.`);
    } catch {
      setSummary('Could not export the diagram. Please try again.');
    }
  };

  const showCanvas = (state.kind === 'success' || state.kind === 'partial') && model;
  const viewTabs = model?.views ?? [];
  const passport = model && selected ? passportFor(model, selected) : null;
  // Pre-model chip states the deployment's processing location — never a hardcoded claim.
  const privacy = model ? `🔒 ${model.privacy.classification} · ${model.privacy.boundary}` : `🔒 ${deploy === 'local' ? 'private · local-only' : 'public · external-allowed'}`;

  return (
    <div className="aw-workspace">
      <header className="aw-header">
        <a className="aw-brand" href="/workspace" aria-label="Archwoven workspace"><span className="aw-brand-mark" aria-hidden="true">⌘</span>Arch<span>woven</span></a>
        <span className="aw-header-caption">Architecture, connected.</span>
        <div className="aw-header-status">
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#111a2e', color: '#93c5fd' }}>{privacy}</span>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#111a2e', color: '#fbbf24' }}>◐ {remaining ?? pool}/{pool} credits today</span>
        {!llmReady && (
          <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#3b2f0d', color: '#fbbf24' }}>
            ⚠ No API key — set ANTHROPIC_API_KEY in apps/web/.env.local, or run locally: ARCHWOVEN_MODE=local pnpm dev
          </span>
        )}
        {state.kind === 'partial' && state.gaps.length > 0 && (
          <span title={state.gaps.join('\n')} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#3b2f0d', color: '#fbbf24' }}>⚠ {state.gaps.length} gaps</span>
        )}
        </div>
      </header>
      {fake && <div role="status" style={{ padding: '10px 16px', background: '#3b2f0d', color: '#fde68a', fontSize: 13 }}>
        Demo mode: generation and refinement return fixed sample data, not diagrams based on your input. Disable ARCHWOVEN_FAKE and configure a generation provider to create real diagrams.
      </div>}
      {cancelError && state.kind === 'running' && <div role="alert" style={{ padding: '10px 16px', color: '#fda4af' }}>{cancelError}</div>}
      <div className="workspace-shell" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <ControlPanel
          locked={refining || !!clarification}
          running={state.kind === 'running' || restoring}
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
          <main className="aw-diagram-main" aria-label="Architecture diagram">
            <div className="aw-view-tabs" role="group" aria-label="Diagram views">
              {viewTabs.map((v) => (
                <button key={v.id} aria-pressed={v.id === activeView} onClick={() => {
                  setActiveView(v.id);
                  const hash = new URLSearchParams(window.location.hash.slice(1));
                  hash.set('view', v.id);
                  window.history.replaceState(null, '', `#${hash}`);
                }}>{v.type === 'er' ? 'Data model' : v.type.replace('-', ' ')}</button>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}><Canvas model={model} modelId={modelId ?? ''} viewId={activeView || viewTabs[0]?.id || ''} busy={refining} onMove={positions=>directEdit({type:'move',positions})} onSelect={setSelected} onDeselect={() => setSelected(null)} /></div>
            <RefineBar busy={refining} summary={summary} canUndo={history.length > 1} onRefine={refine} onUndo={doUndo} onExport={doExport} />
          </main>
        ) : (
          <main className="aw-empty-main" aria-label="Diagram workspace" aria-live="polite">
            {clarification && <ClarificationPanel key={clarification.jobId} questions={clarification.questions} busy={state.kind === 'running'} onContinue={continueClarification} onEdit={() => { setClarification(null); dispatch({ type: 'RESET' }); requestAnimationFrame(() => document.getElementById('system-description')?.focus()); }} />}
            {restoring ? <div role="status">Opening your workspace…</div> : state.kind !== 'clarifying' && <CanvasPlaceholder state={state} queuedPos={queuedPos} onReset={() => { if (!clarification) dispatch({ type: 'RESET' }); }} hideReset={!!clarification} />}
            {clarification && state.kind === 'running' && <button className="aw-clarification-cancel" onClick={cancelJob}>Cancel</button>}
          </main>
        )}
        {showCanvas && <Inspector payload={selected ? inspectorFor(model, selected) : null} gaps={state.kind === 'partial' ? state.gaps : undefined} passport={passport} busy={refining} onRename={(target,label)=>{void directEdit({type:'rename',target,label});}} />}
      </div>
    </div>
  );
}

function CanvasPlaceholder({ state, queuedPos, onReset, hideReset = false }: { state: ReturnType<typeof next>; queuedPos: number | null; onReset: () => void; hideReset?: boolean }) {
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
      {!hideReset && <button onClick={onReset} style={{ marginTop: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' }}>Start over</button>}
    </div>;
  }
  if (state.kind === 'error') return <div style={{ textAlign: 'center', color: '#f87171' }}>Something went wrong: {state.message}<div>{!hideReset && <button onClick={onReset} style={{ marginTop: 12, padding: '6px 12px', borderRadius: '8px', border: '1px solid #334155', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' }}>Try again</button>}</div></div>;
  if (state.kind === 'success' || state.kind === 'partial') return <div role="status">Opening diagram revision {state.revision}…</div>;
  if (state.kind === 'cancelled') return <div>Cancelled. {!hideReset && <button onClick={onReset} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#e5e7eb', cursor: 'pointer' }}>Reset</button>}</div>;
  if (state.kind === 'stale') return <div style={{ color: '#fbbf24' }}>This diagram changed elsewhere (latest rev {state.latestRevision}). Reload to continue.</div>;
  if (state.kind === 'clarifying') return <div>A few clarifying questions: {state.questions.join(' · ')}</div>;
  if (state.kind === 'paused') return <div>Paused: {state.message}</div>;
  return <div className="aw-welcome">
    <span className="aw-eyebrow">FROM THE BIG PICTURE TO EVERY CONNECTION</span>
    <h2>A little context.<br /><span>A clearer architecture.</span></h2>
    <p>Turn your system into a map you can explore, question, and make your own.</p>
    <div className="aw-map-preview" aria-hidden="true">
      <div className="aw-preview-node"><span>01 / EXPERIENCE</span><strong>Web app</strong><small>Where it begins</small></div>
      <div className="aw-preview-link">→</div>
      <div className="aw-preview-node aw-preview-service"><span>02 / LOGIC</span><strong>API service</strong><small>The pieces connect</small></div>
      <div className="aw-preview-link">→</div>
      <div className="aw-preview-node aw-preview-data"><span>03 / DATA</span><strong>Database</strong><small>The story takes shape</small></div>
    </div>
    <div className="aw-welcome-steps">
      <div><span>1</span><strong>Describe</strong><p>Choose an example or bring your own idea.</p></div>
      <div><span>2</span><strong>Explore</strong><p>Follow a route. Inspect a connection.</p></div>
      <div><span>3</span><strong>Make it yours</strong><p>Refine in words and export when ready.</p></div>
    </div>
    <p className="aw-welcome-note">Architecture · Sequence · Data model · Component detail</p>
  </div>;
}

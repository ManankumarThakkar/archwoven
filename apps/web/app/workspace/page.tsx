'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import type { EditOp, SystemModel, TaskReport, ViewType } from '@archwoven/model';
import { SystemModelSchema, MAX_DETAIL_VIEWS, detailDrift, detailViewId, expandBlocker, internalsOf, isDetailView, type Edge, type View } from '@archwoven/model';
import { initial, next } from './states';
import type { Mode, Stage } from './states';
import { ControlPanel, type RepoForm } from './ControlPanel';
import { Canvas } from './Canvas';
import { TaskUsageSummary } from './TaskUsageSummary';
import { ArchitectureOrientation } from './ArchitectureOrientation';
import { ClarificationPanel } from './ClarificationPanel';
import { Inspector } from './InspectorPanel';
import { inspectorFor } from './inspector';
import { passportFor } from './passport';
import { RefineBar, type ExportKind } from './RefineBar';
import { ExpandInternals } from './ExpandInternals';
import { summarizeOps, pushHistory, undo, idempotencyKeyFor } from './refine-flow';
import { buildSvg } from '../../lib/export-svg';
import { modelJson, modelJsonFileName, sourceReferences } from '../../lib/export-json';
import { downloadBlob } from '../../lib/download';
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
  'credits-exhausted': 'Daily free credits used up',
  'network-credits-exhausted': 'Daily free credits for your network used up',
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

/** A running job survives a closed tab: its id is kept until the job reaches a final state. */
const ACTIVE_JOB = 'aw_activeJob';
/** Hosted servers ask for slower polling to save shared storage commands. */
const pollAfter = (job: { pollAfterMs?: unknown }) => typeof job.pollAfterMs === 'number' && job.pollAfterMs >= 200 && job.pollAfterMs <= 10_000 ? job.pollAfterMs : 400;
function rememberJob(jobId: string, preferredView?: ViewType) {
  try { localStorage.setItem(ACTIVE_JOB, JSON.stringify({ jobId, preferredView })); } catch { /* storage can be disabled */ }
}
function forgetJob(jobId: string) {
  try { if (storedJob()?.jobId === jobId) localStorage.removeItem(ACTIVE_JOB); } catch { /* storage can be disabled */ }
}
function storedJob(): { jobId: string; preferredView?: ViewType } | null {
  try {
    const value = JSON.parse(localStorage.getItem(ACTIVE_JOB) ?? 'null') as { jobId?: unknown; preferredView?: unknown } | null;
    if (typeof value?.jobId !== 'string' || !/^[\w-]{1,64}$/.test(value.jobId)) return null;
    return { jobId: value.jobId, preferredView: typeof value.preferredView === 'string' ? value.preferredView as ViewType : undefined };
  } catch { return null; }
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
  const [permalinkVersion, setPermalinkVersion] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [lastTask, setLastTask] = useState<TaskReport | null>(null);
  const usageSequence = useRef(0);
  const usageWatch = useRef(0);
  const [usagePending, setUsagePending] = useState(false);
  const [pool, setPool] = useState<number | null>(6);
  const [fake, setFake] = useState(false);
  const [deploy, setDeploy] = useState<'hosted' | 'local'>('hosted');
  const [llmReady, setLlmReady] = useState(true);
  const [queuedPos, setQueuedPos] = useState<number | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('describe');
  const [restoring, setRestoring] = useState(true);
  const loadSequence = useRef(0);
  /** The diagram most recently asked for, so hash updates the workspace makes itself never reload it. */
  const requestedModelRef = useRef<string | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const mutationRef = useRef(false);
  const generationRef = useRef(false);
  const [clarification, setClarification] = useState<{ jobId: string; questions: string[]; preferredView?: ViewType } | null>(null);

  const refreshUsage = async () => {
    const sequence = ++usageSequence.current;
    try {
      const response = await fetch('/api/quota');
      if (!response.ok) return;
      const q = await response.json();
      if (sequence !== usageSequence.current) return;
      setLastTask(q.lastTask ?? null);
      setRemaining(q.remaining); setPool(q.pool); setFake(q.fake);
    } catch { /* A usage refresh must not replace the task result or its error. */ }
  };

  // Cancellation releases the form before a provider necessarily reports usage.
  // Observe settlement separately, bounded by the longest supported job deadline.
  const watchUsage = async (jobId: string) => {
    const watch = ++usageWatch.current;
    setUsagePending(true);
    for (let attempt = 0; attempt < 300; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (watch !== usageWatch.current) return;
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
        if (!response.ok) break;
        const job = await response.json();
        if (watch !== usageWatch.current) return;
        if (!job.usagePending) { setUsagePending(false); void refreshUsage(); return; }
      } catch { /* Retry transient failures without hiding the task result. */ }
    }
    // Leave the pending disclosure visible if accounting could not be confirmed.
  };

  const rememberModel = (id: string) => {
    try { sessionStorage.setItem('aw_modelId', id); } catch { /* storage can be disabled */ }
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.has('model') && hash.get('model') !== id) {
      for (const key of ['focus', 'lens', 'route', 'chapter', 'relation', 'view']) hash.delete(key);
    }
    hash.set('model', id);
    window.history.replaceState(null, '', `#${hash}`);
  };

  /** Gaps come only from the saved model, so a first load and every reload show the same list. */
  const loadModel = async (id: string, preferredView?: ViewType) => {
    const sequence = ++loadSequence.current;
    requestedModelRef.current = id;
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
      dispatch({ type: 'RESTORED', modelId: id, revision: m.revision, gaps: [...new Set(m.openQuestions.map((q) => q.text))] });
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
      await refreshUsage();
      const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => null);
      if (cfg?.mode === 'local' || cfg?.mode === 'hosted') setDeploy(cfg.mode);
      if (typeof cfg?.fake === 'boolean') setFake(cfg.fake);
      if (cfg?.llmReady === false) setLlmReady(false);
      if (cancelled) return;
      const hash = new URLSearchParams(window.location.hash.slice(1));
      let saved: string | null = null;
      try { saved = sessionStorage.getItem('aw_modelId'); } catch { /* permalink still works */ }
      const id = hash.get('model') || saved;
      const pending = storedJob();
      if (id) await loadModel(id);
      else if (!pending && ['focus', 'lens', 'route', 'chapter', 'relation'].some((key) => hash.has(key))) {
        dispatch({ type: 'RESTORE_FAILED', message: 'This link does not include a saved diagram. Open the original diagram and copy its full address, or create a new diagram.' });
      }
      setRestoring(false);
      // A job accepted before the tab closed keeps running on the server; reconnect to it.
      if (pending && !cancelled && !generationRef.current) void resumeJob(pending.jobId, pending.preferredView);
    })();
    return () => { cancelled = true; ++loadSequence.current; ++usageSequence.current; ++usageWatch.current; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A link pasted into an open tab changes only the hash: open the diagram it names.
  const loadModelRef = useRef(loadModel);
  loadModelRef.current = loadModel;
  useEffect(() => {
    const onHashChange = () => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const id = hash.get('model');
      if (id && id !== requestedModelRef.current) { void loadModelRef.current(id); return; }
      // Apply the view and interaction channels together, after the destination
      // canvas renders. Our own replaceState writes never emit hashchange.
      if (!model || (id && id !== modelId)) return;
      const chosen = model.views.find(v => v.id === hash.get('view'))?.id ?? model.views[0]?.id ?? '';
      setActiveView(chosen);
      setPermalinkVersion(version => version + 1);
      if (chosen) hash.set('view', chosen); else hash.delete('view');
      window.history.replaceState(null, '', `#${hash}`);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [model, modelId]);

  const poll = async (jobId: string, preferredView?: ViewType) => {
    let runningSince: number | null = null;
    let misses = 0;
    for (;;) {
      let job: { status: string; stage?: Stage | null; modelId: string; revision: number; queuePosition?: number | null; deadlineAt?: number | null; questions?: string[]; usagePending?: boolean; remaining?: number | null; error?: string | null; pollAfterMs?: number } | null = null;
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
        if (res.status === 404) { forgetJob(jobId); dispatch({ type: 'ERROR', message: 'This generation no longer exists — please try again.' }); return; }
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
        await new Promise((r) => setTimeout(r, pollAfter(job)));
        continue;
      }
      if (job.status === 'running') {
        runningSince ??= Date.now();
        setQueuedPos(null);
        if (job.stage) dispatch({ type: 'STAGE', stage: job.stage });
        const deadline = typeof job.deadlineAt === 'number' ? job.deadlineAt : runningSince + 180_000;
        if (Date.now() > deadline + 10_000) { dispatch({ type: 'ERROR', message: 'The server has not confirmed completion. Retry the same input to reconnect to the job.' }); return; }
        await new Promise((r) => setTimeout(r, pollAfter(job)));
        continue;
      }
      if (job.status === 'clarifying') {
        if (!Array.isArray(job.questions) || job.questions.length < 1 || job.questions.length > 3 || job.questions.some(q => typeof q !== 'string' || !q.trim())) {
          dispatch({ type: 'ERROR', message: 'Could not read the clarification. Retry the same description to reconnect.' }); return;
        }
        setQueuedPos(null);
        forgetJob(jobId);
        if (typeof job.remaining === 'number') setRemaining(job.remaining);
        setClarification({ jobId, questions: job.questions, preferredView });
        dispatch({ type: 'CLARIFY', questions: job.questions });
        return;
      }
      forgetJob(jobId);
      if (job.usagePending && (job.status === 'cancelled' || job.status === 'failed')) void watchUsage(jobId);
      if (job.status === 'cancelled') { setQueuedPos(null); dispatch({ type: 'CANCEL' }); return; }
      if (job.status === 'succeeded') {
        setQueuedPos(null);
        if (await loadModel(job.modelId, preferredView)) setClarification(null);
        return;
      }
      dispatch({ type: 'ERROR', message: job.error ?? 'generation failed' });
      return;
    }
  };

  const resumeJob = async (jobId: string, preferredView?: ViewType) => {
    generationRef.current = true;
    jobIdRef.current = jobId;
    dispatch({ type: 'GENERATE' });
    try { await poll(jobId, preferredView); }
    finally { generationRef.current = false; jobIdRef.current = null; void refreshUsage(); }
  };

  const submitGeneration = async (url: string, body: object, preferredView?: ViewType) => {
    ++usageWatch.current; setUsagePending(false);
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
      const { jobId, remaining, resumable } = (await res.json()) as { jobId?: unknown; remaining?: number; resumable?: unknown };
      if (typeof jobId !== 'string' || !jobId) throw new Error('Missing job ID');
      if (typeof remaining === 'number') setRemaining(remaining);
      jobIdRef.current = jobId;
      // Only hosted jobs keep running when the tab closes; single-server jobs are not remembered.
      if (resumable === true) rememberJob(jobId, preferredView);
      await poll(jobId, preferredView);
    } catch {
      dispatch({ type: 'ERROR', message: 'Could not start generation. Check your connection and try again; retrying the same input will reconnect to any job already started.' });
    } finally { generationRef.current = false; jobIdRef.current = null; void refreshUsage(); }
  };

  /** Owner deletion: the server removes every revision and job; nothing is left to restore here either. */
  const deleteDiagram = async () => {
    if (!model || !modelId || mutationRef.current) return;
    if (!window.confirm('Delete this diagram and its history? This cannot be undone.')) return;
    mutationRef.current = true; setRefining(true);
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(modelId)}`, { method: 'DELETE' });
      // 404: already expired or deleted elsewhere — clear it here as well.
      if (!res.ok && res.status !== 404) { setSummary(await responseMessage(res, 'Could not delete the diagram. Try again.')); return; }
      try { sessionStorage.removeItem('aw_modelId'); } catch { /* storage can be disabled */ }
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      setModel(null); setModelId(null); requestedModelRef.current = null; setHistory([]); setSelected(null); setActiveView(''); setSummary('');
      dispatch({ type: 'RESET' });
      setNotice('Diagram deleted.');
    } catch {
      setSummary('Could not delete the diagram. Check your connection and try again.');
    } finally {
      mutationRef.current = false; setRefining(false);
    }
  };

  const generate = async (prompt: string, view: ViewType) => {
    if(mutationRef.current || generationRef.current)return;
    setNotice(null);
    dispatch({ type: 'GENERATE' });
    await submitGeneration('/api/generate', { prompt, view, idempotencyKey: idempotencyKeyFor(prompt, view) }, view);
  };

  const generateRepo = async (form: RepoForm) => {
    if(mutationRef.current || generationRef.current)return;
    setNotice(null);
    dispatch({ type: 'GENERATE_REPO' });
    await submitGeneration('/api/repo', { ...form, view: 'architecture', idempotencyKey: idempotencyKeyFor(`${form.localPath ? `local:${form.localPath}` : form.url}|${form.subdir ?? ''}|${form.ref ?? ''}`, 'architecture') }, 'architecture');
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

  /** Poll a hosted job until it ends; null when the connection keeps failing. */
  const waitForJob = async (jobId: string): Promise<{ status: string; error?: string | null } | null> => {
    let misses = 0;
    for (;;) {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
        if (res.status === 404) return { status: 'failed', error: 'This request no longer exists. Try again.' };
        if (!res.ok) throw new Error('job status unavailable');
        const job = await res.json() as { status: string; error?: string | null; pollAfterMs?: number };
        misses = 0;
        if (job.status !== 'queued' && job.status !== 'running') return job;
        await new Promise((r) => setTimeout(r, pollAfter(job)));
      } catch {
        if (++misses >= 5) return null;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  };

  /** A hosted refinement: wait for its job, then apply the result. Failures keep the typed instruction. */
  const finishRefineJob = async (jobId: string, diagramId: string, baseRevision: number): Promise<boolean> => {
    const job = await waitForJob(jobId);
    if (!job) { setSummary('Connection lost. The refinement may still finish; reload this page to see the latest diagram.'); return false; }
    if (job.status !== 'succeeded') {
      const reason = job.status === 'cancelled' ? 'Refinement cancelled.' : job.error || 'Refinement failed. Please try again.';
      // The saved copy may have moved on (another tab, or a save that landed as the job ended): show it rather than a stale page.
      const latest = await fetch(`/api/models/${encodeURIComponent(diagramId)}`).then(r => r.ok ? r.json() : null).catch(() => null) as { model?: unknown } | null;
      const parsed = SystemModelSchema.safeParse(latest?.model);
      if (parsed.success && parsed.data.revision !== baseRevision) {
        setModel(parsed.data); setHistory([parsed.data]);
        setSummary(`${reason} The latest saved version is now shown.`);
      } else setSummary(reason);
      return false;
    }
    const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/result`);
    const result = (response.ok ? await response.json().catch(() => ({})) : {}) as { model?: unknown; ops?: EditOp[] };
    const parsed = SystemModelSchema.safeParse(result.model);
    if (!parsed.success) { setSummary('The refinement finished, but its result could not be read. Reload this page to see the latest diagram.'); return false; }
    setHistory((h) => pushHistory(h, parsed.data));
    setModel(parsed.data);
    setSummary(Array.isArray(result.ops) ? summarizeOps(result.ops) : 'Refined.');
    return true;
  };

  /** Resolves true only when a revision was saved, so the bar keeps the instruction otherwise. */
  const refine = async (instruction: string): Promise<boolean> => {
    if (!model || !modelId || mutationRef.current) return false;
    mutationRef.current=true;
    setRefining(true);
    try {
      const res = await fetch('/api/refine', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        // Hosted servers refine the diagram this page holds; the server keeps it only for 24 hours.
        body: JSON.stringify({ modelId, baseRevision: model.revision, instruction, view: (model.views.find((v) => v.id === activeView) ?? model.views[0])?.type ?? 'architecture', model }),
      });
      if (res.status === 202) return await finishRefineJob((await res.json() as { jobId: string }).jobId, modelId, model.revision);
      if (res.status === 409) {
        const b = (await res.json()) as { model: SystemModel; reason?: string; message?: string };
        if (b.reason === 'busy') { setSummary(b.message ?? 'Another request is still running. Try again when it finishes.'); return false; }
        setModel(b.model);
        setHistory([b.model]);
        setSummary('The diagram changed elsewhere — showing the latest version.');
        dispatch({ type: 'REBASE', modelId, revision: b.model.revision });
        return false;
      }
      if (res.status === 429) {
        const q = (await res.json()) as { reason: string; message?: string; resetAt?: number };
        dispatch({ type: 'QUOTA_BLOCKED', reason: q.reason, resetAt: q.resetAt ?? Date.now() + 60_000, message: q.message ?? '' });
        return false;
      }
      if (!res.ok) { setSummary(await responseMessage(res, 'Refinement failed. Please try again.')); return false; }
      const { ops, model: nextModel, remaining } = (await res.json()) as { ops: EditOp[]; model: SystemModel; remaining?: number };
      setHistory((h) => pushHistory(h, nextModel));
      setModel(nextModel);
      setSummary(summarizeOps(ops));
      if (typeof remaining === 'number') setRemaining(remaining);
      return true;
    } catch {
      setSummary('Could not refine the diagram. Check your connection before trying again.');
      return false;
    } finally {
      mutationRef.current=false;
      setRefining(false);
      void refreshUsage();
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

  const selectView = (id: string) => {
    setActiveView(id);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (id) hash.set('view', id); else hash.delete('view');
    window.history.replaceState(null, '', `#${hash}`);
  };
  // Undo, close, refinement or a stale link can remove the active view: fall back to the first.
  useEffect(() => {
    if (model && activeView && !model.views.some(v => v.id === activeView)) selectView(model.views[0]?.id ?? '');
  }, [model, activeView]);

  const openDetail = (target: string) => {
    if (!model) return;
    const existing = model.views.find(v => v.id === detailViewId(target));
    if (existing && isDetailView(existing)) { selectView(existing.id); return; }
    void directEdit({ type: 'detail', target });
  };

  const expand = async (target: string, hint: string): Promise<boolean> => {
    if (!model || !modelId || mutationRef.current) return false;
    mutationRef.current = true; setRefining(true);
    const label = model.nodes.find(n => n.id === target)?.label ?? target;
    setSummary(`Expanding ${label}…`);
    try {
      const res = await fetch(`/api/models/${modelId}/expand`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRevision: model.revision, target, ...(hint ? { hint } : {}) }) });
      if (res.status === 409) {
        const body = await res.json();
        const latest = SystemModelSchema.parse(body.model);
        setModel(latest); setHistory([latest]);
        setSummary(typeof body.message === 'string' ? body.message : 'The diagram changed elsewhere. Review the latest version and try again.');
        return false;
      }
      if (!res.ok) { setSummary(await responseMessage(res, 'Could not expand this component. Try again.')); return false; }
      const body = await res.json();
      const accepted = SystemModelSchema.parse(body.model);
      setModel(accepted); setHistory(h => pushHistory(h, accepted));
      if (typeof body.remaining === 'number') setRemaining(body.remaining);
      setSummary(`Added ${internalsOf(accepted, target).length} inferred internals to ${label}.`);
      return true;
    } catch {
      setSummary('Could not expand this component. Check your connection and try again.');
      return false;
    } finally {
      mutationRef.current = false; setRefining(false);
      void refreshUsage();
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
      setModel(accepted);if(accepted.revision!==model.revision)setHistory(h=>pushHistory(h,accepted));
      if(action.type==='detail')selectView(detailViewId(action.target));
      setSummary(action.type==='rename'?'Name saved.':action.type==='orient'?`${action.orientation==='LR'?'Horizontal':'Vertical'} layout saved.`:action.type==='detail'?'Detail view opened.':action.type==='close-detail'?'Detail view closed.':'Positions saved.');return true;
    }catch{setSummary('Could not save this change. Check your connection and try again.');return false;}
    finally{mutationRef.current=false;setRefining(false);}
  };

  const doExport = async (kind: ExportKind) => {
    if (!model) return;
    if (kind === 'json' || kind === 'json-no-evidence') {
      const variant = kind === 'json' ? 'full' : 'no-evidence';
      try {
        downloadBlob(new Blob([modelJson(model, variant)], { type: 'application/json' }), modelJsonFileName(model, variant));
        setSummary(kind === 'json' ? 'JSON downloaded.' : 'JSON without evidence downloaded.');
      } catch {
        setSummary('Could not export the model. Please try again.');
      }
      return;
    }
    const viewId = (model.views.find(v => v.id === activeView) ?? model.views[0])?.id;
    if (!viewId) return;
    setSummary('Preparing export…');
    try {
      const svg = await buildSvg(model, viewId);
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
      downloadBlob(blob, `archwoven-${viewId.replace(/[^A-Za-z0-9._-]+/g, '-')}.${ext}`);
      setSummary(kind === 'png' && ext === 'svg' ? 'PNG export unavailable. Downloaded SVG instead.' : `${ext.toUpperCase()} downloaded.`);
    } catch {
      setSummary('Could not export the diagram. Please try again.');
    }
  };

  const showCanvas = (state.kind === 'success' || state.kind === 'partial') && model;
  const viewTabs = model?.views ?? [];
  const currentView = viewTabs.find(v => v.id === activeView) ?? viewTabs[0];
  const passport = model && selected ? passportFor(model, selected) : null;
  const inDetail = !!currentView && isDetailView(currentView);
  const viewLabel = (v: View) => isDetailView(v) ? `${model?.nodes.find(n => n.id === v.focus)?.label ?? v.focus} · detail` : v.type === 'er' ? 'Data model' : v.type.replace('-', ' ');
  const selectedNode = model && selected ? model.nodes.find(n => n.id === selected) : undefined;
  const detailAction = model && selectedNode && selectedNode.kind !== 'entity' && !(inDetail && currentView!.focus === selectedNode.id)
    ? { onOpen: () => openDetail(selectedNode.id), limitReached: !model.views.some(v => v.id === detailViewId(selectedNode.id)) && model.views.filter(isDetailView).length >= MAX_DETAIL_VIEWS }
    : null;
  const focusLabel = inDetail ? model?.nodes.find(n => n.id === currentView!.focus)?.label ?? currentView!.focus! : '';
  const detailFocus = inDetail ? currentView!.focus! : '';
  const expandedCount = model && inDetail ? internalsOf(model, detailFocus).length : 0;
  const labelOf = (id: string) => model?.nodes.find(n => n.id === id)?.label ?? id;
  const drift = model && expandedCount ? detailDrift(model, detailFocus) : null;
  const driftLines = drift ? [
    ...drift.uncovered.map((e: Edge) => e.from === detailFocus && e.to === detailFocus
      ? `${focusLabel} now also loops back to itself (${e.type}); its internals don’t show which part does.`
      : e.from === detailFocus
        ? `${focusLabel} now also connects to ${labelOf(e.to)} (${e.type}); its internals don’t show which part does.`
        : `${labelOf(e.from)} now also connects to ${focusLabel} (${e.type}); its internals don’t show which part receives it.`),
    ...drift.unbacked.map((e: Edge) => `${labelOf(e.from)} → ${labelOf(e.to)} (${e.type}) is no longer in the overview.`),
  ] : [];
  const references = model ? sourceReferences(model) : null;
  const exportSources = model && references?.present ? { private: model.privacy.classification === 'private' || model.privacy.boundary === 'local-only', repos: references.repos } : null;
  // Pre-model chip states the deployment's processing location — never a hardcoded claim.
  const privacy = model ? `🔒 ${model.privacy.classification} · ${model.privacy.boundary}` : `🔒 ${deploy === 'local' ? 'private · local-only' : 'public · external-allowed'}`;

  return (
    <div className="aw-workspace">
      <header className="aw-header">
        <a className="aw-brand" href="/workspace" aria-label="Archwoven workspace"><span className="aw-brand-mark" aria-hidden="true">⌘</span>Arch<span>woven</span></a>
        <span className="aw-header-caption">Architecture, connected.</span>
        <div className="aw-header-status">
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#111a2e', color: '#93c5fd' }}>{privacy}</span>
        {deploy === 'local'
          ? <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#111a2e', color: '#93c5fd' }}>Local · no credit limits</span>
          : pool === null
            // Hosted spending caps are money limits, not credits.
            ? <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#111a2e', color: '#fbbf24' }}>◐ Free AI · daily limit</span>
            : <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#111a2e', color: '#fbbf24' }}>◐ {remaining ?? pool}/{pool} credits today</span>}
        {usagePending ? <span role="status">Usage pending · provider is settling</span> : lastTask && <TaskUsageSummary task={lastTask} />}
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
      <div className="workspace-shell" style={{ flex: 1, minHeight: 0 }}>
        <ControlPanel
          locked={refining || !!clarification}
          running={state.kind === 'running' || restoring}
          remaining={deploy === 'local' ? null : remaining ?? pool}
          deploy={deploy}
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
              {viewTabs.map((v) => isDetailView(v) ? (
                <span key={v.id} className="aw-detail-tab">
                  <button aria-pressed={v.id === currentView?.id} title={viewLabel(v)} onClick={() => selectView(v.id)} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{viewLabel(v)}</button>
                  <button className="aw-detail-close" aria-label={`Close ${viewLabel(v).replace(/ · detail$/, '')} detail`} disabled={refining} onClick={() => { void directEdit({ type: 'close-detail', viewId: v.id }); }}>×</button>
                </span>
              ) : (
                <button key={v.id} aria-pressed={v.id === currentView?.id} onClick={() => selectView(v.id)}>{viewLabel(v)}</button>
              ))}
              {currentView && <ArchitectureOrientation model={model} view={currentView} busy={refining} onChange={orientation=>{void directEdit({type:'orient',viewId:currentView.id,orientation});}} />}
            </div>
            {inDetail && <p role="note" className="aw-detail-caption">{expandedCount ? `Inside ${focusLabel} (inferred) · and its direct connections` : `${focusLabel} and its direct connections · arranged automatically${currentView!.edges.length ? '' : ' · no direct connections'}`}</p>}
            {inDetail && expandedCount > 0 && model.nodes.some(n => n.provenance === 'source-supported') && <p role="note" className="aw-detail-caption aw-detail-source">Internals are inferred, not found in source.</p>}
            {driftLines.length > 0 && <div role="status" className="aw-detail-drift">{driftLines.map(line => <p key={line}>{line}</p>)}</div>}
            {inDetail && expandBlocker(model, detailFocus) === null && <ExpandInternals key={detailFocus} label={focusLabel} cost={deploy === 'hosted'} busy={refining} onExpand={hint => expand(detailFocus, hint)} />}
            <div style={{ flex: 1, minHeight: 0 }}><Canvas permalinkVersion={permalinkVersion} model={model} modelId={modelId ?? ''} viewId={currentView?.id ?? ''} busy={refining} onMove={inDetail ? undefined : positions=>directEdit({type:'move',positions})} onSelect={setSelected} onDeselect={() => setSelected(null)} /></div>
            <RefineBar busy={refining} summary={summary} canUndo={history.length > 1} onRefine={refine} onUndo={doUndo} onExport={doExport} sources={exportSources}
              onDelete={() => { void deleteDiagram(); }} retention={deploy === 'local' ? 'Stored on this machine until you delete it.' : 'Kept for 30 days after the last change.'} />
          </main>
        ) : (
          <main className="aw-empty-main" aria-label="Diagram workspace" aria-live="polite">
            {notice && <div role="status" className="aw-notice">{notice}</div>}
            {clarification && <ClarificationPanel key={clarification.jobId} questions={clarification.questions} busy={state.kind === 'running'} onContinue={continueClarification} onEdit={() => { setClarification(null); dispatch({ type: 'RESET' }); requestAnimationFrame(() => document.getElementById('system-description')?.focus()); }} />}
            {restoring ? <div role="status">Opening your workspace…</div> : state.kind !== 'clarifying' && <CanvasPlaceholder state={state} queuedPos={queuedPos} onReset={() => { if (!clarification) dispatch({ type: 'RESET' }); }} hideReset={!!clarification} />}
            {clarification && state.kind === 'running' && <button className="aw-clarification-cancel" onClick={cancelJob}>Cancel</button>}
          </main>
        )}
        {showCanvas && <Inspector payload={selected ? inspectorFor(model, selected) : null} gaps={state.kind === 'partial' ? state.gaps : undefined} passport={passport} busy={refining} detail={detailAction} onRename={(target,label)=>{void directEdit({type:'rename',target,label});}} />}
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

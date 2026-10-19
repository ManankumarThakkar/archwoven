// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyEditOps, applyExpansion, closeDetailView, openDetailView, undoTo, validFullModelExtended, type SystemModel } from '@archwoven/model';
import { fakeExpansion } from '@archwoven/llm';
import WorkspacePage from './page';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Layout is covered separately in Canvas tests and the real-browser pass.
vi.mock('./Canvas', () => ({ Canvas: ({ viewId, model, onSelect, onMove, permalinkVersion }: { permalinkVersion?: number; viewId: string; model: typeof validFullModelExtended; onSelect: (id: string) => void; onMove?: unknown }) => <><output aria-label="Rendered view">{viewId}</output><output aria-label="Permalink version">{permalinkVersion}</output><output aria-label="Rendered API">{model.nodes.find(n=>n.id==='gateway.api')?.label}</output><output aria-label="Can move">{String(!!onMove)}</output><button onClick={()=>onSelect('gateway.api')}>Inspect API</button><button onClick={()=>onSelect('entity.user')}>Inspect entity</button><button onClick={()=>onSelect('e.user-api')}>Inspect connection</button></> }));
const rasterizer = vi.hoisted(() => ({ ensureResvg: vi.fn(), renderPng: vi.fn() }));
vi.mock('../../probes/render/export', () => rasterizer);

let container: HTMLDivElement;
let root: Root;
const requests: string[] = [];
let status = 200;
let transport: (input: string, init?: RequestInit) => Response | Promise<Response> | undefined;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, React });
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, '', '/workspace');
  requests.length = 0;
  status = 200;
  rasterizer.ensureResvg.mockReset().mockResolvedValue(undefined);
  rasterizer.renderPng.mockReset().mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
  transport = () => undefined;
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    requests.push(input);
    const response = transport(input, init);
    if (response) return response;
    if (input === '/api/quota') return Response.json({ remaining: 6, pool: 6, fake: true });
    if (input === '/api/config') return Response.json({ mode: 'hosted', llmReady: true });
    if (input.startsWith('/api/models/')) return Response.json(
      status === 200 ? { model: validFullModelExtended } : { error: 'model not found' }, { status });
    throw new Error(`Unexpected request: ${input}`);
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function mount() {
  await act(async () => { root.render(<WorkspacePage />); });
}

const canRefine = () => !!container.querySelector('input[placeholder^="Refine:"]');

describe('direct edits and revision history',()=>{
  it('saves two names and undoes each accepted revision in order',async()=>{
    window.history.replaceState(null,'','/workspace#model=m1');
    let stored=structuredClone(validFullModelExtended);const revisions=new Map([[stored.revision,stored]]),undone:number[]=[];
    transport=(input,init)=>{
      if(input==='/api/models/m1'&&!init)return Response.json({model:stored});
      if(input==='/api/models/m1/edit'){
        const body=JSON.parse(String(init?.body));expect(body.baseRevision).toBe(stored.revision);
        stored=structuredClone(stored);stored.parentId=stored.revision;stored.revision++;stored.nodes.find(n=>n.id==='gateway.api')!.label=body.action.label;revisions.set(stored.revision,stored);return Response.json({model:stored});
      }
      if(input==='/api/models/m1/undo'){
        const body=JSON.parse(String(init?.body));expect(body.baseRevision).toBe(stored.revision);undone.push(body.prevRevision);
        // Hosted servers keep only the latest revision: the page sends the earlier version it showed.
        expect(body.previous).toEqual(revisions.get(body.prevRevision));
        const prev=structuredClone(revisions.get(body.prevRevision)!);prev.parentId=stored.revision;prev.revision=stored.revision+1;stored=prev;return Response.json({model:stored});
      }
      return undefined;
    };
    await mount();await click('Inspect API');
    await fill('input[aria-label="Element name"]','First name');await click('Save name');
    await fill('input[aria-label="Element name"]','Second name');await click('Save name');
    await click('↶ Undo');expect(container.querySelector('[aria-label="Rendered API"]')!.textContent).toBe('First name');
    await click('↶ Undo');expect(undone).toEqual([2,1]);expect(container.querySelector('[aria-label="Rendered API"]')!.textContent).toBe(validFullModelExtended.nodes.find(n=>n.id==='gateway.api')!.label);
    expect(requests).not.toContain('/api/refine');
  });
  it('keeps a failed rename draft and original diagram available for retry',async()=>{
    window.history.replaceState(null,'','/workspace#model=m1');
    transport=input=>input.endsWith('/edit')?Response.json({error:'Edit unavailable'},{status:503}):undefined;
    await mount();await click('Inspect API');await fill('input[aria-label="Element name"]','Retry this name');await click('Save name');
    expect(container.textContent).toContain('Edit unavailable');expect(container.querySelector<HTMLInputElement>('input[aria-label="Element name"]')!.value).toBe('Retry this name');
    expect(container.querySelector('[aria-label="Rendered API"]')!.textContent).toBe(validFullModelExtended.nodes.find(n=>n.id==='gateway.api')!.label);
  });
});

async function fill(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;
  expect(button, `Button containing ${label}`).toBeDefined();
  await act(async () => button.click());
}

describe('hosted money limits in the header', () => {
  it('describes the daily limit instead of credits when the server uses spending caps', async () => {
    transport = (input) => input === '/api/quota' ? Response.json({ remaining: null, pool: null, fake: false }) : undefined;
    await mount();
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(container.textContent).toContain('Free AI · daily limit');
    expect(container.textContent).not.toMatch(/\/\s*credits today|null/);
  });

  it('does not describe hosted repository analysis as local and free of credits', async () => {
    transport = (input) => input === '/api/quota' ? Response.json({ remaining: null, pool: null, fake: false }) : undefined;
    await mount();
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    await click('Import repository');
    const help = container.querySelector('#repository-help')!.textContent!;
    expect(help).not.toMatch(/Runs locally|no credits/);
    expect(help).toContain('Uses free AI within a daily limit.');
  });
});

describe('hosted refinement jobs', () => {
  const settle = async () => { for (let i = 0; i < 40; i++) await act(async () => { await new Promise(r => setTimeout(r, 20)); }); };
  const submitRefine = async () => {
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'Refine')!;
    await act(async () => { button.click(); });
    await settle();
  };
  const refineIn = async (text: string) => {
    const box = container.querySelector<HTMLInputElement>('input[placeholder^="Refine:"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, text); box.dispatchEvent(new Event('input', { bubbles: true })); });
    await submitRefine();
    return box;
  };
  it('sends the diagram it holds, waits for the job and applies the result', async () => {
    window.history.replaceState(null, '', '/workspace#model=m1');
    let sent: { model?: { revision?: number }; baseRevision?: number } | undefined;
    const refined = structuredClone(validFullModelExtended); refined.revision = validFullModelExtended.revision + 1; refined.nodes.find(n => n.id === 'gateway.api')!.label = 'Edge Gateway';
    let polls = 0;
    transport = (input, init) => {
      if (input === '/api/refine') { sent = JSON.parse(String(init?.body)); return Response.json({ jobId: 'refine-job', remaining: null, resumable: true }, { status: 202 }); }
      if (input === '/api/jobs/refine-job') return Response.json(++polls < 2 ? { status: 'running', pollAfterMs: 200 } : { status: 'succeeded', modelId: 'm1', revision: refined.revision });
      if (input === '/api/jobs/refine-job/result') return Response.json({ ops: [{ op: 'update', target: 'gateway.api', patch: { label: 'Edge Gateway' }, baseRevision: 1, summary: 'Rename the gateway' }], model: refined });
      return undefined;
    };
    await mount(); await settle();
    const box = await refineIn('Rename the gateway to Edge Gateway');
    expect(sent).toMatchObject({ baseRevision: validFullModelExtended.revision, model: { revision: validFullModelExtended.revision } });
    expect(requests).toContain('/api/jobs/refine-job/result');
    expect(container.textContent).toContain('Edge Gateway');
    expect(box.value).toBe('');
  });
  it('shows the latest saved diagram when a failed refinement left the server copy newer than this page', async () => {
    window.history.replaceState(null, '', '/workspace#model=m1');
    const newer = structuredClone(validFullModelExtended); newer.revision = validFullModelExtended.revision + 1; newer.nodes.find(n => n.id === 'gateway.api')!.label = 'Saved Elsewhere';
    let loads = 0;
    transport = (input) => {
      if (input === '/api/models/m1') return Response.json({ model: ++loads === 1 ? validFullModelExtended : newer });
      if (input === '/api/refine') return Response.json({ jobId: 'refine-late', remaining: null, resumable: true }, { status: 202 });
      if (input === '/api/jobs/refine-late') return Response.json({ status: 'failed', error: 'The diagram changed while this request was running, so its result was not applied. Your current diagram is unchanged; try again.' });
      return undefined;
    };
    await mount(); await settle();
    const box = await refineIn('Add a cache');
    expect(container.textContent).toContain('Saved Elsewhere');
    expect(container.textContent).toContain('latest saved version');
    expect(box.value).toBe('Add a cache');
  });
  it('keeps the instruction and the diagram when the job fails, and explains a busy refusal', async () => {
    window.history.replaceState(null, '', '/workspace#model=m1');
    let attempt = 0;
    transport = (input) => {
      if (input === '/api/refine') return ++attempt === 1
        ? Response.json({ jobId: 'refine-fail', remaining: null, resumable: true }, { status: 202 })
        : Response.json({ reason: 'busy', jobId: 'other', message: 'You already have a request running. Wait for it to finish, then try again.' }, { status: 409 });
      if (input === '/api/jobs/refine-fail') return Response.json({ status: 'failed', error: 'The diagram changed while this request was running, so its result was not applied. Your current diagram is unchanged; try again.' });
      return undefined;
    };
    await mount(); await settle();
    const box = await refineIn('Add a cache');
    expect(container.textContent).toContain('The diagram changed while this request was running');
    expect(box.value).toBe('Add a cache');
    expect(container.querySelector('[aria-label="Rendered view"]')).toBeTruthy();
    await submitRefine();
    expect(container.textContent).toContain('You already have a request running');
    expect(container.textContent).not.toContain('changed elsewhere');
    expect(box.value).toBe('Add a cache');
  });
});

describe('reconnecting to a job after the tab closes', () => {
  const settle = async () => { for (let i = 0; i < 50; i++) await act(async () => { await new Promise(r => setTimeout(r, 20)); }); };
  it('remembers the running job, resumes it on the next visit, and forgets it once it finishes', async () => {
    let phase: 'running' | 'done' = 'running';
    transport = (input) => {
      if (input === '/api/generate') return Response.json({ jobId: 'job-closed-tab', remaining: 5, resumable: true }, { status: 202 });
      if (input === '/api/jobs/job-closed-tab') return Response.json(phase === 'running' ? { status: 'running', stage: 'generating', deadlineAt: Date.now() + 60_000 } : { status: 'succeeded', modelId: 'm-resumed', revision: 1 });
      return undefined;
    };
    await mount(); await fill('#system-description', 'A shop where customers order through an API backed by PostgreSQL'); await click('Generate diagram');
    await settle();
    expect(JSON.parse(localStorage.getItem('aw_activeJob') ?? 'null')).toMatchObject({ jobId: 'job-closed-tab' });
    // The tab closes while the job runs; a new visit to the workspace picks it up.
    await act(async () => root.unmount());
    root = createRoot(container);
    phase = 'done';
    await mount(); await settle();
    expect(requests).toContain('/api/models/m-resumed');
    expect(container.querySelector('[aria-label="Rendered view"]')).toBeTruthy();
    expect(localStorage.getItem('aw_activeJob')).toBeNull();
  });
  it('forgets a job that failed, so the next visit starts fresh', async () => {
    localStorage.setItem('aw_activeJob', JSON.stringify({ jobId: 'job-failed' }));
    transport = (input) => input === '/api/jobs/job-failed' ? Response.json({ status: 'failed', error: 'This job stopped before it finished, so it was not completed. You can retry it.' }) : undefined;
    await mount(); await settle();
    expect(container.textContent).toContain('This job stopped before it finished');
    expect(localStorage.getItem('aw_activeJob')).toBeNull();
  });
  it('keeps the single-server flow as it was: nothing is remembered unless the server can resume the job', async () => {
    let polls = 0;
    transport = (input) => {
      if (input === '/api/generate') return Response.json({ jobId: 'local-job', remaining: 5 }, { status: 202 });
      if (input === '/api/jobs/local-job') return Response.json(++polls < 3 ? { status: 'running', stage: 'generating', deadlineAt: Date.now() + 60_000 } : { status: 'failed', error: 'stopped' });
      return undefined;
    };
    await mount(); await fill('#system-description', 'A shop where customers order through an API backed by PostgreSQL'); await click('Generate diagram');
    expect(localStorage.getItem('aw_activeJob')).toBeNull();
    await settle();
  });
  it('ignores a stored value that is not a job', async () => {
    localStorage.setItem('aw_activeJob', '{"jobId":"../../api/admin"}');
    await mount(); await settle();
    expect(requests.some(r => r.startsWith('/api/jobs/'))).toBe(false);
  });
});

describe('saved diagram restoration', () => {
  it('opens the requested sequence view after generation and preserves it in the reload link', async () => {
    transport = (input) => {
      if (input === '/api/generate') return Response.json({ jobId: 'sequence-job', remaining: 5 }, { status: 202 });
      if (input === '/api/jobs/sequence-job') return Response.json({ status: 'succeeded', modelId: 'sequence-model', revision: 1 });
      return undefined;
    };
    await mount(); await click('Sequence'); await fill('#system-description', 'User signs in and receives a response'); await click('Generate diagram');
    expect(container.querySelector('[aria-label="Rendered view"]')?.textContent).toBe('view.sequence');
    expect(new URLSearchParams(window.location.hash.slice(1)).get('view')).toBe('view.sequence');
  });
  it('shows a failed cancellation without abandoning the active job', async () => {
    vi.useFakeTimers();
    transport = (input) => {
      if (input === '/api/generate') return Response.json({ jobId: 'cancel-job', remaining: 5 }, { status: 202 });
      if (input === '/api/jobs/cancel-job/cancel') return Response.json({ error: 'job is not cancellable' }, { status: 409 });
      if (input === '/api/jobs/cancel-job') return Response.json({ status: 'running', stage: 'generating' });
      return undefined;
    };
    await mount(); await fill('#system-description', 'Keep this input'); await click('Generate diagram'); await click('Cancel');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('job is not cancellable');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(container.textContent).toContain('Designing the architecture');
    expect([...container.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')?.disabled).toBe(false);
  });
  it('keeps polling a healthy job beyond the obsolete two-minute cutoff using its server deadline', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    let done = false;
    transport = (input) => {
      if (input === '/api/generate') return Response.json({ jobId: 'long-job', remaining: 5 }, { status: 202 });
      if (input === '/api/jobs/long-job') return Response.json(done
        ? { status: 'succeeded', modelId: 'long-model', revision: 1 }
        : { status: 'running', stage: 'generating', deadlineAt: 181000 });
      return undefined;
    };
    await mount(); await fill('#system-description', 'A library app'); await click('Generate diagram');
    await act(async () => { await vi.advanceTimersByTimeAsync(121000); });
    expect(container.textContent).not.toContain('Something went wrong');
    expect(container.textContent).toContain('Designing the architecture');
    done = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(window.location.hash).toContain('model=long-model');
    expect(canRefine()).toBe(true);
  });

  it('allows cancelling a running description while preserving the typed input', async () => {
    vi.useFakeTimers(); let cancelled = false;
    transport = (input) => {
      if (input === '/api/generate') return Response.json({ jobId: 'cancel-job', remaining: 5 }, { status: 202 });
      if (input === '/api/jobs/cancel-job/cancel') { cancelled = true; return Response.json({ status: 'cancelled' }); }
      if (input === '/api/jobs/cancel-job') return Response.json({ status: cancelled ? 'cancelled' : 'running', stage: 'generating' });
      return undefined;
    };
    await mount(); await fill('#system-description', 'Keep my library description'); await click('Generate diagram');
    await click('Cancel');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(container.textContent).toContain('Cancelled.');
    expect((container.querySelector('#system-description') as HTMLTextAreaElement).value).toBe('Keep my library description');
    expect(requests).toContain('/api/jobs/cancel-job/cancel');
  });

  it('reload restores a usable workspace and model identity without another generation', async () => {
    sessionStorage.setItem('aw_modelId', 'saved-model');
    await mount();
    expect(canRefine()).toBe(true);
    expect(window.location.hash).toContain('model=saved-model');
    expect(requests.filter((r) => r.startsWith('/api/models/'))).toEqual(['/api/models/saved-model']);
  });

  it('a fresh authorized tab loads the model named in the permalink before the viewer mounts', async () => {
    window.history.replaceState(null, '', '/workspace#model=linked-model&focus=svc.api&lens=service&route=actor.user~svc.api&chapter=overview');
    await mount();
    expect(canRefine()).toBe(true);
    expect(sessionStorage.getItem('aw_modelId')).toBe('linked-model');
    const hash = new URLSearchParams(window.location.hash.slice(1));
    expect(hash.get('focus')).toBe('svc.api');
    expect(hash.get('lens')).toBe('service');
    expect(hash.get('route')).toBe('actor.user~svc.api');
    expect(hash.get('chapter')).toBe('overview');
  });

  it('an explicit model link takes priority over the previous tab model', async () => {
    sessionStorage.setItem('aw_modelId', 'previous-model');
    window.history.replaceState(null, '', '/workspace#model=linked-model');
    await mount();
    expect(requests).toContain('/api/models/linked-model');
    expect(requests).not.toContain('/api/models/previous-model');
  });

  it('inaccessible links show actionable feedback and never fall back to an unrelated saved model', async () => {
    status = 404;
    sessionStorage.setItem('aw_modelId', 'previous-model');
    window.history.replaceState(null, '', '/workspace#model=unavailable');
    await mount();
    expect(canRefine()).toBe(false);
    expect(container.textContent).toMatch(/unavailable|cannot.*open|could not.*open/i);
    expect(requests).not.toContain('/api/models/previous-model');
  });

  it('an old focus-only link without model context explains how to recover', async () => {
    window.history.replaceState(null, '', '/workspace#focus=svc.api');
    await mount();
    expect(container.textContent).toMatch(/link.*diagram|diagram.*link/i);
    expect(canRefine()).toBe(false);
  });
});

describe('generation request failures', () => {
  it.each(['description', 'repository'])('recovers from a rejected %s request instead of staying busy', async (kind) => {
    transport = (input) => {
      if (input === '/api/generate' || input === '/api/repo') return Promise.reject(new TypeError('Failed to fetch'));
    };
    await mount();
    if (kind === 'repository') {
      await click('Import repository');
      await fill('#repository-url', 'https://github.com/example/service');
      await click('Analyze repository');
    } else {
      await fill('#system-description', 'A public library lending books');
      await click('Generate diagram');
    }
    expect(container.textContent).toMatch(/check your connection|network request|could not.*request/i);
    expect(container.textContent).not.toContain('Creating your diagram…');
    expect(container.querySelector<HTMLInputElement | HTMLTextAreaElement>(kind === 'repository' ? '#repository-url' : '#system-description')!.disabled).toBe(false);
  });

  it('shows the API message without dumping its JSON envelope', async () => {
    transport = (input) => input === '/api/generate'
      ? Response.json({ reason: 'llm-not-configured', message: 'Configure a generation provider to continue.' }, { status: 503 }) : undefined;
    await mount();
    await fill('#system-description', 'A public library lending books');
    await click('Generate diagram');
    expect(container.textContent).toContain('Configure a generation provider to continue.');
    expect(container.textContent).not.toContain('"reason"');
  });

  it('re-enables creation after a malformed accepted response', async () => {
    transport = (input) => input === '/api/generate' ? Response.json({}, { status: 202 }) : undefined;
    await mount();
    await fill('#system-description', 'A public library lending books');
    await click('Generate diagram');
    expect(container.textContent).not.toContain('Creating your diagram…');
    expect(container.textContent).toContain('Could not start generation');
  });

  it.each(['http', 'malformed'])('retries a transient %s polling failure and opens the completed diagram', async (failure) => {
    let polls = 0;
    transport = (input) => {
      if (input === '/api/generate') return Response.json({ jobId: 'live-job', remaining: 5 }, { status: 202 });
      if (input === '/api/jobs/live-job') {
        if (++polls === 1) return failure === 'http'
          ? Response.json({ error: 'Temporary proxy failure' }, { status: 503 })
          : Response.json(null);
        return Response.json({ status: 'succeeded', stage: 'saving', modelId: 'live-job', revision: 1, queuePosition: null, gaps: [], error: null });
      }
    };
    await mount();
    vi.useFakeTimers();
    await fill('#system-description', 'A public library lending books');
    await click('Generate diagram');
    expect(canRefine()).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(canRefine()).toBe(true);
  });
});

describe('editing failures', () => {
  it.each(['response', 'network'])('keeps the diagram usable and surfaces a refinement %s failure', async (kind) => {
    sessionStorage.setItem('aw_modelId', 'saved-model');
    transport = (input) => input === '/api/refine' ? kind === 'network'
      ? Promise.reject(new TypeError('Failed to fetch'))
      : Response.json({ error: 'Refinement is temporarily unavailable.' }, { status: 502 }) : undefined;
    await mount();
    await fill('input[aria-label="Refinement instruction"]', 'Add a cache');
    await click('Refine');
    expect(container.textContent).toMatch(/temporarily unavailable|check your connection|network request/i);
    expect(canRefine()).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Refinement instruction"]')!.disabled).toBe(false);
  });

  it('surfaces undo errors without discarding the current model', async () => {
    sessionStorage.setItem('aw_modelId', 'saved-model');
    transport = (input) => {
      if (input === '/api/refine') return Response.json({ ops: [], model: { ...validFullModelExtended, revision: 2 }, remaining: 5 });
      if (input.endsWith('/undo')) return Response.json({ error: 'Undo is temporarily unavailable.' }, { status: 503 });
    };
    await mount();
    await fill('input[aria-label="Refinement instruction"]', 'Add a cache');
    await click('Refine');
    await click('Undo');
    expect(container.textContent).toContain('Undo is temporarily unavailable.');
    expect(canRefine()).toBe(true);
  });
});

describe('diagram export', () => {
  const regular = new Uint8Array(readFileSync('apps/web/public/fonts/inter-400.woff2'));
  const semibold = new Uint8Array(readFileSync('apps/web/public/fonts/inter-600.woff2'));

  function exportAssets(fontStatus = 200) {
    transport = (input) => {
      if (input === '/resvg/index_bg.wasm') return new Response(new Uint8Array([0, 97, 115, 109]));
      if (input === '/fonts/inter-400.woff2') return new Response(regular, { status: fontStatus });
      if (input === '/fonts/inter-600.woff2') return new Response(semibold);
    };
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:diagram-export');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    return downloads;
  }

  it('passes both bundled font buffers into PNG rendering so exported labels can render', async () => {
    sessionStorage.setItem('aw_modelId', 'saved-model');
    const download = exportAssets();
    await mount();
    await click('PNG');
    await act(async () => { await vi.waitFor(() => expect(download).toHaveLength(1)); });
    const [svg, fonts] = rasterizer.renderPng.mock.calls[0] as [string, Uint8Array[]];
    expect(svg).toContain('<text');
    const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    expect(fonts.map(digest)).toEqual([digest(regular), digest(semibold)]);
    expect(download[0]).toMatch(/\.png$/);
    expect(container.textContent).toMatch(/PNG.*download/i);
  });

  it('checks font response status and tells the user when PNG falls back to SVG', async () => {
    sessionStorage.setItem('aw_modelId', 'saved-model');
    const download = exportAssets(404);
    await mount();
    await click('PNG');
    await act(async () => { await vi.waitFor(() => expect(download).toHaveLength(1)); });
    expect(rasterizer.renderPng).not.toHaveBeenCalled();
    expect(download[0]).toMatch(/\.svg$/);
    expect(container.textContent).toMatch(/PNG.*unavailable.*SVG/i);
  });

  it('keeps the SVG object URL alive until the download has started', async () => {
    sessionStorage.setItem('aw_modelId', 'saved-model');
    const download = exportAssets();
    await mount();
    vi.useFakeTimers();
    await click('SVG');
    await act(async () => { await vi.waitFor(() => expect(download).toHaveLength(1)); });
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:diagram-export');
  });
});

describe('model JSON export', () => {
  const SHA = 'd66599cceb3a151f64d45eb1cc46afe59c386c1f';
  const privateRepository = () => {
    const m = structuredClone(validFullModelExtended);
    m.privacy = { classification: 'private', boundary: 'local-only' };
    m.nodes[0]!.evidence = [{ repo: 'local/archwoven', commit: SHA, path: 'packages/jobs/src/queue.ts', lines: [1, 42] }];
    return m;
  };

  function captureDownloads(model = validFullModelExtended) {
    sessionStorage.setItem('aw_modelId', 'saved-model');
    transport = (input) => input === '/api/models/saved-model' ? Response.json({ model }) : undefined;
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { blobs.push(blob as Blob); return 'blob:model-json'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    return { blobs, names };
  }
  const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  const press = async (text: string) => { const b = button(text); expect(b, `Button ${text}`).toBeDefined(); await act(async () => b!.click()); };

  it('downloads the exact saved model without any server call or rasterizing', async () => {
    const { blobs, names } = captureDownloads();
    await mount();
    const before = requests.length;
    await press('JSON');
    await act(async () => { await vi.waitFor(() => expect(names).toHaveLength(1)); });
    expect(names[0]).toBe('archwoven-e-commerce-platform-r1.json');
    expect(blobs[0]!.type).toBe('application/json');
    expect(JSON.parse(await blobs[0]!.text())).toEqual(validFullModelExtended);
    expect(requests.slice(before)).toEqual([]);
    expect(rasterizer.renderPng).not.toHaveBeenCalled();
    expect(container.textContent).toContain('JSON downloaded.');
  });

  it('exports JSON for a valid model that has no views to draw', async () => {
    const model = { ...structuredClone(validFullModelExtended), views: [] };
    const { blobs, names } = captureDownloads(model);
    await mount();
    await press('JSON');
    await act(async () => { await vi.waitFor(() => expect(names).toHaveLength(1)); });
    expect(JSON.parse(await blobs[0]!.text()).views).toEqual([]);
  });

  it('offers no evidence-free copy or source notice when evidence carries only notes', async () => {
    captureDownloads();
    await mount();
    expect(button('JSON')).toBeDefined();
    expect(button('JSON (no evidence)')).toBeUndefined();
    expect(container.textContent).not.toMatch(/repository, commit and file references/);
  });

  it('warns before a private full download and offers a copy without source references', async () => {
    const model = privateRepository();
    const { blobs, names } = captureDownloads(model);
    await mount();
    const notice = container.querySelector('[role="note"]');
    expect(notice?.textContent).toContain('Full JSON includes repository, commit and file references (local/archwoven).');
    expect(notice?.textContent).toContain('names and IDs may still mention files');
    expect(button('JSON (no evidence)')?.getAttribute('aria-describedby')).toBe(notice?.id);
    await press('JSON (no evidence)');
    await act(async () => { await vi.waitFor(() => expect(names).toHaveLength(1)); });
    expect(names[0]).toBe('archwoven-e-commerce-platform-r1-no-evidence.json');
    const text = await blobs[0]!.text();
    expect(text).not.toContain(SHA);
    expect(text).not.toContain('local/archwoven');
    expect(JSON.parse(text).nodes[0].evidence).toEqual([]);
    expect(container.textContent).toContain('JSON without evidence downloaded.');
  });

  it('explains the evidence-free copy for public repository maps without a private warning', async () => {
    const model = privateRepository();
    model.privacy = { classification: 'public', boundary: 'external-allowed' };
    captureDownloads(model);
    await mount();
    const notice = container.querySelector('[role="note"]');
    expect(notice?.textContent).not.toContain('Full JSON includes');
    expect(notice?.textContent).toContain('names and IDs may still mention files');
    expect(button('JSON (no evidence)')).toBeDefined();
  });

  it('treats a local-only boundary as private even when classification says public', async () => {
    const model = privateRepository();
    model.privacy = { classification: 'public', boundary: 'local-only' };
    captureDownloads(model);
    await mount();
    expect(container.querySelector('[role="note"]')?.textContent).toContain('Full JSON includes repository, commit and file references (local/archwoven).');
  });
});


describe('clarification answer and skip',()=>{
  const prompt='Store orders. Store nothing.';
  const questions=['Should orders persist?','Who can submit orders?'];
  let continuations: Record<string,unknown>[];
  function clarify(fail=false){
    continuations=[];
    transport=(input,init)=>{
      if(input==='/api/generate'){
        const body=JSON.parse(String(init?.body));
        if(body.clarification){continuations.push(body);return fail?Response.json({error:'Provider unavailable'},{status:502}):Response.json({jobId:'continued',remaining:5},{status:202});}
        return Response.json({jobId:'ask',remaining:5},{status:202});
      }
      if(input==='/api/jobs/ask')return Response.json({status:'clarifying',questions,remaining:6});
      if(input==='/api/jobs/continued')return Response.json({status:'succeeded',modelId:'clarified-model',revision:1});
      return undefined;
    };
  }
  it('answers real job questions without losing the description and opens the generated diagram',async()=>{
    clarify();await mount();await fill('#system-description',prompt);await click('Generate diagram');
    expect(container.textContent).toContain(questions[0]);
    await fill('#clarification-answer-0','Keep orders transient.');await click('Continue with answers');
    expect(continuations[0]).toMatchObject({clarification:{jobId:'ask',answers:['Keep orders transient.','']}});
    expect(container.querySelector<HTMLTextAreaElement>('#system-description')!.value).toBe(prompt);
    expect(window.location.hash).toContain('model=clarified-model');
  });
  it('skip sends no invented answers, and editing returns to the original description',async()=>{
    clarify();await mount();await fill('#system-description',prompt);await click('Generate diagram');
    await click('Edit description');expect(container.querySelector<HTMLTextAreaElement>('#system-description')!.value).toBe(prompt);
    await click('Generate diagram');await click('Skip for now');expect(continuations[0]).toMatchObject({clarification:{jobId:'ask',skip:true}});
  });
  it('retains answers on continuation error so retry uses the same request',async()=>{
    clarify(true);await mount();await fill('#system-description',prompt);await click('Generate diagram');
    await fill('#clarification-answer-0','Transient.');await click('Continue with answers');
    expect(container.textContent).toContain('Provider unavailable');expect(container.querySelector<HTMLTextAreaElement>('#clarification-answer-0')!.value).toBe('Transient.');
    await click('Continue with answers');expect(continuations).toHaveLength(2);expect(continuations[0]).toEqual(continuations[1]);
  });
});


it('keeps clarification answers if the saved diagram cannot yet be fetched',async()=>{
  transport=(input,init)=>{
    if(input==='/api/generate')return Response.json({jobId:JSON.parse(String(init?.body)).clarification?'done':'ask'},{status:202});
    if(input==='/api/jobs/ask')return Response.json({status:'clarifying',questions:['Persist orders?']});
    if(input==='/api/jobs/done')return Response.json({status:'succeeded',modelId:'unavailable-model'});
    if(input==='/api/models/unavailable-model')return Response.json({error:'unavailable'},{status:503});
  };
  await mount();await fill('#system-description','Store orders. No storage.');await click('Generate diagram');
  await fill('#clarification-answer-0','No persistence.');await click('Continue with answers');
  expect(container.querySelector<HTMLTextAreaElement>('#clarification-answer-0')?.value).toBe('No persistence.');
  expect(container.textContent).toContain('Could not open the saved diagram');
});


it('shows skipped clarification gaps immediately when the job has an empty gaps array',async()=>{
  const model=structuredClone(validFullModelExtended);model.openQuestions=[{id:'q.unanswered',text:'Who can submit orders?'}];
  transport=(input,init)=>{
    if(input==='/api/generate')return Response.json({jobId:JSON.parse(String(init?.body)).clarification?'done':'ask'},{status:202});
    if(input==='/api/jobs/ask')return Response.json({status:'clarifying',questions:['Who can submit orders?']});
    if(input==='/api/jobs/done')return Response.json({status:'succeeded',modelId:'clarified',gaps:[]});
    if(input==='/api/models/clarified')return Response.json({model});
  };
  await mount();await fill('#system-description','An order service');await click('Generate diagram');await click('Skip for now');
  expect(container.querySelector('[title="Who can submit orders?"]')).not.toBeNull();
});


it.each(['Sequence','ER · data model'])('keeps the requested %s view after clarification continuation',async(label)=>{
  transport=(input,init)=>{
    if(input==='/api/generate')return Response.json({jobId:JSON.parse(String(init?.body)).clarification?'done':'ask'},{status:202});
    if(input==='/api/jobs/ask')return Response.json({status:'clarifying',questions:['Which flow?']});
    if(input==='/api/jobs/done')return Response.json({status:'succeeded',modelId:'clarified',gaps:[]});
  };
  await mount();await click(label);await fill('#system-description','Order system');await click('Generate diagram');await click('Skip for now');
  expect(container.querySelector('[aria-label="Rendered view"]')?.textContent).toBe(label==='Sequence'?'view.sequence':'view.er');
});


describe('architecture orientation controls',()=>{
  it('saves the current view direction, supports undo and restores the saved direction on reload',async()=>{
    window.history.replaceState(null,'','/workspace#model=m1');let stored=structuredClone(validFullModelExtended);const original=structuredClone(stored);
    transport=(input,init)=>{
      if(input==='/api/models/m1'&&!init)return Response.json({model:stored});
      if(input==='/api/models/m1/edit'){
        const body=JSON.parse(String(init?.body));expect(body).toEqual({baseRevision:stored.revision,action:{type:'orient',viewId:'view.architecture',orientation:'LR'}});
        stored=structuredClone(stored);stored.parentId=stored.revision;stored.revision++;stored.views[0]!.orientation='LR';return Response.json({model:stored});
      }
      if(input==='/api/models/m1/undo'){stored={...original,parentId:stored.revision,revision:stored.revision+1};return Response.json({model:stored});}
    };
    await mount();expect(container.querySelector('button[aria-label="Vertical architecture layout"]')?.getAttribute('aria-pressed')).toBe('true');
    await click('Horizontal');expect(container.querySelector('button[aria-label="Horizontal architecture layout"]')?.getAttribute('aria-pressed')).toBe('true');
    await click('↶ Undo');expect(container.querySelector('button[aria-label="Vertical architecture layout"]')?.getAttribute('aria-pressed')).toBe('true');
    await click('Horizontal');await act(async()=>root.unmount());root=createRoot(container);await mount();
    expect(container.querySelector('button[aria-label="Horizontal architecture layout"]')?.getAttribute('aria-pressed')).toBe('true');expect(requests).not.toContain('/api/refine');
  });
  it('keeps the accepted direction and surfaces failed saves',async()=>{
    window.history.replaceState(null,'','/workspace#model=m1');
    transport=input=>input.endsWith('/edit')?Response.json({error:'Save unavailable'},{status:503}):undefined;
    await mount();await click('Horizontal');expect(container.textContent).toContain('Save unavailable');expect(container.querySelector('button[aria-label="Vertical architecture layout"]')?.getAttribute('aria-pressed')).toBe('true');
  });
  it('explains rearrangement for manual positions and hides controls on sequence/ER views',async()=>{
    const m=structuredClone(validFullModelExtended);m.layout={'gateway.api':{x:400,y:50}};
    window.history.replaceState(null,'','/workspace#model=m1');transport=input=>input==='/api/models/m1'?Response.json({model:m}):undefined;
    await mount();expect(container.textContent).toMatch(/manual.*positions|manually placed/i);
    await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('.aw-view-tabs button')].find(b=>b.textContent==='sequence')!.click());
    expect(container.querySelector('[aria-label="Architecture orientation"]')).toBeNull();
    await act(async()=>[...container.querySelectorAll<HTMLButtonElement>('.aw-view-tabs button')].find(b=>b.textContent==='Data model')!.click());
    expect(container.querySelector('[aria-label="Architecture orientation"]')).toBeNull();
  });
});


it('discloses when auto-arranging pinned nodes also affects another graph view',async()=>{
  const m=structuredClone(validFullModelExtended);m.layout={'gateway.api':{x:400,y:50}};
  m.views.push({id:'view.detail',type:'component-detail',focus:'gateway.api',nodes:['gateway.api'],edges:[]});
  window.history.replaceState(null,'','/workspace#model=m1');transport=input=>input==='/api/models/m1'?Response.json({model:m}):undefined;
  await mount();expect(container.querySelector('#orientation-help')?.textContent).toContain('shared nodes in other views');
});

describe('component detail views', () => {
  const ok = (r: { ok: true; model: SystemModel } | { ok: false; errors: string[] }) => { if (!r.ok) throw new Error(r.errors.join('; ')); return r.model; };
  /** Edit responses deliver their body late, as on a busy CI runner, so assertions cannot race the save. */
  const late = (response: Response) => { const json = response.json.bind(response); response.json = () => new Promise(r => setTimeout(r, 20)).then(json); return response; };
  /** Fake server backed by the real model edit functions. */
  function detailServer(initial: SystemModel = structuredClone(validFullModelExtended)) {
    let stored = initial;
    const revisions = new Map([[stored.revision, stored]]);
    const actions: { type: string }[] = [];
    let stale: SystemModel | null = null;
    transport = (input, init) => {
      if (input === '/api/models/m1' && !init) return Response.json({ model: stored });
      if (input === '/api/models/m1/edit') {
        const body = JSON.parse(String(init?.body));
        actions.push(body.action);
        if (stale) { stored = stale; stale = null; revisions.set(stored.revision, stored); return late(Response.json({ reason: 'stale-revision', message: 'The diagram changed elsewhere. Review the latest version and try again.', model: stored }, { status: 409 })); }
        const a = body.action;
        const r = a.type === 'detail' ? openDetailView(stored, a.target) : a.type === 'close-detail' ? closeDetailView(stored, a.viewId)
          : applyEditOps(stored, [{ op: 'update', target: a.target, patch: { label: a.label }, baseRevision: stored.revision, summary: 'rename' }]);
        if (!r.ok) return Response.json({ errors: r.errors }, { status: 400 });
        stored = r.model; revisions.set(stored.revision, stored);
        return late(Response.json({ model: stored, revision: stored.revision }));
      }
      if (input === '/api/models/m1/undo') {
        const body = JSON.parse(String(init?.body));
        stored = undoTo(stored, revisions.get(body.prevRevision)!); revisions.set(stored.revision, stored);
        return Response.json({ model: stored });
      }
      return undefined;
    };
    return { actions, stored: () => stored, staleNext: (m: SystemModel) => { stale = m; } };
  }
  const rendered = () => container.querySelector('[aria-label="Rendered view"]')!.textContent;
  const hashView = () => new URLSearchParams(window.location.hash.slice(1)).get('view');
  const tabs = () => [...container.querySelectorAll('.aw-view-tabs > button[aria-pressed], .aw-view-tabs > .aw-detail-tab > button[aria-pressed]')].map(b => b.textContent);
  const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
  const labelled = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  // A click does not await its async handler: wait until any save it started has finished.
  const saving = () => container.querySelector('.aw-refine-status')?.textContent === 'Saving change…';
  const press = async (b: HTMLButtonElement | null | undefined) => {
    expect(b).toBeTruthy();
    await act(async () => b!.click());
    for (let i = 0; i < 100 && saving(); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(saving()).toBe(false);
  };
  beforeEach(() => window.history.replaceState(null, '', '/workspace#model=m1'));

  it('opens a saved detail tab from the inspector and switches to it without inference', async () => {
    const server = detailServer();
    await mount();
    expect(container.querySelector('[aria-label="Can move"]')!.textContent).toBe('true');
    await click('Inspect API');
    await press(button('Open detail'));
    expect(server.actions).toEqual([{ type: 'detail', target: 'gateway.api' }]);
    expect(rendered()).toBe('detail:gateway.api');
    expect(hashView()).toBe('detail:gateway.api');
    expect(tabs()).toEqual(['architecture', 'sequence', 'Data model', 'API Gateway · detail']);
    expect(container.querySelector('[role="note"].aw-detail-caption')?.textContent).toBe('API Gateway and its direct connections · arranged automatically');
    expect(container.querySelector('[aria-label="Can move"]')!.textContent).toBe('false');
    expect(container.textContent).toContain('Detail view opened.');
    // The canvas keeps its selection when the node is in the new view; the inspector must agree.
    expect(container.querySelector('input[aria-label="Element name"]')).toBeTruthy();
    expect(button('Open detail')).toBeUndefined();
    expect(requests).not.toContain('/api/refine');
  });

  it('switches to an existing detail tab without writing', async () => {
    const server = detailServer(ok(openDetailView(structuredClone(validFullModelExtended), 'gateway.api')));
    window.history.replaceState(null, '', '/workspace#model=m1&view=view.architecture');
    await mount();
    await click('Inspect API');
    await press(button('Open detail'));
    expect(server.actions).toEqual([]);
    expect(rendered()).toBe('detail:gateway.api');
    expect(hashView()).toBe('detail:gateway.api');
    expect(container.querySelector('input[aria-label="Element name"]')).toBeTruthy();
  });

  it('offers no detail action for the component whose detail is already showing', async () => {
    detailServer(ok(openDetailView(structuredClone(validFullModelExtended), 'gateway.api')));
    window.history.replaceState(null, '', '/workspace#model=m1&view=detail:gateway.api');
    await mount();
    await click('Inspect API');
    expect(container.querySelector('input[aria-label="Element name"]')).toBeTruthy();
    expect(button('Open detail')).toBeUndefined();
  });

  it('offers no detail action for data entities or connections', async () => {
    detailServer();
    await mount();
    await click('Inspect entity');
    expect(button('Open detail')).toBeUndefined();
    await click('Inspect connection');
    expect(button('Open detail')).toBeUndefined();
  });

  it('closes the active detail tab and returns to the first view', async () => {
    const server = detailServer(ok(openDetailView(structuredClone(validFullModelExtended), 'gateway.api')));
    window.history.replaceState(null, '', '/workspace#model=m1&view=detail:gateway.api');
    await mount();
    expect(rendered()).toBe('detail:gateway.api');
    await press(labelled('Close API Gateway detail'));
    expect(server.actions).toEqual([{ type: 'close-detail', viewId: 'detail:gateway.api' }]);
    expect(rendered()).toBe('view.architecture');
    expect(hashView()).toBe('view.architecture');
    expect(tabs()).toEqual(['architecture', 'sequence', 'Data model']);
  });

  it('falls back to the first view when undo removes the active detail tab', async () => {
    detailServer();
    await mount();
    await click('Inspect API');
    await press(button('Open detail'));
    await click('↶ Undo');
    expect(rendered()).toBe('view.architecture');
    expect(hashView()).toBe('view.architecture');
  });

  it('restores a detail tab from the link and falls back when it no longer exists', async () => {
    detailServer(ok(openDetailView(structuredClone(validFullModelExtended), 'gateway.api')));
    window.history.replaceState(null, '', '/workspace#model=m1&view=detail:gateway.api');
    await mount();
    expect(rendered()).toBe('detail:gateway.api');
    await act(async () => root.unmount());
    root = createRoot(container);
    detailServer();
    await mount();
    expect(rendered()).toBe('view.architecture');
    expect(hashView()).toBe('view.architecture');
  });

  it('adopts the latest diagram when the open is stale', async () => {
    const server = detailServer();
    await mount();
    const latest = structuredClone(validFullModelExtended);
    latest.revision = 2; latest.parentId = 1; latest.nodes.find(n => n.id === 'gateway.api')!.label = 'Edge API';
    server.staleNext(latest);
    await click('Inspect API');
    await press(button('Open detail'));
    expect(rendered()).toBe('view.architecture');
    expect(container.querySelector('[aria-label="Rendered API"]')!.textContent).toBe('Edge API');
    expect(container.textContent).toContain('The diagram changed elsewhere');
  });

  it('relabels the tab and caption when the component is renamed', async () => {
    detailServer(ok(openDetailView(structuredClone(validFullModelExtended), 'gateway.api')));
    window.history.replaceState(null, '', '/workspace#model=m1&view=detail:gateway.api');
    await mount();
    await click('Inspect API');
    await fill('input[aria-label="Element name"]', 'Edge Gateway');
    await press(button('Save name'));
    expect(tabs().at(-1)).toBe('Edge Gateway · detail');
    expect(labelled('Close Edge Gateway detail')).toBeTruthy();
    expect(container.querySelector('.aw-detail-caption')?.textContent).toMatch(/^Edge Gateway and its direct connections/);
  });

  it('says when a component has no direct connections', async () => {
    const m = structuredClone(validFullModelExtended);
    m.semanticChecks = null;
    m.nodes.push({ id: 'svc.lonely', kind: 'service', label: 'Lonely', provenance: 'proposed', evidence: [] });
    detailServer(ok(openDetailView(m, 'svc.lonely')));
    window.history.replaceState(null, '', '/workspace#model=m1&view=detail:svc.lonely');
    await mount();
    expect(container.querySelector('.aw-detail-caption')?.textContent).toBe('Lonely and its direct connections · arranged automatically · no direct connections');
  });

  it('disables opening at the detail-view limit and explains why', async () => {
    let m = structuredClone(validFullModelExtended);
    m.semanticChecks = null;
    for (let i = 0; i < 12; i++) { m.nodes.push({ id: `svc.n${i}`, kind: 'service', label: `N${i}`, provenance: 'proposed', evidence: [] }); m = ok(openDetailView(m, `svc.n${i}`)); }
    const server = detailServer(m);
    window.history.replaceState(null, '', '/workspace#model=m1&view=view.architecture');
    await mount();
    await click('Inspect API');
    expect(button('Open detail')?.disabled).toBe(true);
    expect(container.textContent).toContain('Close a detail view to open another (limit 12).');
    expect(server.actions).toEqual([]);
  });

  it('names detail exports with characters every file system accepts', async () => {
    detailServer(ok(openDetailView(structuredClone(validFullModelExtended), 'gateway.api')));
    window.history.replaceState(null, '', '/workspace#model=m1&view=detail:gateway.api');
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:detail');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    await mount();
    await click('SVG');
    await act(async () => { await vi.waitFor(() => expect(names).toHaveLength(1)); });
    expect(names[0]).toBe('archwoven-detail-gateway.api.svg');
  });
});

describe('expanding internals', () => {
  const ok = (r: { ok: true; model: SystemModel } | { ok: false; errors: string[] }) => { if (!r.ok) throw new Error(r.errors.join('; ')); return r.model; };
  const withDetail = (m = structuredClone(validFullModelExtended)) => ok(openDetailView(m, 'gateway.api'));
  const expanded = (m = withDetail()) => ok(applyExpansion(m, 'gateway.api', fakeExpansion(m, 'gateway.api')));
  function expandServer(initial: SystemModel, mode: 'ok' | 'fail' | 'stale' = 'ok', deploy: 'hosted' | 'local' = 'hosted') {
    let stored = initial;
    const bodies: Record<string, unknown>[] = [];
    transport = (input, init) => {
      if (input === '/api/quota') return Response.json({ remaining: bodies.length ? 5.75 : 6, pool: 6, fake: true, lastTask: null });
      if (input === '/api/config') return Response.json({ mode: deploy, llmReady: true });
      if (input === '/api/models/m1' && !init) return Response.json({ model: stored });
      if (input === '/api/models/m1/expand') {
        const body = JSON.parse(String(init?.body)); bodies.push(body);
        if (mode === 'fail') return Response.json({ reason: 'expand-failed', errors: ['Provider unavailable'] }, { status: 502 });
        if (mode === 'stale') { stored = structuredClone(stored); stored.parentId = stored.revision; stored.revision++; stored.nodes.find(n => n.id === 'gateway.api')!.label = 'Edge API'; return Response.json({ reason: 'stale-revision', message: 'The diagram changed elsewhere. Review the latest version and try again.', model: stored }, { status: 409 }); }
        stored = ok(applyExpansion(stored, body.target, fakeExpansion(stored, body.target)));
        return Response.json({ model: stored, revision: stored.revision, remaining: 5.75 });
      }
      return undefined;
    };
    return { bodies, stored: () => stored };
  }
  const caption = () => container.querySelector('.aw-detail-caption')?.textContent;
  const expandButton = () => [...container.querySelectorAll('button')].find(b => b.textContent?.startsWith('Expand internals'));
  const hint = () => container.querySelector<HTMLInputElement>('input[aria-label="Optional focus for the expansion"]');
  beforeEach(() => window.history.replaceState(null, '', '/workspace#model=m1&view=detail:gateway.api'));

  it('shows no credit cost where money caps replace credits', async () => {
    transport = (input, init) => {
      if (input === '/api/quota') return Response.json({ remaining: null, pool: null, fake: false });
      if (input === '/api/models/m1' && !init) return Response.json({ model: withDetail() });
      return undefined;
    };
    await mount();
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(expandButton()?.textContent).toBe('Expand internals');
  });

  it('runs a hosted expansion as a job, applying its result or keeping the hint when it fails', async () => {
    const stored = withDetail();
    let outcome: 'succeeded' | 'failed' = 'succeeded', expandedModel: SystemModel | null = null;
    transport = (input, init) => {
      if (input === '/api/models/m1' && !init) return Response.json({ model: stored });
      if (input === '/api/models/m1/expand') {
        const body = JSON.parse(String(init?.body));
        expandedModel = ok(applyExpansion(body.model, body.target, fakeExpansion(body.model, body.target)));
        return Response.json({ jobId: 'expand-job', remaining: null, resumable: true }, { status: 202 });
      }
      if (input === '/api/jobs/expand-job') return Response.json(outcome === 'succeeded' ? { status: 'succeeded', modelId: 'm1', revision: expandedModel!.revision } : { status: 'failed', error: 'Could not expand: provider unavailable.' });
      if (input === '/api/jobs/expand-job/result') return Response.json({ model: expandedModel });
      return undefined;
    };
    await mount();
    outcome = 'failed';
    await fill('input[aria-label="Optional focus for the expansion"]', 'auth first');
    await act(async () => expandButton()!.click());
    for (let i = 0; i < 20; i++) await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(container.textContent).toContain('Could not expand: provider unavailable.');
    expect(hint()?.value).toBe('auth first');
    outcome = 'succeeded';
    await act(async () => expandButton()!.click());
    for (let i = 0; i < 20; i++) await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(container.textContent).toContain('Added 2 inferred internals to API Gateway.');
    expect(requests).toContain('/api/jobs/expand-job/result');
  });

  it('expands the focus from its detail tab and shows the inferred internals', async () => {
    const server = expandServer(withDetail());
    await mount();
    expect(expandButton()?.textContent).toBe('Expand internals · 0.25 credit');
    await fill('input[aria-label="Optional focus for the expansion"]', 'auth first');
    await act(async () => expandButton()!.click());
    expect(server.bodies.map(({ model, ...rest }) => rest)).toEqual([{ baseRevision: 2, target: 'gateway.api', hint: 'auth first' }]);
    expect(server.bodies.every(b => (b.model as { revision?: number } | undefined)?.revision === b.baseRevision)).toBe(true);
    expect(caption()).toBe('Inside API Gateway (inferred) · and its direct connections');
    expect(container.querySelector('.aw-detail-source')).toBeNull();
    expect(container.textContent).toContain('Added 2 inferred internals to API Gateway.');
    expect(container.textContent).toContain('5.75/6 credits today');
    expect(expandButton()).toBeUndefined();
    expect(requests).not.toContain('/api/refine');
  });

  it('keeps the hint and the diagram when the expansion fails', async () => {
    expandServer(withDetail(), 'fail');
    await mount();
    await fill('input[aria-label="Optional focus for the expansion"]', 'auth first');
    await act(async () => expandButton()!.click());
    expect(container.textContent).toContain('Provider unavailable');
    expect(hint()!.value).toBe('auth first');
    expect(caption()).toMatch(/^API Gateway and its direct connections/);
    expect(expandButton()?.disabled).toBe(false);
  });

  it('adopts the latest diagram when the expansion is stale', async () => {
    expandServer(withDetail(), 'stale');
    await mount();
    await act(async () => expandButton()!.click());
    expect(container.textContent).toContain('The diagram changed elsewhere');
    expect(caption()).toMatch(/^Edge API and its direct connections/);
  });

  it('sends no hint field when the hint is empty', async () => {
    const server = expandServer(withDetail());
    await mount();
    await act(async () => expandButton()!.click());
    expect(server.bodies.map(({ model, ...rest }) => rest)).toEqual([{ baseRevision: 2, target: 'gateway.api' }]);
    expect(server.bodies.every(b => (b.model as { revision?: number } | undefined)?.revision === b.baseRevision)).toBe(true);
  });

  it('offers no expansion for an already expanded component or one of its internals', async () => {
    const m = expanded();
    expandServer(m);
    await mount();
    expect(expandButton()).toBeUndefined();
    await act(async () => root.unmount());
    root = createRoot(container);
    const internal = m.nodes.find(n => n.group === 'gateway.api')!.id;
    expandServer(ok(openDetailView(m, internal)));
    window.history.replaceState(null, '', `/workspace#model=m1&view=detail:${internal}`);
    await mount();
    expect(caption()).toMatch(/and its direct connections/);
    expect(expandButton()).toBeUndefined();
  });

  it('shows no credit cost in local mode', async () => {
    expandServer(withDetail(), 'ok', 'local');
    await mount();
    expect(expandButton()?.textContent).toBe('Expand internals');
  });

  it('says repository internals are inferred, not found in source', async () => {
    const m = structuredClone(validFullModelExtended);
    m.nodes.find(n => n.id === 'gateway.api')!.provenance = 'source-supported';
    expandServer(expanded(withDetail(m)));
    await mount();
    expect(container.querySelector('[role="note"].aw-detail-source')?.textContent).toBe('Internals are inferred, not found in source.');
  });

  it('names overview links the internals no longer match', async () => {
    let m = expanded();
    m = ok(applyEditOps(m, [{ op: 'add', target: 'e.api-redis', patch: { id: 'e.api-redis', from: 'gateway.api', to: 'datastore.redis', type: 'data', provenance: 'proposed' }, baseRevision: m.revision, summary: 'add' }]));
    expandServer(m);
    await mount();
    expect(container.querySelector('[role="status"].aw-detail-drift')?.textContent).toContain('API Gateway now also connects to Redis Cache (data); its internals don’t show which part does.');
  });
});

describe('refinement refusals keep the instruction', () => {
  beforeEach(() => window.history.replaceState(null, '', '/workspace#model=m1'));
  const instruction = () => container.querySelector<HTMLInputElement>('input[aria-label="Refinement instruction"]')!.value;

  it('shows the server reason and keeps the typed instruction when nothing was saved', async () => {
    transport = (input, init) => {
      if (input === '/api/models/m1' && !init) return Response.json({ model: validFullModelExtended });
      if (input === '/api/refine') return Response.json({ reason: 'refine-failed', errors: ['Customer → API Gateway is backed by source evidence and can\'t be removed by refinement.'] }, { status: 502 });
      return undefined;
    };
    await mount();
    await fill('input[aria-label="Refinement instruction"]', 'Remove the link from Customer to API Gateway');
    await click('Refine');
    expect(container.textContent).toContain('Customer → API Gateway is backed by source evidence and can\'t be removed by refinement.');
    expect(instruction()).toBe('Remove the link from Customer to API Gateway');
  });

  it('clears the instruction once the refinement is saved', async () => {
    const refined = structuredClone(validFullModelExtended); refined.revision = 2; refined.parentId = 1;
    transport = (input, init) => {
      if (input === '/api/models/m1' && !init) return Response.json({ model: validFullModelExtended });
      if (input === '/api/refine') return Response.json({ ops: [{ op: 'update', target: 'gateway.api', patch: { label: 'Edge' }, baseRevision: 1, summary: 'Rename' }], model: refined, revision: 2, remaining: 5.75 });
      return undefined;
    };
    await mount();
    await fill('input[aria-label="Refinement instruction"]', 'Rename the gateway');
    await click('Refine');
    expect(instruction()).toBe('');
  });
});

describe('links pasted into an open tab', () => {
  beforeEach(() => window.history.replaceState(null, '', '/workspace#model=m1'));

  it('opens the diagram a changed #model= names without a reload', async () => {
    const other = structuredClone(validFullModelExtended); other.openQuestions = [{ id: 'q.other', text: 'Only the other diagram asks this.' }];
    const requested: string[] = [];
    transport = (input, init) => {
      if (typeof input === 'string' && input.startsWith('/api/models/')) requested.push(input);
      if (input === '/api/models/m1' && !init) return Response.json({ model: validFullModelExtended });
      if (input === '/api/models/m2' && !init) return Response.json({ model: other });
      return undefined;
    };
    await mount();
    expect(container.textContent).not.toContain('Only the other diagram asks this.');
    await act(async () => { window.location.hash = '#model=m2'; window.dispatchEvent(new HashChangeEvent('hashchange')); await new Promise((r) => setTimeout(r, 0)); });
    for (let i = 0; i < 50 && !container.textContent!.includes('Only the other diagram asks this.'); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(requested).toEqual(['/api/models/m1', '/api/models/m2']);
    expect(container.textContent).toContain('Only the other diagram asks this.');
    expect(sessionStorage.getItem('aw_modelId')).toBe('m2');
    expect(new URLSearchParams(window.location.hash.slice(1)).get('model')).toBe('m2');
  });

  it('applies same-diagram views and falls back for omitted or invalid views without any API calls', async () => {
    await mount();
    const initialRequests = [...requests];
    let version = container.querySelector('[aria-label="Permalink version"]')!.textContent;
    for (const [suffix, view] of [
      ['&view=view.sequence&focus=gateway.api', 'view.sequence'],
      ['&view=missing&relation=e.user-api', validFullModelExtended.views[0]!.id],
      ['&view=view.sequence', 'view.sequence'],
      ['', validFullModelExtended.views[0]!.id],
    ]) {
      await act(async () => {
        window.history.replaceState(null, '', `/workspace#model=m1${suffix}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
      expect(container.querySelector('[aria-label="Rendered view"]')!.textContent).toBe(view);
      const nextVersion = container.querySelector('[aria-label="Permalink version"]')!.textContent;
      expect(nextVersion).not.toBe(version);
      version = nextVersion;
      expect(new URLSearchParams(window.location.hash.slice(1)).get('view')).toBe(view);
      expect(requests).toEqual(initialRequests);
    }
  });

  it('does not refetch the same diagram for interaction-only hash changes', async () => {
    const calls: string[] = [];
    transport = (input, init) => {
      if (input === '/api/models/m1' && !init) { calls.push(input); return Response.json({ model: validFullModelExtended }); }
      return undefined;
    };
    await mount();
    await act(async () => { window.location.hash = '#model=m1&focus=gateway.api'; window.dispatchEvent(new HashChangeEvent('hashchange')); await new Promise((r) => setTimeout(r, 0)); });
    expect(calls).toHaveLength(1);
  });
});

describe('refine status', () => {
  beforeEach(() => window.history.replaceState(null, '', '/workspace#model=m1'));

  it('announces the full refusal as a live status that is never cut to one line', async () => {
    const reason = 'Customer → API Gateway is backed by source evidence and can\'t be removed by refinement. Edit the source or regenerate the diagram instead.';
    transport = (input, init) => {
      if (input === '/api/models/m1' && !init) return Response.json({ model: validFullModelExtended });
      if (input === '/api/refine') return Response.json({ reason: 'refine-failed', errors: [reason] }, { status: 502 });
      return undefined;
    };
    await mount();
    await fill('input[aria-label="Refinement instruction"]', 'Remove the link');
    await click('Refine');
    const status = container.querySelector<HTMLElement>('.aw-refine-bar [role="status"]')!;
    expect(status.textContent).toContain(reason);
    expect(status.style.whiteSpace).not.toBe('nowrap');
    expect(status.style.textOverflow).toBe('');
    expect(status.style.overflow).not.toBe('hidden');
  });
});

describe('stable warnings', () => {
  it('shows the same gaps on the first load and after a reload, from the saved model only', async () => {
    const saved = structuredClone(validFullModelExtended);
    saved.openQuestions = [{ id: 'gap.source.1', text: 'Imports do not prove runtime calls.' }, { id: 'gap.ingest.1', text: 'Skipped 1 binary file: docs/a.png.' }];
    transport = (input, init) => {
      if (input === '/api/repo') return Response.json({ jobId: 'repo-job', remaining: 4 }, { status: 202 });
      if (input === '/api/jobs/repo-job') return Response.json({ status: 'succeeded', modelId: 'repo-model', revision: 1, gaps: ['an ephemeral job-only note', 'Skipped 1 binary file: docs/a.png.'] });
      if (input === '/api/models/repo-model' && !init) return Response.json({ model: saved });
      return undefined;
    };
    await mount();
    await click('Import repository');
    await fill('#repository-url', 'https://github.com/foo/bar');
    await click('Analyze repository');
    await act(async () => { await vi.waitFor(() => expect(container.textContent).toMatch(/⚠ \d+ gaps/)); });
    const first = container.textContent!.match(/⚠ (\d+) gaps/)![1];
    expect(first).toBe('2');
    expect(container.textContent).not.toContain('ephemeral job-only note');
    await act(async () => root.unmount());
    root = createRoot(container);
    window.history.replaceState(null, '', '/workspace#model=repo-model');
    await mount();
    await act(async () => { await vi.waitFor(() => expect(container.textContent).toMatch(/⚠ \d+ gaps/)); });
    expect(container.textContent!.match(/⚠ (\d+) gaps/)![1]).toBe(first);
  });
});

describe('import source and credit wording by deployment', () => {
  const localConfig = () => {
    transport = (input, init) => {
      if (input === '/api/config') return Response.json({ mode: 'local', llmReady: true, fake: false });
      if (input === '/api/quota') return Response.json({ remaining: null, pool: 6, fake: false });
      if (input === '/api/repo') { repoBodies.push(JSON.parse(String(init?.body))); return Response.json({ jobId: 'local-job', remaining: null }, { status: 202 }); }
      if (input === '/api/jobs/local-job') return Response.json({ status: 'succeeded', modelId: 'local-model', revision: 1 });
      if (input === '/api/models/local-model' && !init) return Response.json({ model: { ...validFullModelExtended, privacy: { classification: 'private', boundary: 'local-only' } } });
      return undefined;
    };
  };
  let repoBodies: Record<string, unknown>[];
  beforeEach(() => { repoBodies = []; });
  const pressed = (text: string) => [...container.querySelectorAll('button[aria-pressed]')].find(b => b.textContent?.trim() === text)?.getAttribute('aria-pressed');
  const analyze = () => [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Analyze repository') as HTMLButtonElement | undefined;

  it('keeps the GitHub form and credit wording in hosted mode', async () => {
    await mount();
    expect(container.textContent).toContain('6/6 credits today');
    await click('Import repository');
    expect(container.querySelector('#repository-url')).toBeTruthy();
    expect(container.querySelector('#repository-path')).toBeNull();
    expect(pressed('Local folder')).toBeUndefined();
    expect(container.textContent).toContain('Costs 2 credits (6 left)');
  });

  it('never mentions credits in local mode', async () => {
    localConfig();
    await mount();
    expect(container.textContent).toContain('Local · no credit limits');
    expect(container.textContent).not.toMatch(/credits? (today|left)|Costs \d/);
    await click('Import repository');
    expect(container.textContent).not.toMatch(/credits? (today|left)|Costs \d/);
    await click('GitHub');
    expect(container.textContent).toContain('Runs locally; no credits.');
    expect(container.textContent).not.toMatch(/Costs \d/);
  });

  it('imports a local folder by path, defaulting to the local source and hiding branch selection', async () => {
    localConfig();
    await mount();
    await click('Import repository');
    expect(pressed('Local folder')).toBe('true');
    expect(container.querySelector('[aria-label="Repository branch or commit"]')).toBeNull();
    expect(container.textContent).toContain('a git clone on the machine running Archwoven (in Docker, a folder mounted into the container)');
    expect(container.textContent).toContain('Uncommitted and untracked changes are excluded.');
    await fill('#repository-path', '~/code/shop');
    await fill('[aria-label="Repository subdirectory"]', 'services/api');
    await act(async () => analyze()!.click());
    await act(async () => { await vi.waitFor(() => expect(repoBodies).toHaveLength(1)); });
    expect(repoBodies[0]).toMatchObject({ localPath: '~/code/shop', subdir: 'services/api', view: 'architecture' });
    expect(repoBodies[0]).not.toHaveProperty('url');
    expect(typeof repoBodies[0]!.idempotencyKey).toBe('string');
  });

  it.each(['code/shop', './shop', '~other/shop'])('explains and blocks the relative path %j before any request', async (path) => {
    localConfig();
    await mount();
    await click('Import repository');
    await fill('#repository-path', path);
    expect(container.querySelector('#repository-path-error')?.textContent).toBe('Enter the full path to a git clone on this machine, for example /Users/you/code/project or ~/code/project.');
    expect(analyze()!.disabled).toBe(true);
    expect(repoBodies).toEqual([]);
  });

  it('switches back to a GitHub URL without losing the typed path', async () => {
    localConfig();
    await mount();
    await click('Import repository');
    await fill('#repository-path', '/srv/code/shop');
    await click('GitHub');
    expect(container.querySelector('#repository-url')).toBeTruthy();
    expect(container.querySelector('[aria-label="Repository branch or commit"]')).toBeTruthy();
    await click('Local folder');
    expect(container.querySelector<HTMLInputElement>('#repository-path')!.value).toBe('/srv/code/shop');
  });
});

const reportedTask = { id: 'task1', action: 'generate', view: 'architecture', modelId: 'm1', provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', inputTokens: 1000, outputTokens: 500, cacheWriteTokens: 2000, cacheReadTokens: 3000, latencyMs: 1200, repairs: 1, transportRetries: 2, usageComplete: true, attempts: [], outcome: 'repaired', estimatedCostUsd: 0.0246, costBasis: 'anthropic-opus-5-5-2026-10-17' };

describe('last task usage', () => {
  it('restores a compact hosted estimate with reported categories and actual attempts', async () => {
    transport = input => input === '/api/quota' ? Response.json({ remaining: 5, pool: 6, fake: false, lastTask: reportedTask }) : undefined;
    await mount();
    const details = container.querySelector('details.aw-task-usage')!;
    expect(details).not.toBeNull();
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.querySelector('summary')!.textContent).toContain('6,500 tokens');
    expect(details.querySelector('summary')!.textContent).toContain('$0.0246');
    expect(details.textContent).toContain('1 repair');
    expect(details.textContent).toContain('2 retries');
    expect(details.textContent).toContain('3,000');
    expect(details.textContent).toContain('claude-opus-5-5');
    expect(requests.filter(r => r === '/api/generate')).toHaveLength(0);
  });
  it('discloses incomplete local usage and excludes hardware from API cost', async () => {
    transport = input => input === '/api/quota' ? Response.json({ remaining: null, pool: 6, lastTask: { ...reportedTask, provider: 'ollama', model: 'gpt-oss:20b', estimatedCostUsd: 0, costBasis: 'local-inference', usageComplete: false } }) : undefined;
    await mount();
    const details = container.querySelector('details.aw-task-usage')!;
    expect(details.querySelector('summary')!.textContent).toContain('Usage incomplete');
    expect(details.textContent).toContain('No external API charge');
    expect(details.textContent).toContain('Hardware and electricity');
    expect(details.textContent).not.toContain('$0.0246');
  });
  it('refreshes the report after a failed refinement while preserving the diagram', async () => {
    window.history.replaceState(null, '', '/workspace#model=m1');
    let failed = false;
    transport = input => {
      if (input === '/api/quota') return Response.json({ remaining: 5, pool: 6, lastTask: failed ? { ...reportedTask, action: 'refine', outcome: 'failed', usageComplete: false, estimatedCostUsd: null, costBasis: 'unavailable' } : null });
      if (input === '/api/refine') { failed = true; return Response.json({ errors: ['Provider interrupted'] }, { status: 502 }); }
      return undefined;
    };
    await mount(); await fill('input[placeholder^="Refine:"]', 'Add worker'); await click('Refine');
    expect(container.textContent).toContain('Provider interrupted');
    expect(container.querySelector('details.aw-task-usage')!.textContent).toContain('Cost unavailable');
    expect(container.querySelector('[aria-label="Rendered view"]')).not.toBeNull();
  });
});

it('waits for late provider accounting after cancellation without blocking a new task', async () => {
  vi.useFakeTimers(); let settled = false;
  transport = input => {
    if (input === '/api/generate') return Response.json({ jobId: 'late-usage', remaining: 5 }, { status: 202 });
    if (input === '/api/jobs/late-usage') return Response.json({ status: 'cancelled', modelId: 'late-usage', usagePending: !settled });
    if (input === '/api/quota') return Response.json({ remaining: 6, pool: 6, lastTask: settled ? { ...reportedTask, outcome: 'failed', usageComplete: false } : null });
    return undefined;
  };
  await mount(); await fill('#system-description', 'A bookstore'); await click('Generate diagram');
  expect(container.textContent).toContain('Usage pending');
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).not.toBe(true);
  settled = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(container.textContent).not.toContain('Usage pending');
  expect(container.querySelector('.aw-task-usage')!.textContent).toContain('Usage incomplete');
});

describe('secret refusals', () => {
  it('shows why a description was refused and keeps it for editing', async () => {
    const message = 'Your description contains what looks like a GitHub token on line 2. Remove it and try again. Archwoven never sends detected secrets to the AI provider, and no credit was used.';
    transport = (input) => input === '/api/generate' ? Response.json({ reason: 'secret-detected', error: message }, { status: 400 }) : undefined;
    await mount();
    await fill('#system-description', 'An API gateway.\nToken: (pasted)');
    await click('Generate diagram');
    await act(async () => { await vi.waitFor(() => expect(container.textContent).toContain(message)); });
    expect(container.querySelector<HTMLTextAreaElement>('#system-description')!.value).toBe('An API gateway.\nToken: (pasted)');
  });
});

describe('deleting a diagram', () => {
  beforeEach(() => window.history.replaceState(null, '', '/workspace#model=m1'));
  function server(status = 200) {
    const deletes: string[] = [];
    transport = (input, init) => {
      if (input === '/api/models/m1' && init?.method === 'DELETE') { deletes.push(input); return status === 200 ? Response.json({ deleted: true }) : Response.json({ error: status === 404 ? 'model not found' : 'Storage unavailable' }, { status }); }
      if (input === '/api/models/m1' && !init) return Response.json({ model: validFullModelExtended });
      return undefined;
    };
    return deletes;
  }
  const button = () => [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Delete diagram');

  it('deletes after confirmation and leaves nothing to restore', async () => {
    const deletes = server();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await mount();
    sessionStorage.setItem('aw_modelId', 'm1');
    await act(async () => button()!.click());
    expect(confirm).toHaveBeenCalledWith('Delete this diagram and its history? This cannot be undone.');
    expect(deletes).toEqual(['/api/models/m1']);
    expect(container.querySelector('[aria-label="Rendered view"]')).toBeNull();
    expect(container.querySelector('[role="status"].aw-notice')?.textContent).toBe('Diagram deleted.');
    expect(sessionStorage.getItem('aw_modelId')).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('keeps the diagram when the confirmation is declined', async () => {
    const deletes = server();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await mount();
    await act(async () => button()!.click());
    expect(deletes).toEqual([]);
    expect(container.querySelector('[aria-label="Rendered view"]')).not.toBeNull();
  });

  it('keeps the diagram and explains when deletion fails', async () => {
    server(503);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await mount();
    await act(async () => button()!.click());
    expect(container.textContent).toContain('Storage unavailable');
    expect(container.querySelector('[aria-label="Rendered view"]')).not.toBeNull();
  });

  it('clears a diagram that had already expired', async () => {
    server(404);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await mount();
    await act(async () => button()!.click());
    expect(container.querySelector('[aria-label="Rendered view"]')).toBeNull();
    expect(container.querySelector('[role="status"].aw-notice')?.textContent).toBe('Diagram deleted.');
  });

  it('states how long diagrams are kept in each deployment', async () => {
    server();
    await mount();
    expect(container.querySelector('#retention-note')?.textContent).toBe('Kept for 30 days after the last change.');
    expect(button()!.getAttribute('aria-describedby')).toBe('retention-note');
    await act(async () => root.unmount());
    root = createRoot(container);
    transport = (input, init) => {
      if (input === '/api/config') return Response.json({ mode: 'local', llmReady: true });
      if (input === '/api/models/m1' && !init) return Response.json({ model: validFullModelExtended });
      return undefined;
    };
    await mount();
    expect(container.querySelector('#retention-note')?.textContent).toBe('Stored on this machine until you delete it.');
  });

  it('states the 24-hour server copy when hosted jobs keep diagrams in Redis', async () => {
    transport = (input, init) => {
      if (input === '/api/quota') return Response.json({ remaining: null, pool: null, fake: false });
      if (input === '/api/models/m1' && !init) return Response.json({ model: validFullModelExtended });
      return undefined;
    };
    await mount();
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(container.querySelector('#retention-note')?.textContent).toBe('The server keeps this diagram for 24 hours after its last change.');
  });
});

describe('quota refusals', () => {
  it.each([
    ['credits-exhausted', 'Daily free credits used up', "You've used today's free credits. They reset in 7h 23m. You can still view, rearrange, rename and export your diagrams."],
    ['network-credits-exhausted', 'Daily free credits for your network used up', "Today's free credits for your network are used up. They reset in 7h 23m. You can still view, rearrange, rename and export your diagrams."],
  ])('explains %s without offering a sign-in', async (reason, title, message) => {
    transport = (input) => input === '/api/generate' ? Response.json({ reason, message, resetAt: Date.now() + 3_600_000 }, { status: 429 }) : undefined;
    await mount();
    await fill('#system-description', 'An API gateway in front of an order service.');
    await click('Generate diagram');
    await act(async () => { await vi.waitFor(() => expect(container.textContent).toContain(title)); });
    expect(container.textContent).toContain(message);
    expect(container.textContent).not.toMatch(/sign in|GitHub for/i);
  });
});

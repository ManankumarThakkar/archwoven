// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validFullModelExtended } from '@archwoven/model';
import WorkspacePage from './page';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Layout is covered separately in Canvas tests and the real-browser pass.
vi.mock('./Canvas', () => ({ Canvas: () => null }));
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
  await act(async () => button.click());
}

describe('saved diagram restoration', () => {
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
});

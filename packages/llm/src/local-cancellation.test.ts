import { describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { generateModelLocal, generateRefinementLocal, assembleRepoModelLocal, ollamaChat } from './local';

const complete = (value: unknown) => new Response(JSON.stringify({ message: { content: JSON.stringify(value) }, done: true, prompt_eval_count: 10, eval_count: 5 }) + '\n');
const calls = [
  (fetchImpl: typeof fetch, signal: AbortSignal) => generateModelLocal('system', 'architecture', { fetchImpl, signal }),
  (fetchImpl: typeof fetch, signal: AbortSignal) => generateRefinementLocal('rename', validFullModel, 'architecture', { fetchImpl, signal }),
  (fetchImpl: typeof fetch, signal: AbortSignal) => assembleRepoModelLocal({ nodes: [], edges: [], endpoints: [], gaps: [] }, { owner: 'example', repo: 'api', sha: 'abc', framework: 'fastapi' }, { fetchImpl, signal }),
];

describe('native inference cancellation and budgets', () => {
  it('does not accept a completed response after cancellation and preserves its reported usage', async () => {
    const controller = new AbortController();
    const fetchImpl = (async () => { controller.abort(); return complete(validFullModel); }) as typeof fetch;
    const out = await generateModelLocal('system', 'architecture', { fetchImpl, signal: controller.signal });
    expect(out.ok).toBe(false);
    expect(out.usage.inputTokens).toBe(10);
    expect(out.usage.outputTokens).toBe(5);
  });
  it.each(calls)('an already-aborted task makes no provider request', async (run) => {
    const controller = new AbortController(); controller.abort();
    let requests = 0;
    const fetchImpl = (async () => { requests++; return complete(validFullModel); }) as typeof fetch;
    const out = await run(fetchImpl, controller.signal);
    expect(out.ok).toBe(false);
    expect(requests).toBe(0);
  });

  it('passes caller cancellation to the request and stops without repair attempts', async () => {
    const controller = new AbortController(); let requests = 0; let sawAbort = false;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      requests++;
      if (!init?.signal) return complete(validFullModel);
      return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => { sawAbort = true; reject(init.signal!.reason); }, { once: true }));
    }) as typeof fetch;
    const pending = generateModelLocal('system', 'architecture', { fetchImpl, signal: controller.signal });
    controller.abort();
    const out = await pending;
    expect(out.ok).toBe(false);
    expect(sawAbort).toBe(true);
    expect(requests).toBe(1);
    if (!out.ok) expect(out.errors.join(' ')).toMatch(/cancel/i);
  });

  it('handles abort while consuming the response stream', async () => {
    const controller = new AbortController(); let streaming = false;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      if (!init?.signal) return complete(validFullModel);
      return new Response(new ReadableStream({ start(stream) {
        streaming = true;
        stream.enqueue(new TextEncoder().encode('{"message":{"content":"{"}}\n'));
        init.signal!.addEventListener('abort', () => stream.error(init.signal!.reason), { once: true });
      } }));
    }) as typeof fetch;
    const pending = generateModelLocal('system', 'architecture', { fetchImpl, signal: controller.signal });
    await Promise.resolve(); controller.abort();
    const out = await pending;
    expect(streaming).toBe(true);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.join(' ')).toMatch(/cancel/i);
  });

  it('bounds the complete repair loop rather than resetting the deadline on every attempt', async () => {
    let requests = 0;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      requests++;
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(complete({ invalid: true })), 20);
        init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal!.reason); }, { once: true });
      });
    }) as typeof fetch;
    const out = await generateModelLocal('system', 'architecture', { fetchImpl, timeoutMs: 35 });
    expect(out.ok).toBe(false);
    expect(requests).toBeLessThanOrEqual(3);
    if (!out.ok) expect(out.errors.join(' ')).toMatch(/timed out/i);
    expect(out.usage.inputTokens).toBe(10);
    expect(out.usage.outputTokens).toBe(5);
  });

  it('returns a controlled failure and releases a broken reader', async () => {
    const fetchImpl = (async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('connection dropped')); } }))) as typeof fetch;
    await expect(ollamaChat([], {}, { fetchImpl })).resolves.toMatchObject({ error: expect.stringMatching(/connection dropped/) });
  });

  it('cancels a still-open stream when the provider emits an error chunk', async () => {
    let cancelled = false;
    const fetchImpl = (async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"error":"model failed"}\n')); },
      cancel() { cancelled = true; },
    }))) as typeof fetch;
    const out = await ollamaChat([], {}, { fetchImpl });
    expect(out.error).toBe('model failed');
    expect(cancelled).toBe(true);
  });
});

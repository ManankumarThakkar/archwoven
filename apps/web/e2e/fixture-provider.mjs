// LABELLED TEST FIXTURE, NOT A PROVIDER: answers Anthropic token counts locally and returns a
// recorded valid model for message requests (one fixed rename for refinements) after ARCHWOVEN_FIXTURE_DELAY_MS. Every other external
// request fails. Calls are counted in ARCHWOVEN_FIXTURE_LOG so tests can prove what was dispatched.
import { appendFileSync, readFileSync } from 'node:fs';
const model = readFileSync(process.env.ARCHWOVEN_FIXTURE_MODEL, 'utf8');
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input?.url ?? String(input));
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return realFetch(input, init);
  if (url.hostname === 'api.anthropic.com' && url.pathname.endsWith('/messages/count_tokens')) {
    return new Response(JSON.stringify({ input_tokens: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.hostname === 'api.anthropic.com' && url.pathname.endsWith('/messages')) {
    if (process.env.ARCHWOVEN_FIXTURE_LOG) appendFileSync(process.env.ARCHWOVEN_FIXTURE_LOG, `${Date.now()} message\n`);
    const signal = init?.signal;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, Number(process.env.ARCHWOVEN_FIXTURE_DELAY_MS ?? 0));
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
    });
    // Refinement requests name their base revision; answer with one rename at that revision.
    const revision = /Current model JSON \(revision (\d+)\)/.exec(typeof init?.body === 'string' ? init.body : '')?.[1];
    const text = revision ? JSON.stringify([{ op: 'update', target: 'gateway.api', patch: { label: 'Edge Gateway' }, baseRevision: Number(revision), summary: 'Rename the API gateway to Edge Gateway' }]) : model;
    return new Response(JSON.stringify({ id: 'msg_fixture', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 60, output_tokens: 1500, cache_creation_input_tokens: 0, cache_read_input_tokens: 3540 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new TypeError(`fixture: blocked request to ${url.hostname}`);
};

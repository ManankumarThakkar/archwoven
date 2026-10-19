// LABELLED TEST FIXTURE, NOT A PROVIDER: answers Anthropic token counts locally and returns a
// recorded valid model for message requests (one fixed rename for refinements, two covering
// internals for expansions) after ARCHWOVEN_FIXTURE_DELAY_MS. With ARCHWOVEN_FIXTURE_REPO_TAR it also
// serves one public repository, github.com/fixture/shop, from that local tarball. With
// ARCHWOVEN_FIXTURE_REDIS (a loopback Redis REST address) it forwards https://fixture-redis.upstash.io
// there, so a server started with VERCEL=1 can use a disposable local Redis. Every other external
// request fails. Calls are counted in ARCHWOVEN_FIXTURE_LOG so tests can prove what was dispatched.
import { appendFileSync, readFileSync } from 'node:fs';
const model = readFileSync(process.env.ARCHWOVEN_FIXTURE_MODEL, 'utf8');
const realFetch = globalThis.fetch;
/** Expansion requests describe the focus and its links; answer with two internals that cover every link. */
function expansion(body) {
  let content = '';
  try { const request = JSON.parse(body); content = request.messages.map(m => typeof m.content === 'string' ? m.content : m.content.map(c => c.text ?? '').join('')).join('\n'); } catch { return null; }
  const focus = /"focus":\{"id":"([^"]+)"/.exec(content)?.[1];
  const links = /"links":(\[[^\]]*\])/.exec(content)?.[1];
  if (!focus || !links) return null;
  const out = [{ from: 'request-handler', to: 'core-logic', type: 'sync' }];
  for (const link of JSON.parse(links)) {
    if (link.from === focus && link.to === focus) continue;
    if (link.from === focus) out.push({ from: 'core-logic', to: link.to, type: link.type });
    else if (link.to === focus) out.push({ from: link.from, to: 'request-handler', type: link.type });
  }
  const unique = [...new Map(out.map(l => [`${l.from}|${l.to}|${l.type}`, l])).values()];
  return JSON.stringify({ internals: [{ key: 'request-handler', label: 'Request Handler' }, { key: 'core-logic', label: 'Core Logic' }], links: unique });
}
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input?.url ?? String(input));
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return realFetch(input, init);
  const redis = process.env.ARCHWOVEN_FIXTURE_REDIS;
  if (redis && /^http:\/\/127\.0\.0\.1:\d+$/.test(redis) && url.origin === 'https://fixture-redis.upstash.io') {
    return realFetch(redis + url.pathname + url.search, init);
  }
  const repoTar = process.env.ARCHWOVEN_FIXTURE_REPO_TAR, sha = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c';
  if (repoTar && url.hostname === 'api.github.com') {
    const body = url.pathname === '/repos/fixture/shop' ? { default_branch: 'main' }
      : url.pathname === '/repos/fixture/shop/commits/main' ? { sha } : null;
    return new Response(JSON.stringify(body ?? { message: 'Not Found' }), { status: body ? 200 : 404, headers: { 'content-type': 'application/json' } });
  }
  if (repoTar && url.hostname === 'codeload.github.com' && url.pathname === `/fixture/shop/tar.gz/${sha}`) {
    return new Response(readFileSync(repoTar), { status: 200, headers: { 'content-type': 'application/x-gzip' } });
  }
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
    const text = revision ? JSON.stringify([{ op: 'update', target: 'gateway.api', patch: { label: 'Edge Gateway' }, baseRevision: Number(revision), summary: 'Rename the API gateway to Edge Gateway' }])
      : expansion(init?.body) ?? model;
    return new Response(JSON.stringify({ id: 'msg_fixture', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 60, output_tokens: 1500, cache_creation_input_tokens: 0, cache_read_input_tokens: 3540 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new TypeError(`fixture: blocked request to ${url.hostname}`);
};

/**
 * Diagnostic preload for an evaluation server: appends one JSON line per hosted provider
 * request that carries repair feedback, with the rejected response and the feedback sent.
 * It never changes requests. Start the server with:
 *
 *   NODE_OPTIONS="--import $PWD/benchmarks/provider-eval/capture-repairs.mjs" \
 *   ARCHWOVEN_REPAIR_LOG=/path/to/repairs.jsonl pnpm --filter web start ...
 *
 * The log holds model output, so keep it out of version control like other run artifacts.
 */
import { appendFileSync } from 'node:fs';
const file = process.env.ARCHWOVEN_REPAIR_LOG;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  try {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    if (file && url.includes('anthropic.com') && typeof init?.body === 'string') {
      const body = JSON.parse(init.body);
      if (Array.isArray(body.messages) && body.messages.length > 1) {
        const text = (m) => (typeof m?.content === 'string' ? m.content : (m?.content ?? []).map((c) => c.text ?? '').join(''));
        appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), rejected: text(body.messages.at(-2)), feedback: text(body.messages.at(-1)) }) + '\n');
      }
    }
  } catch { /* never interfere with the request */ }
  return realFetch(input, init);
};

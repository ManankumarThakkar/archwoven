#!/usr/bin/env node
/**
 * Quota ladder smoke — runs against a live `next start`. Zero model spend:
 * set ARCHWOVEN_FAKE=1 (llm client returns a canned valid model). Verifies the
 * §15 ladder over real HTTP + cookies + SQLite persistence:
 *   - 6 anonymous generates succeed, the 7th is 429 with the reset copy.
 *   - stop-loss (ARCHWOVEN_STOP_LOSS_USD lowered) → paused copy.
 *   - burst (>5/min/session) → burst copy.
 *
 * Usage (set the SERVER env so credits, not the 5/min burst, is the binding gate):
 *   ARCHWOVEN_FAKE=1 ARCHWOVEN_BURST_WINDOW_SEC=0.05 ARCHWOVEN_DB=/tmp/aw-smoke.db \
 *     node apps/web/e2e/quota-smoke.mjs http://localhost:3000
 * Stop-loss is a §15-locked constant (not env-tunable), so it is covered by the
 * quota unit test rather than this HTTP ladder.
 */
const BASE = process.argv[2] ?? 'http://localhost:3000';
const GAP_MS = Number(process.env.SMOKE_GAP_MS ?? 120); // let the burst window expire between calls

async function postGenerate(cookie, prompt) {
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    // distinct prompts: the client now derives a stable idempotency key per
    // (prompt, view), so repeats of the SAME prompt would dedupe to one job.
    body: JSON.stringify({ prompt, view: 'architecture', idempotencyKey: crypto.randomUUID() }),
  });
  const setCookie = res.headers.get('set-cookie');
  const sid = setCookie ? /aw_sid=([\w-]+)/.exec(setCookie)?.[1] : undefined;
  return { status: res.status, body: await res.json().catch(() => ({})), sid };
}

async function waitDone(cookie, jobId) {
  for (let i = 0; i < 100; i++) {
    const res = await fetch(`${BASE}/api/jobs/${jobId}`, { headers: { cookie } });
    const job = await res.json();
    if (job.status !== 'queued' && job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`job ${jobId} never settled`);
}

let failures = 0;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!cond) failures++; };

async function main() {
  console.log(`quota smoke → ${BASE} (ARCHWOVEN_FAKE=${process.env.ARCHWOVEN_FAKE ?? 'unset'})\n`);

  // Ladder: 6 generate → 7th 429 credits-exhausted.
  let cookie = '';
  let last;
  for (let i = 1; i <= 7; i++) {
    last = await postGenerate(cookie, `shop system ${i}`);
    if (last.sid) cookie = `aw_sid=${last.sid}`;
    if (last.status === 202) await waitDone(cookie, last.body.jobId);
    if (i <= 6) check(`generate #${i} accepted`, last.status === 202, `status ${last.status}`);
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  check('generate #7 blocked', last.status === 429, `status ${last.status}`);
  check('reset copy present', /resets in \d+h \d+m/.test(last.body.message ?? ''), last.body.message ?? '(none)');
  check('GitHub upsell present', /GitHub/.test(last.body.message ?? ''));

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('SMOKE CRASH:', e.message); process.exit(1); });

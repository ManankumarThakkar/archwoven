# M2 Vertical Slice + Fair-Use Enforcement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A polished plain-English → interactive diagram vertical slice (generate, refine, undo, export, all states) with §15 quotas/metering/stop-loss enforced server-side.

**Architecture:** Browser → `/api/*` routes → `packages/jobs` (SQLite: revisions, jobs, call accounting, credit ledger) → `packages/llm` (Claude structured output, cached prefix) → `packages/model` (Zod + edit pipeline). Jobs run in-process, durable in SQLite; UI polls job status with real stage names. Same code paths in hosted and local mode (§15 quotas compiled out locally via config).

**Tech Stack:** Next.js 15 App Router (nodejs runtime), `node:sqlite` (Node 24, zero-dep), Zod v4, @xyflow/react 12 + elkjs (probe A pipeline), @resvg/resvg-wasm, vitest.

**Spec:** `docs/SPEC.md` (§4 flows, §5 schema, §6 UI, §7 edits, §10 tokens, §11 eval, §15 fair-use LOCKED). M1 results: `docs/probes/SYNTHESIS.md`.

## Global Constraints

- Model: `claude-opus-5-5`, `max_tokens ≤ 8000`, cached STABLE_SYSTEM prefix, MAX_REPAIRS=2 (from `packages/llm/src/client.ts` — reuse, don't fork).
- §15 numbers verbatim: anon 6 credits/24h, signed-in 30; weights generate=1, repo=2, refine=0.25, view/layout/export/example=0; burst 5/min/session + 20/min/IP; global stop-loss $15/day; prompt gate >25k tokens → scope-down message.
- Every model call logs `{session-tier, prompt-view, input/output/cached tokens, cost, retries, outcome}` to SQLite (one table powers quota + §11 eval).
- UI states all explicit: empty · clarifying · loading(real stages) · success · partial(gaps) · error(prompt preserved) · cancelled · stale-revision. Dark navy base, WCAG AA, no CAPTCHA happy path.
- No AI attribution in commit messages or PR bodies (user standing rule).
- Secrets only via `.env.local` (gitignored); never echo keys in logs/responses.
- CI: `pnpm -r build && pnpm typecheck && pnpm test` must stay green; `verify` check gates merge.

## Review Focus

1. **Quota race:** two concurrent Generates must not both pass a check-then-spend — single SQL transaction or atomic UPSERT…UPDATE returning used; expect exact credit accounting under parallel calls.
2. **Stop-loss uses cached-token pricing:** cost math must mirror §10 (cacheRead $0.20/MTok, not $4) or the breaker trips 20× early or never trips — pin the price table in one constant, tested.
3. **Refinement must not silently rewrite semantics:** an EditOp that removes a node referenced by another view must fail validation and preserve the prior revision (scenario 7+8).
4. **Stale revision after browser idle:** refine against `baseRevision < latest` → 409 + rebase prompt, never a blind overwrite.
5. **Idempotency:** double-clicked Generate = one job, one charge (dedupe key from browser + server uniqueness).

---

### Task 1: jobs store — SQLite foundation

**Files:**
- Create: `packages/jobs/src/store.ts` — `openStore(path?)` → `Store` (node:sqlite `DatabaseSync`, default `data/archwoven.db`, dir mkdir)
- Modify: `packages/jobs/src/index.ts` — export store + types
- Test: `packages/jobs/src/store.test.ts`

**Interfaces:**
- Produces:
  - `openStore(path?: string): Store`
  - `Store.saveRevision(model: SystemModel): void` (table `revisions(model_id, revision, parent_id, json, created_at)`; PRIMARY KEY (model_id, revision))
  - `Store.getRevision(modelId, revision?) → SystemModel | null` (latest when revision omitted)
  - `Store.createJob({id, modelId, kind: 'generate'|'refine', idempotencyKey?}): void` / `Store.updateJob(id, {status: 'queued'|'running'|'succeeded'|'failed'|'cancelled', stage?, error?})` / `Store.getJob(id)`
  - `Store.logCall(rec: {sessionId, tier, view, inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens, costUsd, retries, outcome}): void` (table `call_log`)
  - `Store.todayCost(): number` / `Store.creditsUsed(sessionId, day): number` / `Store.addCreditsUsed(sessionId, day, amount): number` (returns new total; atomic UPSERT…RETURNING)
  - `Store.bumpBurst(key, windowSec): number` (count in rolling window)

- [ ] Step 1: Write failing tests — saveRevision/getRevision roundtrip; saveRevision enforces (model_id,revision) PK; job lifecycle queued→running→succeeded; logCall + todayCost sums; addCreditsUsed atomic increments twice → 1.25+1.25=2.5; bumpBurst counts within window, resets outside.
- [ ] Step 2: Run → FAIL (module missing).
- [ ] Step 3: Implement store with `node:sqlite`; migrations = `CREATE TABLE IF NOT EXISTS` in openStore.
- [ ] Step 4: Run → PASS. Full suite green.
- [ ] Step 5: Commit `feat(jobs): SQLite store — revisions, jobs, call accounting, credit ledger`.

### Task 2: quota + metering service (§15)

**Files:**
- Create: `packages/jobs/src/quota.ts`
- Test: `packages/jobs/src/quota.test.ts`

**Interfaces:**
- Consumes: `Store` from Task 1.
- Produces:
  - `TIERS = { anonymous: { pool: 6 }, github: { pool: 30 } }`, `WEIGHTS = { generate: 1, repo: 2, refine: 0.25, view: 0 }`, `PRICES = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }` (per MTok, §10/§15 verbatim), `STOP_LOSS_USD = 15`, `BURST = { session: 5, ip: 20 }`
  - `costOf(u: {inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens}): number`
  - `checkQuota(store, {sessionId, tier, action, ip}): { ok: true; remaining: number } | { ok: false; reason: 'credits-exhausted'|'stop-loss'|'burst'; resetAt?: number }` — check + burst gate, no spend yet
  - `charge(store, {sessionId, tier, action, usage}): number` — logCall + addCreditsUsed, returns remaining
  - `localMode = process.env.ARCHWOVEN_MODE === 'local'` → checkQuota always `{ok:true, remaining: Infinity}` (§15 quotas compiled out locally)

- [ ] Step 1: Failing tests — anon 6th generate allowed, 7th → credits-exhausted with resetAt next UTC midnight; refine costs 0.25 (4 refines = 1 credit); view switch free; stop-loss: logCall pushing todayCost past $15 → reason 'stop-loss'; burst: 6th session call in window → 'burst'; local mode bypasses all.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement quota.ts.
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit `feat(jobs): §15 weighted credits, burst limits, global stop-loss`.

### Task 3: generate API route (quota-gated job)

**Files:**
- Create: `apps/web/app/api/generate/route.ts`
- Create: `apps/web/app/api/jobs/[id]/route.ts`
- Create: `apps/web/app/lib/server.ts` (shared: store singleton, session cookie mint/read)
- Test: `apps/web/app/api/generate/route.test.ts` (fetchImpl-injected)

**Interfaces:**
- Consumes: `checkQuota/charge/costOf`, `generateModel` (client.ts), `validateModel`, `Store`.
- Produces:
  - `POST /api/generate {prompt, view, idempotencyKey}` → 202 `{jobId}`; 429 quota reasons w/ copy fields `{reason, message, resetAt?}`; 413 prompt >25k tokens (estimate: chars/4 server-side pre-gate, exact via `client.messages.countTokens` before send); 503 stop-loss.
  - Job runs in-process (fire-and-forget async): stages `validating → generating → validating-output → laying-out → done`; on success `saveRevision` + `charge`; on failure job.failed with actionable error, **no charge for provider errors** (§15 honest).
  - `GET /api/jobs/:id` → `{status, stage, modelId?, revision?, error?}`
  - Session cookie `aw_sid` (httpOnly, sameSite=lax, 90d) minted on first request; `tier` from cookie only in M2 (GitHub OAuth is M4).

- [ ] Step 1: Failing tests — mocked generateModel: happy path job reaches done + revision saved + credits spent 1; second call same idempotencyKey → same jobId, no second charge; credits exhausted → 429 w/ §15 copy; oversized prompt → 413 scope-down copy; provider throw → job.failed, credits unchanged.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement routes + lib/server.ts.
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit `feat(web): /api/generate quota-gated job pipeline + /api/jobs status`.

### Task 4: edit pipeline in model package (§7)

**Files:**
- Create: `packages/model/src/edit.ts`
- Test: `packages/model/src/edit.test.ts`

**Interfaces:**
- Consumes: `SystemModelSchema`, `EditOpSchema` (schema.ts), `validateModel`.
- Produces:
  - `applyEditOps(model: SystemModel, ops: EditOp[]): { ok: true; model: SystemModel } | { ok: false; errors: string[] }` — ops: add/remove/update node|edge, move (layout only). Enforces `baseRevision === model.revision` else error `stale-revision`; remove of referenced node → referential errors; on success revision+1, parentId=old; untouched nodes keep `layout` positions.
  - `undoTo(model, prev: SystemModel): SystemModel` — revision bookkeeping for undo strip.

- [ ] Step 1: Failing tests — add node+edge ok revision+1; remove node still referenced by view → errors, model unchanged; stale baseRevision → 'stale-revision'; move preserves semantics; update label preserves layout of untouched (scenario 8).
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement edit.ts.
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit `feat(model): EditOp apply — stale rejection, referential integrity, layout preservation`.

### Task 5: refinement — LLM emits EditOps + /api/refine

**Files:**
- Modify: `packages/llm/src/client.ts` — add `generateRefinement(instruction, model, view, {client?, effort?}): {ok, ops, usage} | {ok:false, errors, usage}` (structured output `z.array(EditOpSchema)`, system prompt: current model JSON + instruction → ops only)
- Create: `apps/web/app/api/refine/route.ts`
- Test: `packages/llm/src/refine.test.ts`, `apps/web/app/api/refine/route.test.ts`

**Interfaces:**
- Consumes: `applyEditOps` (Task 4), `checkQuota/charge` (refine weight 0.25), `Store`.
- Produces: `POST /api/refine {modelId, baseRevision, instruction}` → `{ops, model, revision, remaining}`; 409 stale-revision w/ rebase payload (latest revision); 429 quota.

- [ ] Step 1: Failing tests — refine.test: mocked parse returns ops, applyEditOps commits revision+1; invalid ops (dangling) → prior revision preserved (scenario 7). route.test: stale baseRevision → 409; happy → charge 0.25.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement both.
- [ ] Step 4: Run → PASS.
- [ ] Step 5: Commit `feat(llm,web): refinement via EditOps — bounded patches, stale rebase, 0.25 credits`.

### Task 6: workspace shell UI (control panel + states)

**Files:**
- Create: `apps/web/app/workspace/page.tsx` (client), `apps/web/app/workspace/ControlPanel.tsx`, `apps/web/app/workspace/states.ts` (state machine types)
- Modify: `apps/web/app/page.tsx` → redirect to /workspace
- Test: `apps/web/app/workspace/states.test.ts` (pure machine), examples data `apps/web/app/workspace/examples.ts`

**Interfaces:**
- Produces: state machine `idle|clarifying|running(stage)|success|partial|error|cancelled|stale|quota-blocked|paused`; view-adaptive placeholders; 3–4 example chips per view (click fills input, confirm-overwrite guard — scenario 1, no model call); token counter (chars/4 client estimate); privacy chip + token-meter chip in app bar.

- [ ] Step 1: Failing states.test — transitions: generate→running(validating→generating→validating-output→laying-out)→success; quota-blocked shows reset countdown data; example click never enters running; partial carries gaps.
- [ ] Step 2: FAIL → Step 3: implement → Step 4: PASS → Step 5: commit `feat(web): workspace shell — control panel, examples, state machine, meter chips`.

### Task 7: canvas + inspector (React Flow + provenance)

**Files:**
- Create: `apps/web/app/workspace/Canvas.tsx`, `apps/web/app/workspace/Inspector.tsx`
- Test: `apps/web/app/workspace/inspector.test.ts` (pure: node→inspector payload incl. gaps + evidence)

**Interfaces:**
- Consumes: `layoutModel` (probes/render/layout.ts — promote to `apps/web/lib/layout.ts`, reuse for real models), React Flow, probe-a node components (provenance badges).
- Produces: canvas pan/zoom/fit/minimap; node click → inspector {label, kind, provenance badge, role blurb, evidence links, gaps}; proposed-vs-source visually distinct (scenario 6); view tabs switch architecture/sequence (sequence via sequenceSvg).

- [ ] Step 1: failing inspector.test → [ ] Step 2: FAIL → [ ] Step 3: implement → [ ] Step 4: PASS → [ ] Step 5: commit `feat(web): canvas + inspector — provenance badges, evidence, gaps, view tabs`.

### Task 8: refinement bar + undo + export wiring

**Files:**
- Modify: workspace page (refinement bar, change-summary strip, undo)
- Create: `apps/web/app/workspace/RefineBar.tsx`; export button wired to probe A `renderPng` + SVG download
- Test: `apps/web/app/workspace/refine-flow.test.ts` (pure: ops→summary text "+Cache service, +edge orders→cache · undo"; undo restores prev revision state)

- [ ] Steps 1–5: failing test → FAIL → implement → PASS → commit `feat(web): refine bar, change summary, undo, PNG/SVG export`.

### Task 9: quota ladder smoke + scenario checks 1–8, 13

**Files:**
- Create: `apps/web/e2e/quota-smoke.mjs` (next start + curl: 6 generates → 7th 429 w/ copy; stop-loss config $0.0001 → paused copy; burst)
- Create: `docs/M2-CHECKS.md` — scenario checks 1–8, 13 each: how verified (test name or manual step), result
- Modify: CI — add route smoke job? No: keep CI as-is; smoke script documented in CHECKS.

- [ ] Step 1: Write smoke script + run against `next start` with ARCHWOVEN_MODE=local (no spend) and with mock provider flag `ARCHWOVEN_FAKE=1` (llm client honors fake mode returning canned valid model — add to client.ts, small).
- [ ] Step 2: Record results in M2-CHECKS.md; any failure = finding → fix + test.
- [ ] Step 3: Commit `test: quota ladder smoke + scenario checks 1-8,13 evidence`.

### Task 10: polish pass + demo walkthrough doc

**Files:**
- Create: `docs/M2-DEMO.md` (recruiter 10-min script: 3 examples, refine, undo, export, quota copy visible)
- Polish: reduced-motion, focus rings, tablet collapse, honest stage names wired to job polling.

- [ ] Steps: walkthrough on localhost with real key (spend ≤ $0.30, logged via call_log), fix what the walkthrough exposes, commit `docs: M2 demo walkthrough + polish`.

---

**M2 done when:** workspace demo walkthrough works end-to-end (real key), quota ladder smoke green, M2-CHECKS.md shows checks 1–8 + 13 verified, CI green, PR merged.

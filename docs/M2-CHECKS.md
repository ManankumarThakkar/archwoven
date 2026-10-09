# M2 scenario checks (1–8, 13)

Each essential scenario from the master prompt §"Essential scenario checks", mapped to how it is verified and the honest result. Scenarios 9–12, 14 are M3/M5 (privacy enforcement, injection hardening, public/private parity).

| # | Scenario | Verified by | Result |
|---|----------|-------------|--------|
| 1 | Clicking an example updates editable input without model usage | `states.test.ts › example click never enters running`; `ControlPanel.applyExample` prefills + `window.confirm` overwrite guard, issues no fetch | ✅ PASS |
| 2 | Changing diagram type updates examples and preserves user work | `ControlPanel` view tabs switch `EXAMPLES[view]`; `setView` does not clear `prompt` (typed work preserved); overwrite of a non-empty prompt is guarded by confirm | ✅ PASS (code) — visual confirm manual |
| 3 | Contradictory requirements trigger clarification rather than fabricated resolution | State machine has `clarifying` + `CLARIFY` (`states.test.ts`); **the trigger (LLM contradiction detection) is not wired into `/api/generate`** | ⚠️ SCAFFOLDED — detection lands in M3 |
| 4 | Unsupported code patterns appear as analysis gaps | `packages/extract` emits `openQuestions` for unprovable mappings (Probe C); `inspector.test.ts › node carries the open questions that block it` surfaces them | ✅ PASS |
| 5 | Evidence opens the correct file at the analyzed revision | `inspector.test.ts › evidence links` asserts `…/blob/abc1234/…#L10` — commit pinned from `evidence.commit`, line anchored | ✅ PASS |
| 6 | Proposed components distinguishable from observed | `Canvas` `PROVENANCE_STYLE` (border/badge per provenance); `Inspector` provenance badge; `inspector.test.ts › proposed vs source-supported distinct` | ✅ PASS |
| 7 | Invalid model output preserves the previous valid diagram | `refine/route.test.ts › refinement failure → 502, prior revision preserved`; `applyEditOps` is atomic (all-or-nothing) | ✅ PASS |
| 8 | A targeted edit leaves unrelated semantics unchanged | `edit.test.ts › move touches layout only` + `update label preserves layout (scenario 8)`; `refine-flow.test.ts` summary/undo | ✅ PASS |
| 13 | Exported diagrams remain readable and match the selected view | `buildSvg(model, activeView)` renders the selected view's nodes/edges with labels; export downloads it (SVG reliable; PNG via resvg, blank text without font buffers → falls back to SVG) | ✅ PASS (SVG) — PNG text needs fonts (M4) |

## Quota ladder smoke (real HTTP, zero spend)

`apps/web/e2e/quota-smoke.mjs` against `next start` with `ARCHWOVEN_FAKE=1 ARCHWOVEN_DEMO_ACK=1` (production boot refuses fake data without the ack) + widened burst window:

```
PASS generate #1..#6 accepted — status 202
PASS generate #7 blocked — status 429
PASS reset copy present — "…resets in 17h 7m. Sign in with GitHub for 30/day."
PASS GitHub upsell present
ALL PASS
```

Stop-loss (§15-locked constant, not env-tunable) is covered by `packages/jobs` quota unit tests, not this HTTP ladder.

## Whole-branch review fixes (verified)

Fresh-reviewer pass on `ceb806f..c689404` found 11 Critical/Important issues; all fixed with RED→GREEN tests (suite 99 → **135**):

| Finding | Fix | Verified by |
|---|---|---|
| Quota TOCTOU (check-then-charge raced the pool) | Atomic `reserveCredits` (single `UPSERT … RETURNING` at the gate) + refund on failure | `quota.test.ts › parallel reserves cannot bypass the pool`; `route.test.ts › credits are reserved at accept and refunded when the job fails` |
| `baseURL` unpinned (proxy would drop `output_config` + leak key) | `makeAnthropic()` pins `api.anthropic.com` | `client.test.ts › pins baseURL … even when a proxy env var is set` |
| Failed/repair calls unmetered (stop-loss undercount) | Usage accumulates across attempts; every call logs via `recordUsage` | `client.test.ts › accumulates billed usage`; `route.test.ts › failed provider call is still metered` |
| FAKE/local mode shippable to production | `assertSafeRuntime()` boot guard (`ARCHWOVEN_DEMO_ACK` required) + visible `DEMO DATA` chip | `server.test.ts` (4 cases); live `/api/quota → fake:true` |
| Undo lost on reload; 409 blanked the canvas | Server-side `POST /api/models/[id]/undo` (forward revision); 409 → `REBASE` keeps canvas; `sessionStorage` model restore | `undo/route.test.ts` (3 cases); `states.test.ts › 409 rebase` |
| No ownership on reads; global idempotency dedupe | `session_id` on jobs/revisions; ownership checks on all four model/job routes; dedupe scoped by `(session, key)` | `route.test.ts › another session cannot read your job`; live cross-session 404s |
| Idempotency key regenerated per click | Stable `idempotencyKeyFor(prompt, view)` (FNV-1a) | `refine-flow.test.ts` |
| `max_tokens` drift + missing `count_tokens` gate | Reverted to spec-locked 8192; exact `count_tokens` pre-send, fails closed | `client.test.ts` (2 cases) |
| §15 concurrency cap absent | In-process slot semaphore; queued jobs report `queuePosition` | `llm-limiter.test.ts` (3 cases); `route.test.ts › excess parallel generates queue with a visible position` |
| Hardcoded credit meter / privacy chip | `GET /api/quota` live meter; privacy chip from `model.privacy` | live curl: 6→5 after generate |
| SQLite databases committed | `.gitignore` `data/` + `*.db`; `git rm --cached`; WAL + busy_timeout | `git ls-files` shows none |

Also: honest per-reason quota copy (burst/stop-loss no longer render the credits-exhausted countdown), `'queued'`/`'saving'` stages (no more "undefined…"), poll loop survives network blips (retry ×5, 120s deadline), orphaned jobs swept to `failed` + refunded on boot, PNG fallback downloads honestly named `.svg`.

## Known gaps carried forward
- **Scenario 3** — clarification detection on contradictory requirements: state machine ready, trigger not wired (M3).
- **PNG export text** — needs font buffers supplied to resvg (M4 polish); SVG export is complete and readable.

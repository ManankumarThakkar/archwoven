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

`apps/web/e2e/quota-smoke.mjs` against `next start` with `ARCHWOVEN_FAKE=1` + widened burst window:

```
PASS generate #1..#6 accepted — status 202
PASS generate #7 blocked — status 429
PASS reset copy present — "…resets in 18h 38m. Sign in with GitHub for 30/day."
PASS GitHub upsell present
ALL PASS
```

Stop-loss (§15-locked constant, not env-tunable) is covered by `packages/jobs` quota unit tests, not this HTTP ladder.

## Known gaps carried forward
- **Scenario 3** — clarification detection on contradictory requirements: state machine ready, trigger not wired (M3).
- **PNG export text** — needs font buffers supplied to resvg (M4 polish); SVG export is complete and readable.

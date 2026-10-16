# M6 — release hardening plan (viewer UX + Suite B + polish)

Branch: `feat/m6-release-hardening` from main (post-M5 merge `e9b5e54`).
Execution: parallel subagents on disjoint dirs; integrator (main session) verifies + commits.
Scope decision (user 2026-10-15): OAuth excluded until a GitHub App is registered — local mode covers private repos.

## Task A — viewer UX completion (apps/web/app/workspace/** only)

Five deferred archify-viewer features (§6, archify-brief §2), ported as React/@xyflow state:

1. **Node finder** — `/` shortcut opens a search palette; filters current-view nodes by label/id; Enter → focus (reuse `#focus=`).
2. **Semantic lens** — kind filter (≤2 kinds active), `#lens=` permalink; dims non-matching nodes.
3. **Relationship passport** — edge selection panel: from → to, label, kind, provenance, evidence count; `#relation=` permalink.
4. **Outline rail** — ordered node list for the active view; click focuses; keyboard navigable.
5. **Flow-token pulses** — CSS pulses along edges ordered by kind priority security > event > data > state > call; fully off in Still / reduced-motion (motion.ts governor owns this — never bypass).

Rules: pure logic in `.ts` helpers with vitest tests (follow `graph-inspect.test.ts` patterns); Canvas/CSS wiring thin; existing permalinks (`#focus=`, `#route=`, `#chapter=`) must keep working; no new deps.

## Task B — Suite B repair-rounds harness (benchmarks/repair-rounds/** only)

Mirror Suite A's skeleton (`benchmarks/ordinary-model-floor/`): README, manifest.json, cases/, harness.mjs `check|verify|report` exit 0/1/2.

- 8 deterministic mutations of the `validFullModel` fixture, each with expected diagnostic code(s) from `validateModel` + oracle JSON-pointer repairs.
- Metrics: rounds-to-pass, first-disclosure rate, first-detection stage, actionability (repairer sees only {subject, evidence, supportedFixes}).
- Receipts pin repositoryCommit + packageSha256 like Suite A. `harness.selftest.mjs` with exit-code assertions.
- No writes outside `benchmarks/repair-rounds/` (integrator wires CI + docs).

## Task C — integration + polish (integrator)

- ci.yml: add Suite B selftest to verify job; README demo/walkthrough section; docs/M6-CHECKS.md + M6-MATRIX.md; TRACEABILITY R28+; live browser check of the five viewer features (dev server + fixture data); full verification both modes; PR.

## Verification gates

- `pnpm -r build && pnpm typecheck && pnpm test && pnpm test (local) && pnpm bench:selftest && suite-B selftest` all green.
- Live: open workspace, exercise `/`, lens, passport, outline, pulses (Still stops them) — transcript M6-CHECKS.

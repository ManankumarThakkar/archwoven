# Archwoven benchmarks

Published eval evidence (SPEC §11), format adapted from the archify benchmark
harness (MIT) to Archwoven's typed SystemModel. No archify code is vendored here —
the case/gate/receipt format is the borrowed idea.

## ordinary-model-floor

What a *boring* model must get right before any visual polish counts.

**Gates per case** (all three required for `evidenceEligible`):
1. `semantic` — `harness.mjs check`: every required node bound (label aliases
   accepted, type binding mandatory) and every required relationship present.
2. `validate` — `harness.mjs verify`: `validateModel` (Zod shape + referential
   integrity + semanticChecks enforcement).
3. `visual-review` — `harness.mjs record-visual`: a named human reviews the
   rendered diagram in the browser. **`skipped` ≠ pass** — it keeps the matrix
   incomplete (exit 2), it never fakes eligibility.

**Commands** (exit codes: 0 pass · 1 failure · 2 incomplete):

```bash
node benchmarks/ordinary-model-floor/harness.mjs check cases/todo-api.case.json model.json
node benchmarks/ordinary-model-floor/harness.mjs verify model.json todo-api
node benchmarks/ordinary-model-floor/harness.mjs record-visual todo-api pass "reviewer-name"
node benchmarks/ordinary-model-floor/harness.mjs record-failure todo-api node-overlap
node benchmarks/ordinary-model-floor/harness.mjs report
```

Receipts land in `results/<UTC-date>-<runner>.jsonl`; failures pin
`repositoryCommit` + `packageSha256` so every defect is reproducible against an
exact build. Defect tags: clipping, node-overlap, label-overlap, hidden-route,
stacked-edge, weak-hierarchy, unbalanced-whitespace, theme-contrast.

**Current status:** both harnesses and their selftests are implemented. The post-merge real-provider Suite A run produced three schema-valid models; its strict semantic matcher passed 1/3 because two label aliases were rejected, and all named-human visual reviews remain missing. Suite A is ineligible; an API key is no longer the blocker. Suite B has a clean receipt pinned to merged commit `d6f28bcd`, with all eight deterministic cases passing. See [post-merge audit](../docs/POST-MERGE-AUDIT.md) for exact limits and remaining work.

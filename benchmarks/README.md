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

## provider-eval

Representative real-provider results: first-pass validity, repair success, latency, cost and cache savings across every diagram type, refinements and repository imports, with diagram-level accuracy against ground truth. See [provider-eval/README.md](provider-eval/README.md).

**Current status:** all three harnesses and their selftests are implemented.
- **Suite A:** the oracle matches whole names after normalising case, punctuation, plurals and parentheticals, and one node may satisfy only one requirement. The two 2026-10-16 rejections were false negatives: the original receipt is kept, and a re-check of the same models passes. A fresh real-provider run (2026-10-17) passed the semantic and validation gates 3/3. Suite A stays ineligible until a named person records the visual reviews ([ordinary-model-floor/review/](ordinary-model-floor/review/README.md)).
- **Suite B:** a clean receipt is pinned to merged commit `d6f28bcd`, with all eight deterministic cases passing.
- **Provider evaluation (2026-10-17):** 30/30 cases succeeded, but no hosted description or import was valid on the first attempt. After the task 19b prompt and parsing fixes, the same 7 descriptions were valid on the first attempt 7/7, with the median down from 33.8 s to 14.2 s and cost down 64 %. See its README.

See [post-merge audit](../docs/POST-MERGE-AUDIT.md) for exact limits and remaining work.

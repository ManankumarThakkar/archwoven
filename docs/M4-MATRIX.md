# M4 benchmark floor matrix — ordinary-model-floor

Format adapted from the archify benchmark harness (MIT); no archify code vendored.
Gates: **semantic** (required nodes bound by alias + mandatory type, required
relationships present) · **validate** (`validateModel`: Zod + referential +
semanticChecks) · **visual-review** (named human in browser; `skipped` ≠ pass).

| case | semantic | validate | visual-review | evidenceEligible |
|---|---|---|---|---|
| todo-api | harness-live (selftest green) | harness-live | pending-key live run | **no** |
| checkout | harness-live | harness-live | pending-key live run | no |
| boring-crud | harness-live | harness-live | pending-key live run | no |

`harness.mjs report` on the current matrix → **exit 2** (incomplete), captured in
M4-CHECKS §5 — eligibility is only claimed when the full triple passes for every
case, and this document says so while it is still false.

## What is live today

- Harness + 3 cases + prompts + selftest (13 exit-code assertions) run in CI
  (`pnpm bench:selftest` after `pnpm -r build`).
- Receipts pin `repositoryCommit` + `packageSha256` (sha256 of the built model
  dist) on every recorded failure; defect tags are the fixed ten-item set
  (clipping, node-overlap, label-overlap, hidden-route, stacked-edge,
  weak-hierarchy, unbalanced-whitespace, theme-contrast).

## What awaits a valid direct `sk-ant-…` key (same blocker as M3 live extraction)

- Feeding `prompts/*.txt` through `POST /api/generate` → gate the produced models
  → fill the semantic/validate columns with real model output.
- Browser visual review per case → fill the visual-review column with a name.

## Weak axes, stated honestly

- Three cases is a floor, not a spread; M5 adds Suite B (repair-rounds:
  deterministic mutations + expected diagnostic codes + oracle repairs) and more
  cases.
- The semantic gate checks topology + type binding only — label quality and
  layout are the visual-review gate's job, and it stays unclaimed until run.

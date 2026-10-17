# Expand internals (drill-down step 2) — plan

Spec: `docs/superpowers/specs/2026-10-17-component-drill-down-design.md` (step 2). Execution: inline, test-first.

- [x] **Model** `packages/model/src/internals.ts`:
  - `internalsOf`, `isInternal`, `canExpand`, `expansionErrors`, `applyExpansion`, `detailDrift`
  - membership extension in `detail.ts`
  - `applyEditOps` join and removal rules
  - verify: rule tables for each rule, id construction and collisions, semantic checks, membership, drift, removal refusal, refinement-added internals, undo, round trip; mutations caught.
- [x] **Graph helpers:** view-scoped `journey`/`reachability`; Canvas and share-card callers.
  - verify: an overview route never passes through edges outside the view.
- [x] **LLM:**
  - `expandComponent` (hosted, wire), `expandComponentLocal` (native), shared prompt and minimal fenced context, fake expansion, hosted local-only refusal
  - verify: request contract, repair messages, usage accumulation, cancellation, injection fencing.
- [x] **Route:** `POST /api/models/[id]/expand` plus `serverDeps.expandComponent`.
  - verify: success and credit, refund paths, stale before and after, owner, invalid, not expandable, limit, local mode free.
- [x] **Workspace:** expand control, caption, banner, drift note; canvas internal style and overview marker.
  - verify: page and canvas tests.
- [x] **Gates; live** (hosted and native, fake=false); **docs; PR.**

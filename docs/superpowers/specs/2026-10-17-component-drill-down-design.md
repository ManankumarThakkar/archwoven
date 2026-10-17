# Component drill-down — design

Date: 2026-10-17. Release task 10 (RELEASE-PROGRESS.md). SPEC §2: "bounded component-detail drill-down"; brief: component detail shows "selected modules/classes/layers and supported dependencies at an explicitly stated level of abstraction."

## Decisions (approved in conversation)

- **Hybrid, staged.** Step 1 (PR A) adds free, deterministic detail views. Step 2 (PR B) adds inference-backed "Expand internals" inside a detail view.
- **Internals are detail-only.** The architecture overview keeps its level of abstraction. Cross-level links must agree.
- No schema change. Schema v1 is reused: `View.focus`, `Node.group`.

## Step 1 — detail views (PR A)

### Representation
- A drill-down view is `{ id: 'detail:<nodeId>', type: 'component-detail', focus: <nodeId> }` in `model.views`. `isDetailView(v)` requires both the type and the exact id/focus pairing. Generated component-detail views never match, so they are never modified.
- Membership is derived by `detailMembership(model, focus)`: the focus first, then direct neighbours in edge order (deduplicated), plus every edge with the focus as an endpoint, self-loops included once. Step 2 extends this rule.
- `syncDetailViews(model)` recomputes the membership of every detail view. It drops views whose focus is missing or is an ER entity, and copies the first architecture view's orientation (null if there is none). It runs inside `applyEditOps` (refinement and direct edits), `orientArchitecture`, and the open/close actions. Undo restores content that was already synced.
- At most `MAX_DETAIL_VIEWS = 12` per model.

### Actions (direct-edit endpoint; owner-checked, revision-checked; no inference, usage records or credits)
- `{ type: 'detail', target }`: target must be an existing non-entity node. If the view exists, the model is returned unchanged and no revision is written. Otherwise one revision appends the view.
- `{ type: 'close-detail', viewId }`: viewId must be an existing detail view. One revision removes only the view.
- Malformed actions, extra keys, unknown targets, entities, non-detail view ids or a full limit → 400 with no write. Stale revision → 409 with the latest model. Another session → 404.

### Layout
- `manualLayout` ignores saved positions for detail views. They always auto-arrange, on screen and in exports, because schema v1 positions are a global node-id map shared with the architecture view.
- Dragging and keyboard nudges are disabled in detail views (`onMove` is not provided).

### Workspace
- The inspector shows **Open detail** for a selected non-entity node, except when the current view is that node's detail view. It is disabled while busy or when the limit is reached (with a hint).
- Detail tabs follow the base tabs, labelled "<current focus label> · detail" (truncated, full label in the title). Each has a close button with an accessible name and a 44 px target.
- Opening switches to the tab and writes `view=detail:<id>` to the hash. The selection is kept: the canvas retains its focus channel for nodes present in the destination view, so clearing the inspector would desynchronize them. The detail outline appears when no stronger focus channel is active. Closing the active tab, undo, refinement removal, or a hash naming a missing view all fall back to the first view and update the hash. Every view consumer (canvas, export, refine view type) reads the resolved current view, never a stale id.
- Export file names replace characters outside `[A-Za-z0-9._-]` (detail ids contain `:`).
- The detail canvas shows the caption "<label> and its direct connections · arranged automatically" (plus "· no direct connections" when there are none) and outlines the focus node.

## Step 2 — Expand internals (PR B)

- **Trigger:** a detail view without internals offers **Expand internals** (refinement weight 0.25 credits hosted; free locally), with an optional hint of up to 300 characters. It is synchronous, with refinement's reservation, refund, metering and cancellation semantics.
- **Provider contract** (hosted wire and local native): `{ internals: [{ key, label, role }] (2–8), links: [{ from, to, type, label? }] }`. The server builds ids (`<focusId>/<slug>`, deduplicated), `kind: 'component'`, `group: <focusId>`, provenance (`inferred`, or `proposed` when answering the hint) and empty evidence.
- **Server rules,** with violations sent back through the bounded repair loop and named errors:
  - soundness: an internal→X link requires focus→X with the same direction and type
  - completeness: every focus link is covered by at least one internal link
  - internal-only keys, no self-loops or duplicates, and plain-text length limits
  - repository and user text fenced as untrusted data
- **Model effects:**
  - `applyEditOps` no longer auto-joins grouped nodes to architecture views.
  - Removing a node is refused while grouped nodes reference it.
  - Detail membership becomes internals + neighbours + internal links. The focus is drawn as a view-only container (existing boundary hull) labelled with its current name.
  - The overview marks expanded components.
- **Bounds and disclosures:**
  - nesting is limited to one level, and there is no re-expansion (use refinement or undo)
  - repository models show "Internals are inferred, not found in source"
  - drift notices name uncovered or unbacked links after later overview changes, and nothing is silently rewritten
  - private models never reach hosted providers (existing router)

## Verification

- Every unit is built test-first: the model package (membership tables, sync, actions, undo, round-trip), routes (owner/stale/malformed/no credits), workspace (inspector, tabs, fallback, hash, drag disabled, exports), and for step 2 the contract, rules, provenance, credits and the local request contract.
- Deliberate mutations prove that the key tests catch breaks.
- Full gates: hosted and local suites, typechecks, isolated production build, benchmark self-tests.
- Live checks run real headless Chrome against hosted and native Ollama servers with fake mode off: real models; open/rename/refine/undo/close/reload/stale tab; exports inspected; 390 px; calls and credits unchanged in step 1. Failures are recorded as failures.

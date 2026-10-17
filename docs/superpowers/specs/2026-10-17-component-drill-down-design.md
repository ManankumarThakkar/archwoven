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

Revised after code inspection (2026-10-17). Boundaries are post-layout hulls and the layout engine does not group nodes, so a container box could visually enclose non-member neighbours. Internals are therefore **marked**, not boxed. A grouped (compound) layout is a possible separate follow-up.

### Definitions
- An **internal** of component F is a node with `group === F`, where F is an existing node, and that node is in no architecture view. Generated models that use `group` differently are unaffected.
- **Expandable:** F exists, is not an ER entity, is not itself an internal, and has no internals yet. Nesting is limited to one level, and there is no re-expansion; use refinement or undo instead.

### Contract
- The provider sees a minimal context only: the title, the focus, its direct neighbours and the focus's links. It is fenced as untrusted data with `fenceEscape`. An optional user hint of up to 300 characters is passed as guidance.
- The provider returns `{ internals: [{ key, label }] (2–8), links: [{ from, to, type, label? }] }`. `from`/`to` are internal keys or neighbour ids.
- The server builds everything else:
  - node ids `<F>/<slug(key)>` and edge ids `<F>/link-<n>`, unique against the model
  - `kind: 'component'`, `group: F`, `provenance: 'inferred'`, `evidence: []`
  - link provenance `inferred`
  - nothing provider-controlled reaches ids, kinds, provenance or evidence

### Rules (pure validator in `@archwoven/model`, shared by hosted and local repair loops and the route)
1. **Shape:**
   - 2–8 internals
   - keys unique and matching `[a-z0-9-]{1,40}`
   - labels 1–60 characters, trimmed, unique case-insensitively, and different from the focus label
   - link labels at most 80 characters
2. **Endpoints:**
   - each link has at least one internal endpoint
   - the other endpoint is an internal or a focus neighbour
   - no internal self-loops, no duplicate (from, to, type)
3. **Soundness:** internal→X requires focus→X with the same type; X→internal requires X→focus with the same type. Internal→internal links are allowed for any type.
4. **Completeness:**
   - every focus→X link is covered by some internal→X link of the same type, and every X→focus link by some X→internal link of the same type
   - a focus self-loop is covered by an internal→internal link of the same type
5. **Semantic checks:** when `allowedRoots` is non-empty, every internal has an incoming link; when `allowedTerminals` is non-empty, every internal has an outgoing link. The checks themselves are never edited.

Violations are returned as named errors to the bounded repair loop (`MAX_REPAIRS`). When repairs are exhausted, nothing is saved.

### Model effects
- **`applyEditOps`:**
  - an added node whose `group` names an existing node is not auto-joined to architecture views
  - removing a node is refused while internals reference it
- **Detail membership for an expanded focus:** internals, plus all focus neighbours, plus links with an internal endpoint. The focus itself is not drawn.
- The detail view is created in the same revision if it is missing; the 12-view limit is checked before inference.
- **Drift** (derived, never auto-fixed): uncovered focus links and internal links no longer backed by a focus link are listed in the detail tab.

### Graph helpers
- `journey`/`reachability` take the view's edges. This applies to canvas focus, the route probe and the share card. It prevents overview routes through hidden internals, and also prevents routes through any edge outside the view.

### Request path
- `POST /api/models/:id/expand { baseRevision, target, hint? }` follows refinement semantics:
  - owner 404, stale 409 (before and after inference)
  - reserve `refine` (0.25 hosted; free locally; separate metering label is task 14)
  - refund and meter on failure, cancellation or staleness
  - `withSlot` concurrency
  - 400 for invalid or non-expandable targets before any reservation
- The hosted path refuses `local-only` models in code. Fake mode returns a deterministic expansion that satisfies the rules: an entry internal takes incoming links, a core internal takes outgoing links and self-loops, with entry→core between them.

### Workspace
- **Detail tab:**
  - an **Expand internals** control with an optional hint and the credit cost shown in hosted mode
  - disabled while busy; hidden when the focus is not expandable
  - the hint is preserved on failure
- **Caption once expanded:** "Inside <label> (inferred) · and its direct connections". Repository models (any source-supported node) also show "Internals are inferred, not found in source."
- Drift is listed as a status note.
- **Canvas:**
  - internals have a dashed style with the sub-label "inside <label>"
  - the overview marks an expanded component "has detail" (visible text and accessible name)

## Verification

- Every unit is built test-first: the model package (membership tables, sync, actions, undo, round-trip), routes (owner/stale/malformed/no credits), workspace (inspector, tabs, fallback, hash, drag disabled, exports), and for step 2 the contract, rules, provenance, credits and the local request contract.
- Deliberate mutations prove that the key tests catch breaks.
- Full gates: hosted and local suites, typechecks, isolated production build, benchmark self-tests.
- Live checks run real headless Chrome against hosted and native Ollama servers with fake mode off: real models; open/rename/refine/undo/close/reload/stale tab; exports inspected; 390 px; calls and credits unchanged in step 1. Failures are recorded as failures.

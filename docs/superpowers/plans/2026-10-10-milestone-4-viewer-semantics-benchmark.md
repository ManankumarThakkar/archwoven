# M4 — Semantics-enriched IR, guided viewer, benchmark floor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the typed SystemModel with machine-checkable semantics (semanticChecks, mainPath, edge roles, boundaries, guided views), turn the canvas into a guided explorer (focus/reachability highlighting, route-probe playback, chapters, motion governor, share cards), and publish eval evidence through a benchmark harness skeleton — all ideas ported from the archify brief as React/state, never vendored files.

**Architecture:** Schema additions are optional + strict-compatible (`schemaVersion` stays `'1'`): old models validate and render unchanged. Extraction emits `semanticChecks` from detected routes; `validateModel` enforces them at every revision (server-side, same gate as M3). Viewer intelligence lives in pure functions (`graph-inspect.ts`, `motion.ts`) unit-tested without DOM; Canvas.tsx and the workspace reducer consume them. `/api/share-card` reuses `buildSvg` + resvg-wasm already in the repo. The benchmark harness is a standalone `.mjs` that imports the built `@archwoven/model` dist.

**Tech Stack:** Zod, vitest, @xyflow/react 15, @resvg/resvg-wasm (already a dep), node:zlib-free (no new deps).

**Spec:** `docs/SPEC.md` (§5 schema, §6 UI, §11 evaluation, §15 quotas — LOCKED numbers untouched).
**Historical input:** an ignored reference brief, not distributed with the repository (current viewer scope: `docs/SPEC.md` §6) — license gate: **no vendored files at all** in this milestone (concepts ported only), so no copyright-notice task; `generated-brand-marks.mjs` stays un-vendored.

## Global Constraints

- §15 LOCKED: no new credit weights. Share-card uses `action: 'view'` (weight 0) + the existing burst limiter. Pools 6/burst 5-per-min-session/20-per-min/IP unchanged.
- SPEC §5: generation/refinement emit this JSON only — never HTML/SVG/Mermaid (share-card SVG is rendered FROM the model server-side, never stored as source of truth).
- SPEC §6: provenance never rendered via opacity tricks (focus dimming is a separate visual channel from provenance border/badge — keep both visible on dimmed nodes).
- All new schema fields optional or defaulted; `schemaVersion` stays `'1'`; every existing test stays green without edits (backward compatibility is a Review Focus item).
- Repo text stays untrusted data (§14): extraction-emitted `semanticChecks` are structural facts, and the `<repo-data>` fence + pinEvidence pipeline is unchanged.
- No vendored archify files this milestone; JetBrains/OFL fonts not embedded.
- Reduced motion: OS `prefers-reduced-motion` respected without any localStorage (CSS media query), "Still" mode is the app-level override.

## Review Focus

1. **Backward compatibility:** every pre-M4 model (fixtures, stored revisions) validates and renders with zero changes — new fields absent must never trigger semanticChecks enforcement errors.
2. **Cycles and self-references in semanticChecks:** `requiredPaths: [{from: a, to: a}]`, cyclic graphs, unknown ids — validation must terminate (BFS with visited set) and name the offending id, never loop or crash.
3. **Graph-scale:** reachability/journey BFS on fastapi-scale synthetic graphs (~700 nodes, ~1300 edges) completes in well under a second and never enumerates paths exponentially.
4. **Share-card abuse + privacy:** non-owner modelId → 404; burst tripped → 429 with §15 copy; PNG bytes contain only node/edge labels — no evidence paths, no commit SHAs in card text.
5. **Motion governor:** "Still" mode stops ALL motion (edge animation, fitView tween, pulses) including on a machine WITHOUT reduced-motion OS setting; OS reduced-motion works with localStorage empty.
6. **Boundary hulls:** single-member boundary and a boundary whose members are not all in the current view must render without NaN coordinates or crash.

---

### Task 1: Schema additions + semantic validation (packages/model)

**Files:**
- Modify: `packages/model/src/schema.ts`
- Modify: `packages/model/src/validate.ts`
- Modify: `packages/model/src/fixtures.ts` (add an extended fixture, keep existing untouched)
- Modify: `docs/SPEC.md` §5 (append the optional fields to the sketch, one block)
- Test: `packages/model/src/schema.test.ts`, `packages/model/src/validate.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 2–7):
  ```ts
  export const EdgeRoleSchema = z.enum(['main','branch','async','return','error']);
  // EdgeSchema += role: EdgeRoleSchema.nullish()
  // ViewSchema += mainPath: z.array(z.string()).min(2).nullish()  // ordered node ids; consecutive pairs need a forward edge
  export const SemanticChecksSchema = z.object({
    allowedRoots: z.array(z.string()).default([]),
    allowedTerminals: z.array(z.string()).default([]),
    requiredEdges: z.array(z.object({ from: z.string(), to: z.string(), type: EdgeTypeSchema.nullish() }).strict()).default([]),
    requiredPaths: z.array(z.object({ from: z.string(), to: z.string() }).strict()).default([]),
  }).strict();
  export const BoundarySchema = z.object({ id: z.string().min(1), label: z.string().min(1), wraps: z.array(z.string()).min(1) }).strict();
  export const GuidedViewSchema = z.object({ id: z.string().min(1), label: z.string().min(1), focus: z.array(z.string()).min(1), note: z.string().nullish() }).strict();
  // SystemModelSchema += semanticChecks: SemanticChecksSchema.nullish(),
  //   boundaries: z.array(BoundarySchema).default([]), guidedViews: z.array(GuidedViewSchema).max(5).default([])
  ```
  `validateModel` enforces: ids exist; `requiredEdges` matched by ≥1 edge (type honored when present); `requiredPaths` BFS-reachable; every node with no incoming edge ∈ `allowedRoots` (only when `semanticChecks` present); no-incoming/outgoing discipline for terminals; `mainPath` ids ∈ view.nodes + consecutive pairs have a forward edge; `boundaries.wraps` ids exist + no node in two boundaries; `guidedViews.focus` ids exist.

- [ ] **Step 1: Write failing schema tests** — old fixture still validates unchanged (no new required keys); a model with all new fields valid; `guidedViews` of 6 rejected; `wraps: []` rejected; `role: 'bogus'` rejected.
- [ ] **Step 2: Run → FAIL** (`pnpm vitest run packages/model`) — new-field tests fail on strict unknown-key.
- [ ] **Step 3: Implement schema additions** exactly as in Interfaces.
- [ ] **Step 4: Run schema tests → PASS.**
- [ ] **Step 5: Write failing validation tests** — names: `enforces requiredPaths reachability`, `unknown id in allowedRoots names the id`, `cyclic requiredPaths self-reference terminates ok|fails cleanly`, `requiredEdges type honored`, `mainPath pair without edge rejected`, `node in two boundaries rejected`, `absent semanticChecks skips root discipline (backward compat)`, `fastapi-scale synthetic 700-node graph validates < 1000ms`.
- [ ] **Step 6: Run → FAIL** on the new checks.
- [ ] **Step 7: Implement** the extra passes in `validateModel` after existing referential checks (BFS with visited set; adjacency built once).
- [ ] **Step 8: Run → PASS**, then `pnpm vitest run` full suite green (existing fixtures untouched).
- [ ] **Step 9: SPEC §5 append + commit** `feat(model): optional semanticChecks, mainPath, edge roles, boundaries, guided views + enforcement`.

### Task 2: Extraction emits semanticChecks (packages/extract)

**Files:**
- Modify: `packages/extract/src/fragment.ts` (`Fragment += semanticChecks?: SemanticChecks`)
- Modify: `packages/extract/src/java.ts`, `packages/extract/src/python.ts`
- Test: `packages/extract/src/extract.test.ts`

**Interfaces:**
- Consumes: `SemanticChecks` from Task 1 (`@archwoven/model`).
- Produces: `fragment.semanticChecks` — `allowedRoots` = detected entry nodes (controllers/actors the extractor saw as request targets); `requiredEdges` = controller→service call pairs already detected (type `'sync'`); `requiredPaths` = endpoint binding pairs. Emitted ONLY when the extractor actually saw the structure (never guessed); absent fragment field stays absent (no empty-object noise).

- [ ] **Step 1: Write failing tests** — java fixture with a controller calling a service: `fragment.semanticChecks.requiredEdges` contains `{from: <controller>, to: <service>, type:'sync'}` with provenance-free structural ids; python fixture same; fixture with no detected calls → `semanticChecks` absent.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** in both extractors where endpoint/call detection already lives (no new parsing).
- [ ] **Step 4: Run → PASS** (`pnpm vitest run packages/extract`).
- [ ] **Step 5: Commit** `feat(extract): emit semanticChecks from detected route bindings`.

### Task 3: Prompt + fake pipeline carry the optional fields (packages/llm)

**Files:**
- Modify: `packages/llm/src/client.ts` + `packages/llm/src/repo.ts` (both carry the `system_model` schema text), fake fixtures
- Test: `packages/llm/src/repo.test.ts`, `packages/llm/src/local.test.ts`

**Interfaces:**
- Consumes: Task 1 schema (repair loop's `validateModel` now enforces semanticChecks).
- Produces: prompt schema text documents the optional fields in ≤6 added lines (faithful names: `semanticChecks`, `mainPath`, `role`, `boundaries`, `guidedViews`); fake mode emits a model WITH `semanticChecks` + `mainPath` + one `guidedViews` chapter so the full validate→save path exercises them; `pinEvidence` untouched.

- [ ] **Step 1: Write failing tests** — prompt text contains `semanticChecks` and `mainPath`; fake-mode `assembleRepoModel` output passes `validateModel` INCLUDING semanticChecks; a fake output violating its own `requiredPaths` fails the repair loop with an id-naming error.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** prompt lines + fake fixture enrichment.
- [ ] **Step 4: Run → PASS** (`pnpm vitest run packages/llm`).
- [ ] **Step 5: Commit** `feat(llm): prompts document semantic IR fields; fake mode exercises them`.

### Task 4: Graph inspection + motion governor (pure, apps/web)

**Files:**
- Create: `apps/web/app/workspace/graph-inspect.ts`
- Create: `apps/web/app/workspace/motion.ts`
- Test: `apps/web/app/workspace/graph-inspect.test.ts`, `apps/web/app/workspace/motion.test.ts`

**Interfaces:**
- Consumes: `SystemModel`, `Edge` (Task 1 `role`).
- Produces (consumed by Tasks 5–6):
  ```ts
  export function reachability(model: SystemModel, id: string): { forward: Map<string, number>; backward: Map<string, number> } // BFS depth, unknown id → empty maps
  export function journey(model: SystemModel, from: string, to: string): string[] | null // shortest forward node path, null if unreachable
  export function motionMode(stored: string | null, osReduced: boolean): 'still' | 'motion' // stored 'still' wins; else osReduced → 'still'
  ```

- [ ] **Step 1: Write failing tests** — depth correctness on a 6-node chain; cycle terminates; unknown id empty maps; `journey` unreachable → null; 700-node synthetic graph both functions < 500ms; motionMode truth table (stored×os, 4 rows).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (adjacency built per call — no cache; graphs are small enough per Review Focus 3 perf test).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(web): pure reachability/journey/motion-mode helpers`.

### Task 5: Canvas focus, route probe, chapters, Still mode (apps/web)

**Files:**
- Modify: `apps/web/app/workspace/Canvas.tsx`, `apps/web/app/workspace/page.tsx`, `apps/web/app/globals.css`
- Test: extend `apps/web/app/workspace/states.test.ts` only if the reducer gains chapter/probe events (Ruling allowed: keep those as Canvas-local `useState`, reducer untouched)

**Interfaces:**
- Consumes: Task 4 helpers; `model.guidedViews`, `view.mainPath`, `model.boundaries`, `edge.role`.
- Produces: URL permalinks `#focus=<id>`, `#route=<from>~<to>`, `#chapter=<id>` (read on mount, written on interaction via `history.replaceState`).

- [ ] **Step 1: Focus highlight** — node click → `reachability`, non-reachable nodes get `data-dim="1"` (dimming keeps provenance border+badge visible, Review Focus 4/Spec §6), reachable carry `data-reach-depth`; permalink `#focus=`.
- [ ] **Step 2: Route probe** — from/to selects (all view nodes) + Play: journey nodes get `data-route="past|current|future"`, step timer 1100ms, "Still" mode jumps straight to full highlight (no stepping); permalink `#route=a~b`.
- [ ] **Step 3: Chapters** — `guidedViews` selector + prev/next: `fitView` over focus subset, focus nodes highlighted, note chip rendered; permalink `#chapter=`.
- [ ] **Step 4: Motion governor** — Still/motion toggle button persisted to localStorage `archwoven-motion`; `motionMode()` gates edge `animated`, fitView `duration`, probe stepping; CSS `@media (prefers-reduced-motion: reduce)` disables all transitions regardless of localStorage.
- [ ] **Step 5: Boundary hulls** — dashed rounded rect per boundary computed from member node bbox + 24px padding, `pointer-events: none`, single-member and partial-view cases render finite coords.
- [ ] **Step 6: Verify** — `pnpm vitest run apps/web` + `pnpm build` clean; manual fake-server pass (fake server command in M3-CHECKS, port 3111): click focus, probe a route, step a chapter, toggle Still; record transcript lines for docs.
- [ ] **Step 7: Commit** `feat(web): focus/reachability highlight, route-probe playback, guided chapters, motion governor, boundary hulls`.

### Task 6: Share-card route (apps/web)

**Files:**
- Create: `apps/web/app/api/share-card/route.ts`, `apps/web/app/api/share-card/card.ts`
- Test: `apps/web/app/api/share-card/route.test.ts`

**Interfaces:**
- Consumes: `buildSvg(model, viewId)` from `apps/web/lib/export-svg.ts`; `ensureResvg`/`renderPng` from `apps/web/probes/render/export.ts`; `serverDeps.store.getRevision`; burst via existing quota path (`action: 'view'`, weight 0).
- Produces: `POST /api/share-card { modelId, kind: 'route'|'reach', from, to?, viewId? }` → owner-checked; builds a 1200×630 SVG card (title, node labels on the journey/focus set, kind badge — **no evidence paths, no commit SHAs**, Review Focus 4); PNG via resvg with the bundled fonts path already used in tests; `image/png` response. Rate: burst limiter only.

- [ ] **Step 1: Write failing route tests** — owner gets PNG (magic bytes `‰PNG`); other session → 404; unknown modelId → 404; 6th call in burst window → 429 with §15 copy; card text extraction contains node labels but NOT `evidence[0].path` nor the commit SHA.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `card.ts` (`buildCardSvg(model, viewId, kind, from, to): string` — plain string SVG, 1200×630, dark theme) + route handler (quota → owner-check → build → resvg → PNG). Node-side `ensureResvg(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')))`.
- [ ] **Step 4: Run → PASS** + full suite green.
- [ ] **Step 5: Wire a Share button** on the canvas header (route/reach modes from current probe/focus) calling the endpoint and downloading the PNG; fake-server manual pass, transcript captured.
- [ ] **Step 6: Commit** `feat(web): quota-gated route/reach share-card endpoint + canvas share button`.

### Task 7: Benchmark harness — ordinary-model-floor (benchmarks/)

**Files:**
- Create: `benchmarks/README.md`, `benchmarks/ordinary-model-floor/{manifest.json,harness.mjs}`, `benchmarks/ordinary-model-floor/cases/{todo-api,checkout,boring-crud}.case.json`, `benchmarks/ordinary-model-floor/prompts/*.txt`
- Test: `benchmarks/ordinary-model-floor/harness.selftest.mjs` (run via `node`, no vitest)

**Interfaces:**
- Consumes: `@archwoven/model` **dist** (`packages/model/dist/index.js` — build first).
- Produces (mirrors archify format, adapted):
  - case JSON: `{ id, requirements: { nodes: [{ key, labels: [aliases], type }], relationships: [{ from, to, labels }] } }` — alias match = case-insensitive label hit; type binding mandatory.
  - `harness.mjs check <case.json> <model.json>` → semantic gate: every required node bound (alias+type), every required edge present → exit 0/1, missing items named.
  - `harness.mjs verify <model.json>` → `validateModel` (shape + referential + semanticChecks) → exit 0/1.
  - `harness.mjs record-failure <case-id> <defect-tag>` → JSONL receipt `results/<date>-<runner>.jsonl` pinning `repositoryCommit` (git rev-parse HEAD) + `packageSha256` (sha256 of model dist). Defect tags: the archify set verbatim (`clipping, node-overlap, label-overlap, hidden-route, stacked-edge, weak-hierarchy, unbalanced-whitespace, theme-contrast`).
  - `harness.mjs report` → failure clusters + `evidenceEligible: true` only when every case has a passing gate triple (semantic + deterministic validate + named human visual review — `visual-review: skipped` ≠ pass); exit 0 all-pass / 1 failures / 2 incomplete.
  - `harness.mjs selftest` → runs bundled good/bad model fixtures through check+verify, asserts exit codes; this is the CI-runnable test.

- [ ] **Step 1: Write `harness.selftest.mjs`** — good fixture exits 0 on check+verify; missing-required-edge fixture fails `check` naming the pair; unknown-node-alias fails; a model violating its own semanticChecks fails `verify`; report on partial results exits 2.
- [ ] **Step 2: Run → FAIL** (`node benchmarks/ordinary-model-floor/harness.selftest.mjs`).
- [ ] **Step 3: Implement harness.mjs + manifest + 3 cases + prompts** (prompts = the exact requirement text fed to generate in a live run; live-run execution awaits API key, same as M3 pending — skeleton must be complete and self-testing now).
- [ ] **Step 4: Run selftest → PASS**; add `bench:selftest` script to root `package.json` and a `node benchmarks/ordinary-model-floor/harness.selftest.mjs` step to `.github/workflows/ci.yml` (the `verify` job).
- [ ] **Step 5: Commit** `feat(bench): ordinary-model-floor harness with selftest, receipts, report gates`.

### Task 8: Evidence docs + traceability

**Files:**
- Create: `docs/M4-MATRIX.md`
- Modify: `docs/TRACEABILITY.md`, `docs/M4-CHECKS.md` (create)

**Interfaces:** Consumes: every prior task's outputs + fake-server transcripts from Tasks 5–6 + `harness report` output.

- [ ] **Step 1:** `docs/M4-CHECKS.md` — live fake-mode transcripts: focus permalink deep-link opens highlighted canvas, route probe playback, chapter step, Still mode (before/after), share-card 200 PNG + 404 + 429 ladder, backward-compat load of a pre-M4 stored revision.
- [ ] **Step 2:** `docs/M4-MATRIX.md` — benchmark floor table (3 cases × 3 gates, honest `pending-key` cells for live runs), defect-tag legend, `evidenceEligible` status with the reason.
- [ ] **Step 3:** TRACEABILITY rows: spec §5/§6/§11 → code → test, one row per new capability.
- [ ] **Step 4: Commit** `docs: M4 evidence matrix, scenario checks, traceability`.

---

## Verification (whole plan)

`pnpm vitest run` green · `pnpm -r exec tsc --noEmit` clean · `pnpm build` clean · `node benchmarks/ordinary-model-floor/harness.selftest.mjs` exit 0 · fake-server manual transcripts captured to `docs/M4-CHECKS.md`.

## Out of scope (ledgered for M5)

Suite B repair-rounds harness; `animation`/`qualityProfile` schema fields (motion governance is viewer-side only); portable single-file export; WebM; brand marks (never); node icons; grid coords.

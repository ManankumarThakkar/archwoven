# Milestone 1 — Technical Probes (go/no-go evidence before M2 commits)

> **For agentic workers:** Implement task-by-task; steps use checkbox (`- [ ]`) syntax. Probe code lives in `probes/` (committed, disposable); every probe ends in a memo with numbers at `docs/probes/`.

**Goal:** Produce measured go/no-go evidence for the four load-bearing mechanisms: typed-JSON rendering (incl. sequence), Claude structured-output validity/cost, tree-sitter extraction precision, and local-model capability on the M5 Max.

**Architecture:** Each probe consumes M0's `@archwoven/model` fixtures and emits (a) working spike code, (b) a memo with numbers, (c) a verdict that either promotes the approach into M2 or triggers the fallback recorded here.

**Tech Stack:** @xyflow/react 12.12 + elkjs 0.12 + @resvg/resvg-wasm 2.6 (MIT/EPL/MPL, notices kept); @anthropic-ai/sdk (model `claude-opus-5-5`); web-tree-sitter 0.27 + tree-sitter-java/python; Ollama v0.35+.

**Spec:** `docs/SPEC.md` (§1 stack, §5 model, §10 efficiency, §11 evals)

## Global Constraints

- No probe touches production paths; `probes/` and `apps/web` spike pages only.
- Every model call logs `{input, cached, output tokens, latency, valid?}` — memos cite measured numbers, never estimates.
- API spend across all of M1 ≤ $5 (user-supplied key; count before running probe B/D batches).
- Fixture reuse: M0's `valid-full.json` is probe A's input; probes B/C share a ground-truth JSON convention `{expected_nodes:[], expected_edges:[]}`.
- Pin every dependency version at install (`npm view` re-verify — tree-sitter-java npm lags repo).

## Review Focus

1. ELK chokes or overlaps on bidirectional edges and self-loops — fixture must include both; expect a legend/spacing fix decision in memo A.
2. LLM structured output emits dangling edge ids / misnumbered `seq` — probe B counts occurrences; M0 validator is the detector.
3. WASM grammar loading in Next.js API routes (path resolution under `next build`) — probe C must run inside an API route, not just a script.
4. resvg-wasm renders blank boxes without explicit `fontBuffers` — memo A pins the WOFF2 set.
5. Ollama truncates long JSON at default `num_predict` — probe D tests a 40-node output and records the ceiling.

---

### Task 1: Probe A — render + export pipeline

**Files:**
- Create: `probes/render/layout.ts` — `export async function layoutModel(model: SystemModel, viewId: string): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }>` (ELK layered, `elk.direction` from view.orientation)
- Create: `probes/render/SequenceSvg.tsx` — own-model → pure SVG (lifelines, activation bars, alt/opt fragments, no foreignObject)
- Create: `probes/render/export.ts` — `exportPng(svgEl): Promise<Blob>` via resvg-wasm + bundled WOFF2 `fontBuffers`
- Create: `apps/web/app/probe-a/page.tsx` — loads M0 fixture, renders architecture + ER via React Flow custom nodes, sequence via SequenceSvg
- Create: `docs/probes/A-rendering.md` (memo)

**Interfaces:** Consumes `validateModel` + `valid-full.json` (M0). Produces `layoutModel`, `SequenceSvg`, `exportPng` — promoted verbatim into `apps/web` at M2.

- [ ] **Step 1:** Install pinned deps; add ELK worker wiring (browser) + `elk.layout()` Node path for future SSR export
- [ ] **Step 2:** Render M0 fixture architecture view; then extend fixture copy to ~40 nodes with a bidirectional pair + self-loop (Review Focus 1); screenshot
- [ ] **Step 3:** ER custom node (header + field rows + PK/FK badges) with fixture ER view
- [ ] **Step 4:** SequenceSvg on fixture sequence view incl. one `alt` fragment; eyeball overlap rules
- [ ] **Step 5:** PNG export at 2× — verify sharpness + fonts (Review Focus 4); SVG export = serialized own SVG
- [ ] **Step 6:** Memo A: legibility verdict at 10/40 nodes, overlap count, export size/quality, font set pinned → commit `probe(a): render+export pipeline + memo`

**Go/no-go:** architecture+ER at 40 nodes legible with ELK defaults + ≤2 manual tweaks; sequence SVG renders fixture cleanly. Fallback: `@dagrejs/dagre` for layout if ELK integration stalls >1 week.

### Task 2: Probe B — Claude structured output (hosted path)

**Files:**
- Create: `packages/llm/src/client.ts` — `export async function generateModel(prompt: string, view: ViewType): Promise<ValidationOutcome>`: Zod→JSON Schema (zod v4 → `z.toJSONSchema`) → `messages.create({ model:'claude-opus-5-5', output_config:{ format:… , effort:'medium' }, cache_control on system+schema prefix, max_tokens: 8000 })` → `validateModel` → ≤2 repair loops (send validator errors back) → meter
- Test: `packages/llm/src/client.test.ts` (mocked SDK: repair-loop count, metering shape)
- Create: `probes/llm/run-eval.ts` — 10 plain-English prompts (from SPEC §4 example chips), logs `{input, cache_read, output, latency, first_pass_valid, seq_errors, dangling_ids}`
- Create: `docs/probes/B-claude-structured.md`

- [ ] **Step 1:** Write failing mocked tests (invalid first pass → 1 repair → valid; meter row emitted; 2-repair ceiling returns failure state) → run → FAIL
- [ ] **Step 2:** Implement `client.ts` → tests PASS → commit `feat(llm): structured-output client + metering`
- [ ] **Step 3:** Run `run-eval.ts` against real API (est. <$1); compute first-pass validity, cache-hit rate, median tokens, cost/task
- [ ] **Step 4:** Repeat at `effort:'low'` for the same 10 prompts; record quality delta
- [ ] **Step 5:** Memo B with numbers vs §11 proposed targets → commit

**Go/no-go:** first-pass validity ≥ 90% AND `cache_read_input_tokens > 0` on repeats AND cost/task ≤ $0.03. Fallback: split into 2-step generate-then-validate prompts (re-measure).

### Task 3: Probe C — tree-sitter extraction (repo path)

**Files:**
- Create: `probes/fixtures/repos/spring-mini/` + `fastapi-mini/` — hand-built minimal apps WITH ground truth (`expected.json` per Review convention: endpoints, layers, entities+relations, datasource, one gap case each)
- Create: `packages/extract/src/{loader.ts,java.ts,python.ts}` — `export function extractSpringBoot(dir): Fragment` / `extractFastApi(dir): Fragment` (web-tree-sitter WASM; returns model fragments with `Evidence{path,lines}`)
- Create: `apps/web/app/api/probe-c/route.ts` — runs extraction inside an API route (Review Focus 3)
- Create: `docs/probes/C-extraction.md`

- [ ] **Step 1:** Build fixture repos + `expected.json` (spring-mini: 2 controllers, 2 services, 1 JPA entity pair, Kafka listener, `${placeholder}` gap case; fastapi-mini: router+prefix, Depends chain, SQLAlchemy model, BackgroundTasks, computed-prefix gap case)
- [ ] **Step 2:** Failing tests: `extractSpringBoot(springMini)` node/edge set ⊇ expected, precision = matched/extracted ≥ 0.9; same FastAPI → FAIL
- [ ] **Step 3:** Implement grammars+queries → PASS; run API-route smoke
- [ ] **Step 4:** Stress: download spring-petclinic tarball (codeload, no auth) → extract → manual precision pass, record gap list (submodules/LFS absence labeled)
- [ ] **Step 5:** Memo C: precision/recall per construct, WASM-in-route verdict → commit

**Go/no-go:** ≥0.9 precision / ≥0.8 recall on hand-built fixtures; petclinic gap list publishable. Fallback: `java-parser` pure-JS for Java.

### Task 4: Probe D — local model on M5 Max (private path)

**Files:**
- Create: `packages/llm/src/local.ts` — same `generateModel` interface, Ollama `/api/chat` with `format: <json-schema>`
- Create: `probes/local/run-eval.ts` — probe B's 10 prompts minus 5, plus one 40-node output stress
- Create: `docs/probes/D-local-model.md`

- [ ] **Step 1:** `brew install ollama` (user approval — system install); `ollama pull gpt-oss:120b`; record actual disk/RAM footprint (spec estimate ~65 GB)
- [ ] **Step 2:** Run eval: schema-valid rate, TTFT, total latency, truncation ceiling (Review Focus 5); if TTFT > 20 s or truncation bites → pull `nemotron-3.5-lightning:30b` MLX variant and repeat
- [ ] **Step 3:** Memo D: model verdict, hardware requirements doc seed → commit

**Go/no-go:** schema-valid ≥ 85% end-to-end ≤ 30 s on one 15k-token prompt. Fallback order: nemotron 30B → smaller qwen-coder class → escalate to user (never external API for private content).

### Task 5: M1 synthesis

- [ ] **Step 1:** Write `docs/probes/SYNTHESIS.md`: 4-probe go/no-go matrix, measured cost/task, updated §11 targets, any SPEC [REC]→locked promotions, M2 plan adjustments
- [ ] **Step 2:** Update `docs/SPEC.md` with measured numbers; commit `docs: M1 synthesis`

---

**M1 done when:** SYNTHESIS.md shows 4 green verdicts (or a user-approved fallback), and SPEC §11 targets are calibrated to measurements.

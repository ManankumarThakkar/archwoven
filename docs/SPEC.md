# Archwoven — Working Specification v0.1

**Status:** Draft for user review. Derived from `Archwoven_Master_Project_Prompt.md` (rev 2) + decisions locked on 2026-10-06. Items marked **[REC]** are recommendations pending probe evidence; **[LOCKED]** are user-approved; **[OPEN]** need a user decision before the owning milestone.

**Goal:** Turn plain-English requirements or GitHub repos (Spring Boot / FastAPI) into clear, interactive, editable architecture diagrams from ONE typed system model — with provenance, controlled edits, enforceable processing boundaries, and measured quality/cost.

---

## 1. Decisions

### Locked (2026-10-06, this session)
| # | Decision |
|---|---|
| D1 | **Stack:** TypeScript monorepo — Next.js (UI + API routes), Zod system model, tree-sitter for parsing, @xyflow/react (React Flow) + ELK layout. One process serves hosted and local modes. |
| D2 | **Model:** Anthropic Claude API, user-supplied key, lean budget. Default `claude-opus-5-5`; structured outputs; prompt caching; per-task token metering. Smaller-model routing is a benchmark to run, not a preset. |
| D3 | **Hosting gate:** Anonymous use for plain-English + public repos (rate-limited); GitHub OAuth unlocks private repos. |
| D4 | **Private input path:** Local clone import first (zero auth surface, fastest boundary proof); GitHub fine-grained PAT/OAuth added within milestone 4. |
| D5 | **Hardware baseline for private mode:** user's Mac Studio M5 Max / 128 GB. Ollama (v0.35+, `format` = JSON-schema structured outputs) as local inference server. Candidates, validated at probe (d): **gpt-oss:120b** (~65 GB native MXFP4, 131k ctx, native schema-aware tool calling) default; **Nemotron 3.5 Lightning 30B MLX** (~18–20 GB est., 1M ctx, fast) fallback. ~8–10 s TTFT @ 15k-token prompt expected. Nemotron-class 550B models don't fit — skip. Sizes re-verified at install. |

### Stack — verified by research 2026-10-06 (licenses checked)
- **Architecture + ER views:** `@xyflow/react` 12.12 (MIT core; Pro tier is paid — never copy Pro-only templates) with custom nodes; ER entity boxes as custom node components.
- **Sequence view:** **custom SVG renderer** (own model → pure SVG) — lifelines/messages fight the node-graph abstraction; separate renderer, same model.
- **Auto-layout:** `elkjs` 0.12 (EPL-2.0 — linkable in closed source; keep notices, share any elkjs-file mods). `dagre` is dead → `@dagrejs/dagre` (MIT) only if ELK proves heavy.
- **PNG export:** `@resvg/resvg-wasm` 2.6.2 (MPL-2.0) with bundled WOFF2 `fontBuffers` — deterministic, no canvas-taint, no `foreignObject` (we emit pure SVG). SVG export = serialize our own SVG.
- **Mermaid:** MIT, multi-MB, text-grammar-first — **eval baseline only, never in the product path.**
- **archify:** MIT — inspiration-safe; attribute if any code is reused.
- **Parsing:** `web-tree-sitter` 0.27 (WASM — zero native-build pain in Next.js API routes/serverless) + `tree-sitter-python` 0.25 + `tree-sitter-java` 0.23.5 (all MIT; java npm releases lag an active repo — pin + re-verify at build). `java-parser` (MIT, pure-JS) as fallback. JVM JavaParser: skip (needs sidecar; take Apache license arm if ever used).
- **Repo ingestion:** codeload **tarball** default (no git binary, no `.git` bloat; excludes submodules + LFS objects → gap-listed); **fine-grained PAT, Contents:read-only, single-repo scope** as the minimal credential; `git clone --depth 1` only if submodules explicitly needed.
- **Secret gate pre-submission:** `gitleaks` CLI (MIT) + `secretlint` (MIT) pair, best-effort labeled. **Never trufflehog (AGPL — contamination).**
### Locked 2026-10-06 by principal review (reversal = one-line PR, keep it cheap)
- **Persistence:** SQLite (one file, same code hosted + local, trivial private-mode story). No Postgres until a real multi-node need appears.
- **Jobs:** in-process queue + durable job rows in SQLite (cancellation, retries, idempotency keys). No Redis/queues until measured need.
- **Theme:** dark-first; light mode post-release.
- **License:** MIT (matches archify inspiration; standard portfolio signal). Flip to other only before any commercial move.
- **Sequence view:** custom SVG renderer (per research) — locked, promoted out of [REC].
- **Anonymous persistence lifetime:** anonymous projects live 30 days, swept nightly; deleting the session cookie orphans them, deletion honored on request. No accounts required, no indefinite hoarding of other people's diagrams.
- **Monorepo scope:** one repository per analysis; user may narrow to ONE subdirectory prefix. No multi-package fan-out, no multi-repo.
- **GitHub Enterprise Server:** out of first release.
- **Name/domain/trademark:** user runs the clearance check before the repo flips public — hard gate, owner: Manan.
- Persistence: SQLite for revisions/projects (hosted + local same code); no graph/vector DB.
- Jobs: in-process job queue with durable job records; no external queue infra until evidence demands it.
- Theme: dark-first; light mode deferred post-release.

## 2. First-release scope

**In:** Describe-system mode; Import-repository mode (public + private, Spring Boot + FastAPI defined constructs); Architecture / Sequence / ER views + bounded component-detail drill-down; orientation toggle (↕/↔) inside Architecture (orientation ≠ semantic type); conversational refinement via patches; direct visual edits (move/rename); PNG/SVG/model-JSON export; evidence inspector; provenance badges; clarification questions; hosted + local deployment with same core; eval suite + published results.

**Out (unless separately approved):** billing, SSO, compliance claims, collab editing, code generation/deploy, live topology discovery, other languages, multi-repo analysis, webhooks/auto-reanalysis, plugin marketplace.

## 3. Supported-construct matrix (draft — probes finalize)

| Construct | Spring Boot | FastAPI | Extraction | Provenance |
|---|---|---|---|---|
| REST endpoints | `@RestController`/`@RequestMapping` | `@app.get/post/...` | tree-sitter deterministic | source-supported |
| Service/repo layers | `@Service` `@Repository` `@Autowired` | `Depends()` graph | tree-sitter | source-supported |
| Datastores | `@Entity` + JPA relations, `application.yml` datasource | SQLAlchemy models, settings/env | tree-sitter + config parse | source-supported |
| Messaging | `@KafkaListener` etc. | `BackgroundTasks`, stream libs | tree-sitter (subset) | source-supported / gap-listed |
| External calls | RestTemplate/WebClient/Feign targets | httpx/requests targets | tree-sitter | source-supported |
| Runtime/dynamic behavior | reflection, SpEL/`${placeholder}` values, DI wiring order, dynamic routes | computed `include_router` prefixes, monkeypatching | **not statically provable** | labeled gap |

Anything outside the matrix renders as an explicit **analysis gap**, never silence.

## 4. Architecture & data flow

```
apps/web (Next.js)
  ├─ UI: workspace, canvas (React Flow), inspector, refinement bar
  └─ /api/* routes ── same code in hosted & local mode
packages/model      Zod system-model schema, revision/patch logic, validators
packages/extract    tree-sitter Spring Boot + FastAPI extractors → model fragments
packages/llm        Claude client: prompts, structured output, caching, budgets,
                    metering; local-model adapter (OpenAI-compatible/Ollama) behind
                    the SAME interface; egress policy enforced at this boundary
packages/jobs       durable job records, cancellation, retries, idempotency keys
```

**Hosted flow:** browser → API route → (public content only) → Claude API. Private content is rejected by policy in hosted mode.
**Private flow:** whole app runs inside user boundary (docker compose / `pnpm start`); extractors + local model only; outbound network egress blocked by default and tested.

## 5. System model (schema draft)

```ts
type Provenance = 'user-specified' | 'source-supported' | 'inferred' | 'proposed';
interface Evidence { repo?: string; commit?: string; path?: string; lines?: [number, number]; note?: string }

interface Node { id: string; kind: 'actor'|'service'|'gateway'|'datastore'|'queue'|'external'|'entity'|'component';
  label: string; provenance: Provenance; evidence: Evidence[]; group?: string;
  fields?: { name: string; type?: string; key?: 'pk'|'fk'|'uk' }[] }        // ER entities
interface Edge { id: string; from: string; to: string;
  type: 'sync'|'async'|'data'|'relation'|'control'; label?: string;
  cardinality?: '1:1'|'1:N'|'N:M';                                              // ER
  provenance: Provenance; evidence: Evidence[] }

interface SequenceMeta { participants: string[];
  messages: { seq: number; from: string; to: string; label: string;
    kind: 'call'|'return'|'async'; fragment?: { type: 'alt'|'loop'|'opt'; covers: number[] } }[] }

interface View { id: string; type: 'architecture'|'sequence'|'er'|'component-detail';
  orientation?: 'TB'|'LR'; nodes: string[]; edges: string[]; sequence?: SequenceMeta;
  focus?: string }                                                              // component-detail root

interface SystemModel {
  schemaVersion: '1'; revision: number; parentId?: number;
  title: string;
  requirements: { id: string; text: string; status: 'stated'|'clarified'|'open' }[];
  openQuestions: { id: string; text: string; blockedBy?: string }[];
  nodes: Node[]; edges: Edge[]; views: View[];
  privacy: { classification: 'public'|'private'; boundary: 'external-allowed'|'local-only' };
  layout?: Record<string, { x: number; y: number }> }                          // manual layout survives model edits

type EditOp = { op: 'add'|'remove'|'update'|'move'; target: string; patch: object;
  baseRevision: number; summary: string }
```

Generation and refinement emit **this JSON only** — never HTML/SVG/Mermaid. Zod validation + referential-integrity checks gate every revision; invalid output keeps the last valid revision.

## 6. UI design (original, not copied)

**Layout:** compact app bar (logo, privacy chip, token-meter chip) → workspace grid: left control panel (~320px), center canvas (flex), right inspector rail (slide-over, opens on node select).

**Control panel:** mode segmented (Describe | Import repo) → view tabs (Architecture | Sequence | ER) + ↕/↔ toggle → textarea with view-adaptive placeholder + soft token-aware counter → 3–4 adaptive example chips (click fills input, never auto-generates; confirm before overwriting non-empty text) → Generate button. Repo mode swaps textarea for URL/scope/commit picker.

**Canvas:** pan/zoom/fit/minimap; click node → inspector (role explanation, provenance badge, evidence links pinned to commit, gaps). Provenance rendered as subtle border/badge colors, never opacity tricks.

**Refinement:** bar under canvas → patch-based edits → change-summary strip ("+Cache service, +edge orders→cache · undo").

**States (all explicit):** empty · clarifying (≤3 focused questions, skippable) · loading with real pipeline stage names (validate → model → validate output → layout — from actual events, no fake %) · success · partial (gaps listed) · error (actionable, prompt preserved) · cancelled (honest cost note) · stale-revision (rebase/reject).

**Design system:** dark navy base, blue→violet primary, teal accent for "verified/source-supported"; monospace for IDs/metrics; WCAG AA contrast; visible focus rings; reduced-motion honored; responsive down to tablet (panels collapse).

## 7. Edit pipeline (§brief 7, concrete)

target-resolution (selection or reference by id/label) → bounded `EditOp` against known revision → Zod + referential + cross-view consistency + requirement-preservation checks → summary/preview → commit new revision (append-only log, undo = revert op) → stale edits rejected with rebase prompt. Visual edits (layout) never touch semantics; semantic edits preserve manual layout positions for untouched nodes.

## 8. Privacy & deployment

Per brief §8 table. Enforced **in code, not prompt**: `packages/llm` router refuses external providers when `privacy.classification === 'private'`; local-mode builds ship egress allowlist (GitHub fetch + model-download only) with a test that attempts external inference and asserts failure. Processing-location chip always visible before submit.

## 9. Security controls (summary — threat model doc at M4)

Read-only least-privilege GitHub auth; URL validation + SSRF/internal-address blocking; tarball safety (path traversal, symlinks, size/file-count caps, binary/vendor skip); no repo-code execution ever; repo text = untrusted data (never instructions; no tool surface exposed to repo content); secret scan (gitleaks + secretlint pair, best-effort labeled; trufflehog excluded — AGPL) before any external submit; sanitized SVG/text rendering (no scripts, no remote refs); local server binds 127.0.0.1 by default; rate limits + job concurrency caps + timeouts + cancellation; retention: temp clones + model inputs deleted after job, revisions in SQLite until user deletes.

## 10. Token efficiency levers (concrete)

1. Stable prompt prefix (system + schema) with `cache_control`; verify via `usage.cache_read_input_tokens`.
2. Structured outputs (`output_config.format`) — compact JSON, no prose overhead.
3. `count_tokens` budget check before send; focused context selection (extractor output, not raw repo).
4. Patch edits (send affected subgraph + instruction, not whole model).
5. Effort tuning: Opus 5.5 defaults to `medium` — benchmark `low/medium/high` on the eval suite; model routing decided by measured tokens-per-**successful-task**, not per-request.
6. Batches API (50% off) for offline eval runs.
7. Facts reused across view switches from the stored model — zero model calls for pure view/layout/export.
Token meter chip displays tokens + $ per task (public build) — efficiency as visible product behavior.

## 11. Evaluation

Groups per brief §11 (plain-English→arch, sequence, ER, Spring, FastAPI, cross-view, edits, privacy/security). Baseline: naive prompt→diagram. Deterministic assertions (schema validity, referential integrity, evidence resolution, edit-diff isolation) + human readability review; LLM-as-judge only as secondary signal. **Proposed acceptance targets (numbers to review, not achievements):** first-pass schema validity ≥ 95%; render-after-repair ≥ 99%; fixture precision/recall ≥ 0.85/0.80; unsupported-claim rate ≤ 5%; median ≤ 6k input + 1.5k output tokens per plain-English task; private-mode external-call test: 0 passes. Results published incl. failures. **M1 calibration (measured, see `docs/probes/SYNTHESIS.md`):** fixture precision/recall ≥0.9/≥0.8 achieved (C); petclinic-scale precision ~1.0; render-after-repair 100% on golden+stress (A); local model gpt-oss:120b 100% schema-valid post-repair, warm TTFT 0.3 s, 42-node stress intact (D). Hosted first-pass validity + token/task await the live probe B run (pending API key).

## 12. Milestones @ ~10 h/week (ranges, not promises)

| # | Deliverable | Est. | Exit check |
|---|---|---|---|
| M0 | Monorepo scaffold, CI, docs skeleton | 1–2 wk | `pnpm test` green in CI |
| M1 | **Probes:** (a) model JSON→React Flow+ELK render/export, (b) Claude structured-output validity + tokens, (c) tree-sitter extraction on 2 fixture repos, (d) Ollama local model on M5 Max | 3–4 wk | each probe: go/no-go memo + numbers |
| M2 | Polished plain-English vertical slice (UI, examples, clarify, generate, refine, undo, export, all states) **+ §15 quotas/metering/stop-loss** | 5–7 wk | demo walkthrough + scenario checks 1–8, 13 + quota ladder smoke test |
| M3 | Public repo mode (fetch, pin, extract, evidence, gaps) | 4–6 wk | checks 4–6, 12 + matrix published |
| M4 | Private mode (local deploy, clone import, egress tests, local model; OAuth added) | 3–5 wk | checks 9–11, boundary test suite green |
| M5 | Eval suite expansion, hardening, docs, demo video, portfolio README | 3–4 wk | checks 1–14 + published results |

Total ≈ 19–28 weeks. Local-model risk defused by hardware; **biggest remaining risks:** sequence/ER rendering quality from custom nodes (probe a), extraction precision (probe c). M1 exists to kill these early.

## 13. Traceability (living — full table maintained in `docs/TRACEABILITY.md` from M2 onward)

R01→§12 ranges · R02→§6 · R03→§3A/6 · R04→§3/8 · R05→§6 · R06→§5 · R07→§5 · R08→§7 · R09→§8 · R10→§9 · R11→§10 · R12→§11 · R13→§12 · R14→§2/[OPEN] list.

## 14. Remaining [OPEN] decisions

- **Owner: Manan, before repo goes public:** trademark/domain clearance (§1).
- **Owner: Manan, when prompted at owning milestone:** anonymous-tier tuning after 2 weeks of live meter data (M2+); demo-day bypass if ever needed.
- Everything else from the original open list was settled in §1 (principal review, 2026-10-06).

## 15. Fair use, quotas & cost guardrails (hosted mode) — LOCKED 2026-10-06 (numbers tunable via config, review 2 weeks post-launch)

**Cost reality (drives every number):** with prompt caching, one plain-English generation ≈ **$0.01–0.03** on `claude-opus-5-5` (cached prefix reads at $0.20/MTok vs $4), repo analysis ≈ **$0.10–0.15**, refinement patch ≈ **$0.005–0.01**. A flat "1 diagram/day" would punish the recruiter demo (2–3 systems + refinements in 10 min) while doing nothing against scripted abuse — so: weighted credits + server-side breakers + identity tiers.

### Quota model — weighted credits, server-enforced
| Tier | Daily credit pool | Weights | Notes |
|---|---|---|---|
| Anonymous (session cookie + IP) | **6 credits/24h** | generation = 1 · repo analysis = 2 · refinement patch = 0.25 · view switch / layout / export / example click = **0** | Cookie session id minted at first visit; IP as secondary bucket key |
| GitHub signed-in | **30 credits/24h** | same | Identity = attribution = higher trust |
| Local/private mode | **no quotas** | — | User's own key/hardware; quota code compiled out |

Refinements are deliberately nearly-free: the core product loop (generate → refine → export) must not feel paywalled mid-flow.

### Circuit breakers (invisible when quiet, honest when tripped)
- **Per-request gate:** `count_tokens` before send — reject prompts whose assembled context > 25k tokens with a "simplify / scope down" message; `max_tokens` ≤ 8k; repair loops capped at 2; per-job wall-clock timeout.
- **Burst limit:** 5 model-calling requests / min / session, 20 / min / IP; duplicate-Generate clicks deduped via idempotency key.
- **Global stop-loss:** $15/day across all users → generation pauses with an honest maintenance message (never a silent failure). Typical healthy traffic: <$2/day.
- **Concurrency cap:** N parallel model calls; excess jobs queue with visible position.

### Abuse ladder (metadata-only logging — never content)
1. Normal → 2. anomalous pattern (script-like cadence, no UI events) → throttle + JS-challenge once → 3. confirmed abuse → block session+IP, 24h → 4. repeat → permanent. No CAPTCHA on the happy path — recruiters never see friction; challenges only at step 2. Bots that pass step 2 still hit credit + stop-loss ceilings.

### UX copy (clear, friendly, never punitive)
- Credits exhausted: *"You've used today's free generations — resets in 7h 23m. Sign in with GitHub for 30/day."* (live reset countdown, sign-in CTA)
- Stop-loss tripped: *"Generations are temporarily paused while we stay within today's budget — try again tomorrow."*
- Oversized prompt: *"That description is bigger than a single diagram can hold — try focusing on one system or flow."*
- Token-meter chip shows the user what their task actually cost in tokens — efficiency as a visible product behavior, not a hidden tax.

### Accounting = eval data (two birds)
Every model call logs `{session-tier, prompt-view, input/output/cached tokens, cost, retries, outcome}` to SQLite. This powers quota enforcement, the stop-loss, **and** the published §11 efficiency metrics + portfolio numbers. Same table, one implementation.

**Milestone placement:** enforcement + metering land in **M2** (the first live-traffic surface); ladder/challenges in M2 hardening; §11 scenario check 12 covers quota/rate-limit states.

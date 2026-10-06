# Milestone 0 — Monorepo Scaffold + System Model Core

> **For agentic workers:** Implement task-by-task; steps use checkbox (`- [ ]`) syntax. Detailed plans for M1–M5 are written at the start of each milestone (M1's depends on running ecosystem probes).

**Goal:** A green-CI TypeScript monorepo whose only real code is the versioned system-model schema + validator — the contract every later milestone writes against.

**Architecture:** pnpm workspaces: `apps/web` (Next.js, UI + `/api` routes), `packages/model` (Zod schema, referential checks, fixtures), `packages/{llm,extract,jobs}` as typed stubs so interfaces are visible early. One app runs hosted or local.

**Tech Stack:** Node 24, pnpm, TypeScript strict, Next.js (current stable), Zod v4, Vitest, GitHub Actions.

**Spec:** `docs/SPEC.md` (§5 schema, §1 decisions)

## Global Constraints

- TypeScript `strict: true` everywhere; no `any` in `packages/model` public API.
- Model JSON is the ONLY model-emitted format — no HTML/SVG/Mermaid types anywhere in `packages/model`.
- `schemaVersion` literal `'1'`; revisions are integers, append-only.
- Provenance union exactly: `user-specified | source-supported | inferred | proposed`.
- Deps added only when a task needs them (no speculative infra).

## Review Focus

1. Model JSON from the LLM may omit optional fields vs. emit `null` — validator must accept both for optional fields, reject wrong types.
2. Duplicate node/edge ids across views — referential check must catch, message must name the ids.
3. `sequence.messages.seq` gaps or duplicates (LLMs misnumber) — validator rejects, error names the offending seq.
4. Evidence pointing at a commit the model doesn't record — validation warns (not fails) in M0; pinned at M3.
5. A view referencing a node id that exists in another view only — must fail referential integrity.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json` (workspace root), `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `README.md`
- Create: `apps/web` (create-next-app, TS, ESLint, App Router)
- Create: `packages/model/package.json`, `packages/model/tsconfig.json`, `packages/llm/`, `packages/extract/`, `packages/jobs/` (each: `package.json`, `src/index.ts` exporting a typed `stub()` placeholder)

**Interfaces:**
- Produces: workspace layout; `@archwoven/model` importable by `apps/web` via `workspace:*`.

- [ ] **Step 1:** `git init`, add `.gitignore` (node_modules, .next, .env*, *.sqlite, .DS_Store)
- [ ] **Step 2:** Root `package.json` + `pnpm-workspace.yaml` (apps/*, packages/*); scripts: `dev`, `build`, `test` (`vitest run -r`), `typecheck` (`tsc -b`)
- [ ] **Step 3:** Scaffold `apps/web` with create-next-app (TS, App Router, ESLint); add dep `@archwoven/model: workspace:*`
- [ ] **Step 4:** Create `packages/{model,llm,extract,jobs}` with strict tsconfig extending base; stub `src/index.ts` in llm/extract/jobs: `export const stub = (): never => { throw new Error('M1+') }`
- [ ] **Step 5:** Verify: `pnpm install && pnpm typecheck && pnpm test` → typecheck clean, vitest "no test files" exit 0 (add `passWithNoTests: true` config now)
- [ ] **Step 6:** Commit `chore: monorepo scaffold`

### Task 2: System model schema (Zod)

**Files:**
- Create: `packages/model/src/schema.ts`
- Test: `packages/model/src/schema.test.ts`

**Interfaces:**
- Produces: `export const SystemModelSchema` (z.ZodType<SystemModel>), `export type SystemModel, Node, Edge, View, Provenance, EditOp, Evidence` — shapes exactly as SPEC §5.

- [ ] **Step 1: Write failing tests** in `schema.test.ts`:
  - `parses valid full model fixture` (import `fixtures/valid-full.json`)
  - `accepts omitted optional fields and explicit nulls`
  - `rejects unknown provenance` (e.g. `"guessed"` → error mentions `provenance`)
  - `rejects unknown node kind`
  - `rejects schemaVersion other than "1"`
- [ ] **Step 2:** Run `pnpm vitest run packages/model` → FAIL (module not found)
- [ ] **Step 3:** Implement `schema.ts` from SPEC §5 with Zod v4; `.strict()` on every object; optionals via `.nullish()`; ER `fields`/`cardinality` and `sequence` only meaningful per view type (validate shape, not usage, in M0)
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat(model): zod system model schema v1`

### Task 3: Referential integrity validator + fixtures

**Files:**
- Create: `packages/model/src/validate.ts`, `packages/model/src/fixtures/valid-full.json`, `packages/model/src/fixtures/invalid-*.json` (one per Review Focus line)
- Test: `packages/model/src/validate.test.ts`

**Interfaces:**
- Consumes: `SystemModelSchema` from Task 2.
- Produces: `export function validateModel(raw: unknown): { ok: true; model: SystemModel } | { ok: false; errors: string[] }` — Zod pass + graph checks: unique node/edge ids; every `edge.from/to` resolves; every `view.nodes/edges` subset of model; sequence participants ⊆ view.nodes; seq strictly increasing; `parentId === revision - 1` when present.

- [ ] **Step 1: Write failing tests** — one per Review Focus item (dup ids, dangling edge, cross-view-only ref, seq gap/dup, null-vs-omitted) + `valid-full.json` passes with `errors: []`. Fixture: an e-commerce architecture (actor, gateway, 2 services, Postgres, Redis marked `proposed`, Stripe `external`) + one sequence view + one ER view — this fixture is reused by M1 probes.
- [ ] **Step 2:** Run → FAIL
- [ ] **Step 3:** Implement `validate.ts` (~80 lines, pure functions, error strings name ids/seqs)
- [ ] **Step 4:** Run → PASS
- [ ] **Step 5:** Commit `feat(model): referential integrity validator + fixtures`

### Task 4: CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1:** Workflow: pnpm/setup-node@v4 (node 24) → `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test`
- [ ] **Step 2:** Push branch, verify Actions green → merge to main; commit `ci: typecheck + test on push`

---

**M0 done when:** CI green on main, `validateModel` rejects all invalid fixtures with named errors, and the valid fixture is rich enough to seed M1 probe (a).

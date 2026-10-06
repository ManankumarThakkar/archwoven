# Archwoven

**Turn ideas and code into clear architecture.**

AI-assisted architecture workspace: plain-English requirements or GitHub repositories (Spring Boot / FastAPI) become clear, interactive, editable architecture diagrams — generated from one typed system model with provenance, controlled edits, and an enforceable choice of where processing happens.

> Early-stage portfolio project. See `docs/SPEC.md` for the working specification and honest scope; nothing here is production-ready or enterprise-grade.

## Status

- **M0 (this branch):** monorepo scaffold + the versioned system-model schema and referential-integrity validator that every later milestone writes against.
- **M1:** technical probes (rendering, structured-output validity/cost, tree-sitter extraction, local model on Apple Silicon).
- **M2+:** plain-English vertical slice → public repo analysis → private/local mode → evaluations & hardening.

## Layout

```
apps/web            Next.js app (UI + /api routes; same code hosted & local)
packages/model      Zod system-model schema, validator, fixtures  ← the contract
packages/llm        Claude client + local-model adapter + egress policy (M1+)
packages/extract    tree-sitter Spring Boot / FastAPI extractors (M1+)
packages/jobs       durable job records, cancellation, idempotency (M1+)
docs/               SPEC.md + milestone plans + probe memos
```

## Development

```bash
corepack enable          # pnpm via packageManager field
pnpm install
pnpm test              # vitest
pnpm typecheck         # tsc across workspaces
pnpm dev               # Next.js dev server (localhost smoke page)
```

## Design principles (from the spec)

1. The model emits **typed JSON only** — never HTML/SVG/Mermaid. Rendering is deterministic code.
2. Every node/edge carries **provenance**: user-specified / source-supported / inferred / proposed.
3. **Privacy is enforced in the router, not the prompt** — private content never reaches an external provider, with tests that prove it.
4. Token efficiency is measured **per successful task** and shown to users.
5. Honest states: no fake progress bars, no fabricated components, no invented metrics.

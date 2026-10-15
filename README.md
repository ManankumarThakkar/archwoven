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

## Run Archwoven fully offline on your own machine (private mode, §8)

`ARCHWOVEN_MODE=local` compiles all quotas out, routes every inference call to a
local Ollama, stamps every saved model `private · local-only` server-side, and puts
every outbound fetch behind an allowlist guard — nothing leaves the machine.

```bash
docker compose up --build          # web on :3000 + ollama on :11434
# one manual step, first run only (~13 GB):
docker compose exec ollama ollama pull gpt-oss:20b
```

Or without Docker: `brew install ollama && ollama pull gpt-oss:20b`, then
`ARCHWOVEN_MODE=local pnpm build && ARCHWOVEN_MODE=local ARCHWOVEN_DEMO_ACK=1 pnpm start:local`.
`OLLAMA_MODEL` overrides the model (e.g. `gpt-oss:120b` on ≥64 GB machines).

The privacy promise is tested, not asserted: egress guard refuses hosted APIs before
DNS (§9), local jobs route to Ollama only, privacy is server-stamped from deploy
mode, exports carry no evidence paths, and the same suite runs green in both modes
(`ARCHWOVEN_MODE=local pnpm test`) — see `docs/M5-CHECKS.md` for the live transcript.

## Design principles (from the spec)

1. The model emits **typed JSON only** — never HTML/SVG/Mermaid. Rendering is deterministic code.
2. Every node/edge carries **provenance**: user-specified / source-supported / inferred / proposed.
3. **Privacy is enforced in the router, not the prompt** — private content never reaches an external provider, with tests that prove it.
4. Token efficiency is measured **per successful task** and shown to users.
5. Honest states: no fake progress bars, no fabricated components, no invented metrics.

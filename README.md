# Archwoven

**Turn ideas and code into clear architecture.**

AI-assisted architecture workspace: plain-English requirements or public GitHub repositories become clear, interactive, editable architecture diagrams — generated from one typed system model with provenance, controlled edits, and an enforceable choice of where processing happens.

> Early-stage portfolio project. See `docs/SPEC.md` for the working specification and honest scope; nothing here is production-ready or enterprise-grade.

## Status

- **M0:** monorepo scaffold + the versioned system-model schema and referential-integrity validator that every later milestone writes against.
- **M1:** technical probes (rendering, structured-output validity/cost, tree-sitter extraction, local model on Apple Silicon).
- **M2+:** plain-English vertical slice → public repo analysis → private/local mode → evaluations & hardening.
- **M6 merged (PR #9):** saved-diagram restoration, viewer fixes, responsive workspace, generation repairs, broader repository maps and benchmark safeguards. Fresh end-to-end results and unfinished first-release work: [post-merge audit](docs/POST-MERGE-AUDIT.md). Historical checks: [M6 checks](docs/M6-CHECKS.md).

## Layout

```
apps/web            Next.js app (UI + /api routes; same code hosted & local)
packages/model      Zod system-model schema, validator, fixtures  ← the contract
packages/llm        Claude client + local-model adapter + egress policy (M1+)
packages/extract    Spring Boot / FastAPI extractors + bounded source analysis
packages/jobs       durable job records, cancellation, idempotency (M1+)
docs/               SPEC.md + milestone plans + probe memos
```

## Development

Use **Node.js 24** (the job store uses `node:sqlite`) and **pnpm 12.9.1**, pinned in `package.json`. A new download has no installed dependencies, compiled internal packages, provider credentials or saved diagrams.

```bash
corepack enable          # pnpm via packageManager field
pnpm install --frozen-lockfile
pnpm build:packages    # required before tests/typechecks on a new checkout
pnpm test              # vitest
pnpm typecheck         # tsc across workspaces
pnpm dev               # Next.js dev server; open /workspace
```

If Corepack is unavailable, install the pinned pnpm version with `npm install --global pnpm@12.9.1`. Before generating, configure either your real API key or a running Ollama instance as described below. Without a provider, hosted mode shows setup guidance and rejects generation; it does not substitute sample diagrams.

## Workspace walkthrough

1. Choose **Describe a system**, select a diagram type, and write a description or choose an example. Examples fill the editor; generation starts only when you select **Generate diagram**.
2. Or choose **Import repository** for a public GitHub repository. Spring Boot and FastAPI retain framework-specific extraction; other and mixed repositories use bounded source sampling to map modules and static imports. Coverage limits and unknown runtime behavior are shown as gaps. An optional subdirectory narrows analysis; evidence is pinned to the selected commit.
3. Use **Find node /** or the outline to focus a component. Lenses filter component kinds. Select a connection to inspect its provenance and evidence, or choose route endpoints to follow a path.
4. Select a chapter for guided context. **Still** stops edge animation. Switch views, refine in words, undo a refinement, or export SVG/PNG.
5. Copy the address to return to the saved model and viewer context. A link works only in an authorized browser session; it does not grant another session access. Missing or inaccessible models show recovery guidance.

## Run with your real API key

Next loads `apps/web/.env.local`; keep your existing `ANTHROPIC_API_KEY` there. On a new checkout, create that gitignored file with `ANTHROPIC_API_KEY=your-real-key`. Do not commit it. Run from the repository root:

```bash
pnpm install --frozen-lockfile
ARCHWOVEN_MODE=hosted ARCHWOVEN_FAKE=0 pnpm dev
# open http://localhost:3000/workspace
curl -s http://localhost:3000/api/config
```

The config response must contain `"mode":"hosted"`, `"fake":false`, and `"llmReady":true`. A demo warning means fixed sample data is enabled; that mode deliberately repeats the same sample. Real generation consumes provider tokens and application credits. The workspace’s **Last task** summary shows reported token usage, repairs/retries and an estimated hosted API cost; open it for the breakdown. Ollama has no external API charge (hardware/electricity are not measured). Interrupted or missing usage is marked incomplete, and reports survive reload separately from diagram JSON. Restart an already running server after changing environment variables.

Compare two unrelated descriptions (for example a library and a greenhouse), then import your public repository. Inspect labels and connection evidence; refinement should modify only the requested parts, and undo should restore them. [Live verification](docs/LIVE-CHECKS.md) records the exercised cases and limitations.

```bash
pnpm test
ARCHWOVEN_MODE=local pnpm test
pnpm typecheck
pnpm build
```

The root `pnpm dev` command rebuilds internal packages before starting Next, so extraction uses current source rather than stale `dist` files. Development output defaults to `.next-dev`, production to `.next`, so a build does not overwrite a running development server. To test another instance, use a sibling output directory and separate port, for example `ARCHWOVEN_MODE=hosted ARCHWOVEN_FAKE=0 ARCHWOVEN_NEXT_DIST_DIR=.next-review pnpm dev --port 3001`.

If an import previously failed, submit it again after updating the app. Failed/cancelled jobs release their input key on retry; active and successful jobs still reuse the original attempt. Job history and saved diagrams remain intact.

A fixture walkthrough is available explicitly with `ARCHWOVEN_FAKE=1 pnpm dev`; it is labeled as a demo and does not establish real-provider behavior.

## Run Archwoven fully offline on your own machine (private mode, §8)

`ARCHWOVEN_MODE=local` compiles all quotas out, routes every inference call to a
local Ollama, stamps every saved model `private · local-only` server-side, and puts
every outbound fetch behind an allowlist guard — nothing leaves the machine.

```bash
docker compose up --build          # web on 127.0.0.1:3000 + ollama on 127.0.0.1:11434
# one manual step, first run only (~13 GB):
docker compose exec ollama ollama pull gpt-oss:20b
```

Or without Docker: `brew install ollama && ollama pull gpt-oss:20b`, then
`ARCHWOVEN_MODE=local pnpm build && ARCHWOVEN_MODE=local ARCHWOVEN_DEMO_ACK=1 pnpm start:local`.
`OLLAMA_MODEL` overrides the model (e.g. `gpt-oss:120b` on ≥64 GB machines).

To map a private repository, choose **Import repository → Local folder** and enter the full
path to a git clone (`/Users/you/code/project` or `~/code/project`). The path is read on the
machine running Archwoven; with Docker, mount your code read-only (see the commented
`~/code:/repos:ro` volume in `docker-compose.yml`) and enter `/repos/<project>`. Local mode only
answers requests addressed to `localhost`/`127.0.0.1` from the same origin, so other sites and
devices on your network cannot trigger or read imports.

Local folder imports require git on the server (included in the Docker image). Enter the
clone root and use **Subdirectory** to narrow the analysis. Imports read the checked-out
commit directly from git: staged, unstaged and untracked changes are excluded. Commit changes
you want included, then import again. Missing git objects are reported; imports do not fetch
them automatically or run checkout filters. Local citations show the captured path and commit
without linking a local folder to GitHub.

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

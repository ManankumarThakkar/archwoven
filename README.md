# Archwoven

**Turn ideas and code into clear architecture.**

Archwoven turns a plain-English description or a public GitHub repository into an interactive, editable architecture diagram. Every diagram comes from one typed system model. Each component and connection records where it came from, edits are validated, and you choose whether processing happens with a hosted model or entirely on your own machine.

Built by [Manan Thakkar](https://www.linkedin.com/in/mananthakkar20) · [GitHub](https://github.com/ManankumarThakkar)

## What it does

- **Describe a system** and get an architecture, sequence, entity-relationship or component diagram. Component details can be expanded in place.
- **Import a repository.**
  - Spring Boot and FastAPI projects get framework-aware extraction: controllers and routers, endpoints with full paths, dependency injection, JPA, SQLAlchemy and SQLModel entities, and datastores.
  - Other repositories get a bounded map of modules and imports.
  - Evidence is pinned to the analysed commit, and coverage limits are shown as gaps instead of being hidden.
- **Explore the diagram:** find a node, filter by component kind, follow a route between two nodes, step through guided chapters, and inspect where each connection came from.
- **Change it:** rename, arrange, refine in words, undo, and download SVG, PNG or JSON.
- **Run it privately:** local mode sends nothing off your machine, and that is enforced by tests rather than a prompt.

## How it works

```
description or repository
        │
        ▼
  extraction (tree-sitter, bounded sampling, secret masking)
        │
        ▼
  model call ──► typed JSON only ──► schema + graph validation ──► bounded repair
        │
        ▼
  one system model (nodes, edges, views, provenance, evidence)
        │
        ▼
  deterministic rendering (React Flow, SVG/PNG export)
```

- **The model never draws.** It returns typed JSON validated against a Zod schema with referential-integrity and semantic checks. Rendering is deterministic code.
- **Every node and edge carries provenance:** user-specified, source-supported, inferred or proposed. Source-supported claims must cite evidence from the extracted repository.
- **Privacy is enforced in the router, not the prompt.** In local mode an egress guard refuses hosted providers before DNS, every inference call goes to Ollama, and privacy is stamped on the server.
- **Cost is controlled per task.** Weighted credits, per-network limits, burst limits and a spending stop-loss apply in hosted mode. Every provider call is metered, repairs included.

## Measured results

Real numbers from the evaluation harnesses in `benchmarks/` and `apps/web/e2e/`, with their sample sizes. They are evidence, not guarantees.

| What | Result |
|---|---|
| Hosted descriptions valid on the first attempt | 7 of 7 cases across all four diagram types; median 14.2 s; about $0.04 each |
| Hosted repository imports valid on the first attempt | 5 of 6 runs across 4 pinned repositories; median 35 s; $0.10–0.32 each |
| Diagram accuracy against hand-checked ground truth | spring-petclinic: 19/19 nodes, 10/10 edges. FastAPI full-stack template: 10/12 nodes, 12/16 edges. 100 % precision on source-supported claims in both. |
| Endpoint extraction on two repositories never used during development | 19/19 each, after fixing the two defects their first run exposed |
| Accessibility (axe-core, WCAG 2.1 A/AA) | 0 violations in Chromium and WebKit, desktop and phone widths |
| Keyboard and downloads | Every control reachable by keyboard with a visible focus ring; SVG, PNG and JSON downloads verified as files in Chromium and WebKit |

Not yet verified: screen readers, physical touch devices, Firefox and the Safari application itself, and model inference inside the Docker deployment.

## Repository layout

```
apps/web            Next.js app: workspace UI and API routes, the same code hosted and local
packages/model      Zod system-model schema, validator and fixtures — the contract
packages/llm        Hosted Claude client, local Ollama adapter, egress and secret guards
packages/extract    Spring Boot / FastAPI extractors and bounded source analysis
packages/ingest     Repository download, safe unpacking, scoping and local-clone reads
packages/jobs       Job records, quotas, metering and retention
benchmarks          Evaluation harnesses, cases and recorded results
probes              Extraction fixtures and repository ground truth used by tests
```

## Getting started

Use **Node.js 24** (the job store uses `node:sqlite`) and **pnpm 12.9.1**, which is pinned in `package.json`.

```bash
corepack enable                 # pnpm via the packageManager field
pnpm install --frozen-lockfile
pnpm build
```

If Corepack is unavailable, install pnpm with `npm install --global pnpm@12.9.1`.

Start in one of three modes, then open http://127.0.0.1:3000/workspace:

```bash
# Hosted: Claude, using ANTHROPIC_API_KEY from apps/web/.env.local (gitignored)
ARCHWOVEN_MODE=hosted ARCHWOVEN_FAKE=0 pnpm dev

# Private: everything stays on this machine (needs Ollama, see below)
ARCHWOVEN_MODE=local pnpm dev

# Demo: canned diagrams, no key and no model, labelled as a demo
ARCHWOVEN_FAKE=1 pnpm dev
```

Without a configured provider, hosted mode shows setup guidance and refuses to generate; it never substitutes sample diagrams. `curl -s http://127.0.0.1:3000/api/config` reports the active mode, whether demo data is on, and whether a provider is ready. Restart the server after changing environment variables.

The workspace's **Last task** summary shows reported tokens, repairs and an estimated hosted cost. Ollama has no API charge.

`ARCHWOVEN_HOSTED_MODEL` selects the hosted model on the server: `claude-opus-5-5` (default), `claude-sonnet-5-5`, or `claude-haiku-5-5`. Restart after changing it. Requests and repairs keep the model selected when their task began; visitors cannot select a model through the API. Supporting a model does not establish its diagram quality; the measured results above remain Opus results until a comparison is completed.

Hosted estimates use the model's [standard Anthropic API rates](https://platform.claude.com/docs/en/about-claude/pricing), including 5-minute cache writes. Haiku's long-context tier is calculated per attempt, including cached input. Unknown prices or ambiguous legacy totals show “Cost unavailable”; interrupted tasks disclose incomplete usage. These estimates are not the planned reservation-based spending cap.

Production build check:

```bash
ARCHWOVEN_MODE=hosted ARCHWOVEN_FAKE=0 pnpm --filter web start --hostname 127.0.0.1 --port 3000
```

Development output goes to `.next-dev` and production output to `.next`, so a build never disturbs a running dev server. To run another instance, use a separate output directory and port, for example `ARCHWOVEN_NEXT_DIST_DIR=.next-review pnpm dev --port 3001`.

### Vercel preview diagnostics

The application currently uses SQLite and process-local job coordination; the hosted Redis backend and reservation ledger are not implemented yet. Do not expose the application APIs as a public service until those are ready.

To check serverless dependency packaging without a provider key:

```bash
pnpm build
pnpm hosting:preflight
```

The preflight copies only the diagnostic function's traced files to a temporary directory outside the checkout, then runs real Java/Python extraction and secret detection with outbound `fetch` rejected. This is a packaging check, not a network sandbox. It reports traced size before platform wrappers. CI runs the same check; this does not certify Vercel execution, job recovery or Redis behavior.

For a **Vercel Preview environment only**, use the `apps/web` root directory, Node.js 24, and build command `cd ../.. && pnpm build`. Set these server-side environment variables before deploying:

```text
ARCHWOVEN_MODE=hosted
ARCHWOVEN_FAKE=0
ARCHWOVEN_HOSTING_PROBE=1
ARCHWOVEN_HOSTING_PROBE_TOKEN=<a randomly generated secret of 32–256 printable characters, without spaces>
```

Generate the secret with a password manager. Do not use a `NEXT_PUBLIC_` variable or add a provider key. Diagnostic mode skips SQLite startup and blocks all application APIs with HTTP 503. Only `/api/hosting-probe` is available, with bearer authentication; it accepts no source input, returns only check results, and calls no provider. The server refuses diagnostic mode outside a Vercel preview. Leave these diagnostic variables unset in normal local deployments and Production.

Set the same token in your shell without putting it in command history, then run:

```bash
node scripts/hosting-preflight.mjs --url https://your-preview.vercel.app
```

If Deployment Protection is enabled, the runner also accepts `VERCEL_AUTOMATION_BYPASS_SECRET` from the shell. It sends secrets only in headers and refuses redirects. A passing preview probe confirms dependency execution only; paid generation stays unavailable in this mode.

## Private mode

`ARCHWOVEN_MODE=local` turns quotas off, routes every inference call to a local Ollama, marks every saved model `private · local-only`, and puts every outbound request behind an allowlist. Nothing leaves the machine.

With Docker:

```bash
docker compose up --build                          # web on 127.0.0.1:3000, Ollama on 127.0.0.1:11434
docker compose exec ollama ollama pull gpt-oss:20b # first run only, about 13 GB
```

Without Docker, start Ollama (`ollama serve`), then:

```bash
ollama pull gpt-oss:20b
ARCHWOVEN_MODE=local pnpm build
ARCHWOVEN_MODE=local ARCHWOVEN_DEMO_ACK=1 pnpm start:local
```

`OLLAMA_MODEL` selects another model, for example `gpt-oss:120b` on machines with 64 GB or more.

**Local folders.** To map a private repository, choose **Import repository → Local folder** and enter the path to a git clone (`~/code/project`). With Docker, mount your code read-only (see the commented `~/code:/repos:ro` volume in `docker-compose.yml`) and enter `/repos/<project>`.
- Imports read the checked-out commit directly from git. Uncommitted changes are excluded, so commit what you want included.
- Each git read trusts only the selected clone, and never enables hooks, filters or network transports.
- Local mode only answers same-origin requests addressed to `localhost`/`127.0.0.1`, so other sites and devices cannot trigger imports.

## Data retention

- **Hosted diagrams:** kept for 30 days after their last change, then removed by a sweep that runs at startup and every 24 hours.
- **Finished jobs:** removed after 30 days.
- **Content-free usage records:** kept for 90 days.
- **Delete diagram** removes a diagram and its history immediately.
- **Local diagrams** stay on your machine until you delete them.

## Testing and evaluation

```bash
pnpm test                          # full suite
ARCHWOVEN_MODE=local pnpm test     # same suite in private mode
pnpm typecheck
pnpm bench:selftest                # benchmark harness self-tests (run in CI)
node benchmarks/repair-rounds/harness.selftest.mjs
```

- **`benchmarks/ordinary-model-floor`** checks what an ordinary model must get right. A case passes only when three gates pass: required nodes and relationships (`check`), schema and graph validity (`verify`), and a named person's visual review (`record-visual`). `report` exits 0 for pass, 1 for a failure and 2 for incomplete.
- **`benchmarks/repair-rounds`** mutates valid models in eight ways and measures whether validation names the fault and whether a rules-only repairer can fix it. Its `verify` writes a fingerprinted receipt pinned to a clean commit.
- **`benchmarks/provider-eval`** drives a running server through 20 descriptions, 6 refinements and 4 pinned imports. It records validity, repairs, latency, cost and cache savings, and scores imports against ground truth: `node benchmarks/provider-eval/run.mjs <url> <server.db> <outDir> --budget <usd>`. It makes real, billed provider calls.
  The legacy runner accepts only real hosted Opus output and requires the server's evaluation reservation ledger. `--budget` is an additional task-stop threshold; the separate ledger's cap is authoritative. This runner is not for cross-model comparisons.
- **`apps/web/e2e/ground-truth.mjs`** scores extraction against the hand-checked ground truth in `probes/ground-truth/`.
- **`apps/web/e2e/browser-acceptance.mjs`** runs downloads, axe-core and keyboard checks in Chromium, WebKit and Firefox. Playwright is not a project dependency; point the script at a separate install.

For a paid evaluation, explicitly initialize a separate ledger with the amount you have approved, then keep that same file across server restarts and model changes:

```bash
pnpm eval:budget init /absolute/path/evaluation-budget.db <approved-usd>
ARCHWOVEN_MODE=hosted ARCHWOVEN_FAKE=0 ARCHWOVEN_EVAL_BUDGET_DB=/absolute/path/evaluation-budget.db pnpm dev
pnpm eval:budget status /absolute/path/evaluation-budget.db
```

The local evaluation guard reserves before every paid attempt, including repairs and retries. It uses integer accounting and a conservative bound: the full reviewed model context at the highest supported input rate plus the requested maximum output. For an 8,192-token output this holds about $5.16 for Opus, $2.58 for Sonnet or $0.65 for Haiku. Reported usage settles the hold; missing usage, transport failures and crashes retain it. Admission can stop below the cap when another worst-case hold cannot fit. There is no automatic expiry or refund for uncertain charges. Inspect the ledger before approving another run; initializing a different file starts a separate budget and does not carry prior charges.

This opt-in guard supports the existing text-only API requests, five-minute caches and reviewed models. It explicitly requests global routing, standard speed and standard service tier; unreviewed paid features fail closed. A provider workspace that restricts global routing may refuse the request. It is local evaluation tooling, unavailable on Vercel; public hosted money limits still require shared storage. Ordinary development is unchanged when the variable is unset.
- **`apps/web/e2e/responsive-workspace.mjs`** checks canvas space, inspector placement, overflow and selection across 390–1440 px using a recorded model, without provider calls. Run `node apps/web/e2e/responsive-workspace.mjs <url> <output-dir> <browser-tools-dir> [chromium,webkit]`; the tools directory needs Playwright and axe-core as above.
- **`apps/web/e2e/task-usage.mjs`** exercises metering → SQLite → quota API → browser → reload for model prices, cache tiers, incomplete reports and unknown prices. Start a disposable localhost server with `ARCHWOVEN_FAKE=0` and `ARCHWOVEN_DB` in a temporary directory, then run `node apps/web/e2e/task-usage.mjs <url> <temporary-server.db> <output-dir> <browser-tools-dir> [chromium,webkit]`. It seeds content-free usage fixtures through the real metering code and removes its own records afterward. It makes no inference calls and does not measure model quality.

The benchmark case and receipt format is adapted from the MIT-licensed archify benchmark; no archify code is included.

## Design principles

1. The model emits **typed JSON only**, never HTML, SVG or Mermaid.
2. Every node and edge carries **provenance**.
3. **Privacy is enforced in code, not in the prompt.**
4. **Token efficiency is measured per successful task** and shown to users.
5. **Honest states:** no fake progress, no fabricated components, no invented metrics.

## License

[MIT](LICENSE). Third-party dependencies retain their own licenses.

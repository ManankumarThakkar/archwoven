# Archwoven

**Turn ideas and code into clear architecture.**

[Open Archwoven](https://archwoven.dev) · [Deployment guide](docs/deployment.md) · [Testing guide](docs/testing.md)

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
- **Cost is controlled per task.** In hosted mode every provider attempt, repairs included, reserves its worst-case cost before it is sent, against caps per visitor, per network, per day, per month and per year.

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

## Run locally

Use **Node.js 24** and **pnpm 12.9.1** (pinned in `package.json`).

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

If Corepack is unavailable, install pnpm with `npm install --global pnpm@12.9.1`.

For hosted inference, put your `ANTHROPIC_API_KEY` in **`apps/web/.env.local`**, then start the app:

```bash
ARCHWOVEN_MODE=hosted ARCHWOVEN_FAKE=0 pnpm dev
```

Open [the workspace](http://127.0.0.1:3000/workspace). Without a provider key, generation explains the missing configuration; it never substitutes sample diagrams. Restart after changing environment variables. Shared jobs and spending caps require the Redis setup in the [deployment guide](docs/deployment.md).

For a labelled demonstration without inference, run `ARCHWOVEN_FAKE=1 pnpm dev`. This mode is separate from real-provider testing.

Development uses `.next-dev`; production builds use `.next`, so a build does not overwrite a running development server. After building, run `pnpm --filter web start --hostname 127.0.0.1 --port 3000` for the production server. Use a separate checkout and port for concurrent instances.

## Run privately

Local mode sends inference to Ollama and refuses other outbound destinations. It requires no hosted API key.

```bash
docker compose up --build
# In another terminal, download the model once:
docker compose exec ollama ollama pull gpt-oss:20b
```

Open http://127.0.0.1:3000/workspace. Without Docker, start Ollama and run:

```bash
ollama pull gpt-oss:20b
ARCHWOVEN_MODE=local pnpm dev
```

The local environment template is [`.env.local.example`](.env.local.example); copy it to `apps/web/.env.local` when configuring Ollama. For a local production build, use `ARCHWOVEN_MODE=local pnpm build`, then `ARCHWOVEN_MODE=local ARCHWOVEN_DEMO_ACK=1 pnpm start:local`.

Local-folder imports read the clone's **checked-out commit**; uncommitted changes are excluded. In Docker, mount clones read-only as shown in [docker-compose.yml](docker-compose.yml), then select **Import repository → Local folder**. Local mode accepts same-origin requests addressed to localhost only.

## Development

```bash
pnpm test
pnpm typecheck
pnpm bench:selftest
node benchmarks/repair-rounds/harness.selftest.mjs
```

The [testing guide](docs/testing.md) covers browser acceptance, extraction ground truth, recorded fixtures and paid provider evaluations. Fixture runs verify application behavior; they do not establish model quality. Paid evaluations require an explicitly initialized, separate budget.

```text
apps/web            Next.js UI and API routes
packages/model      System-model schema, validation and fixtures
packages/llm        Hosted and local model adapters, usage and egress guards
packages/extract    Framework extractors and bounded source analysis
packages/ingest     Repository fetching, safe unpacking and local-clone reads
packages/jobs       Shared jobs, spending ledgers, SQLite state and retention
benchmarks          Evaluation harnesses, cases and recorded results
probes              Repository fixtures and extraction ground truth
```

## Data and limits

Hosted server copies of diagrams expire 24 hours after their last change. The browser keeps up to 20 diagrams until they are deleted or site data is cleared. A downloaded JSON file can be reopened. Spending records have separate retention and remain after diagram deletion.

The [deployment guide](docs/deployment.md) explains spending caps, temporary storage capacity, retention and operator recovery. Schema validity does not prove architectural correctness; source coverage and inferred connections remain visible in the diagram.

## License

[MIT](LICENSE). Third-party dependencies retain their own licenses. The benchmark case and receipt format is adapted from the MIT-licensed archify benchmark; no archify code is included.

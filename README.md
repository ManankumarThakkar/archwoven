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

Hosted estimates use the model's [standard Anthropic API rates](https://platform.claude.com/docs/en/about-claude/pricing), including 5-minute cache writes. Haiku's long-context tier is calculated per attempt, including cached input. Unknown prices or ambiguous legacy totals show “Cost unavailable”; interrupted tasks disclose incomplete usage. These estimates report cost; the Redis reservation ledger enforces spending limits separately.

Production build check:

```bash
ARCHWOVEN_MODE=hosted ARCHWOVEN_FAKE=0 pnpm --filter web start --hostname 127.0.0.1 --port 3000
```

Development output goes to `.next-dev` and production output to `.next`, so a build never disturbs a running dev server. To run another instance, use a separate output directory and port, for example `ARCHWOVEN_NEXT_DIST_DIR=.next-review pnpm dev --port 3001`.

### Vercel preview diagnostics

The homepage is a server-rendered product page with a labelled recorded diagram, creator links and no generation calls. The workspace is at `/workspace`.

For search publication, set `ARCHWOVEN_SITE_URL` to the final HTTPS origin in the **Production** environment, then rebuild. Without a valid origin, the site stays `noindex`. Development, Preview, local/private mode and demo mode also stay `noindex`; the workspace is always `noindex`, and API responses carry an `X-Robots-Tag`. The sitemap contains only the public landing page. These search directives do not replace session ownership or deployment protection.

After deployment, verify the public URL in Google Search Console and Bing Webmaster Tools and submit `/sitemap.xml`. Optional `ARCHWOVEN_GOOGLE_SITE_VERIFICATION` and `ARCHWOVEN_BING_SITE_VERIFICATION` values emit the corresponding ownership meta tags. Keep Preview deployments protected. Edit `apps/web/public/og.svg` and run `node scripts/render-social-preview.mjs` to regenerate the static social image; this uses the bundled fonts and no external services.

The hosted Redis spending ledger and shared jobs are implemented for descriptions, refinement, component expansion and repository imports. Local/private mode keeps SQLite. On Vercel the application starts without SQLite: it opens no local database, runs no orphan or retention sweep, and logs which hosted storage variables are missing (names only) if job storage is not configured. Public launch still needs browser-held diagrams and editing/undo on Vercel, and acceptance against actual Vercel and Upstash deployments. Keep application APIs restricted until those checks are complete.

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

### Hosted spending limits

Hosted AI requests are charged against a spending ledger in Redis (Upstash REST). Before every paid attempt, including repairs and retries, the server measures the request with the provider's free token count and reserves its worst case: the counted context plus 10% and 512 tokens at the highest input rate, plus the maximum output. One atomic script admits the attempt only if `settled + held + this hold` stays within every cap:

- the annual window and the UTC calendar month;
- the visitor's UTC day, keyed by the server-issued session cookie;
- the network's UTC day, keyed by `x-vercel-forwarded-for` on Vercel (IPv6 per /64). On Vercel a request without that address is refused. Elsewhere it is the address the nearest proxy appended to `X-Forwarded-For`, and requests with no verifiable address have no network cap.

Reported usage settles the hold; missing usage, provider failures and crashes keep the whole hold. A charge above its hold pauses all paid requests for inspection. Attempt, month and annual records never expire; only per-day visitor and network totals expire after 35 days. Identities are stored only as keyed hashes. If Redis cannot be reached, paid requests are refused with an explanation, while viewing, editing and downloading keep working.

For development, add `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `ARCHWOVEN_REDIS_PREFIX` and `ARCHWOVEN_SESSION_SECRET` to **`apps/web/.env.local`**, alongside your existing `ANTHROPIC_API_KEY`. Use the HTTPS REST endpoint and a token with write access. The session secret must be a stable, cryptographically random value of at least 32 characters. Set `ARCHWOVEN_MODE=hosted` and `ARCHWOVEN_FAKE=0`, then restart the server. The root `.env.local` is not the web app's env file.

On Vercel, configure the same server-side variables in the project's environment settings. Do not use `NEXT_PUBLIC_` names, manually set `VERCEL`, or enable hosting diagnostics for ordinary application use. Keep development, Preview and Production Redis prefixes distinct (for example `archwoven-dev:`, `archwoven-preview:` and `archwoven:`), including when sharing a Redis database with another project. Changing the session secret invalidates existing visitor sessions and job ownership.

Environment variables alone do not initialize the spending ledger. From the repository root, check the configured namespace without making a provider call, then create the ledger once with your approved caps:

```bash
node --env-file=apps/web/.env.local scripts/spending-ledger.mjs status
```

For initialization and operator commands, `--env-file` can point to any private file containing the same Redis settings. Choose an annual start date that covers the intended usage; the ledger refuses requests before that date:

```bash
node --env-file=/path/to/private.env scripts/spending-ledger.mjs init --start <YYYY-MM-DD> --annual 84 --month 7 --visitor-day <usd> --network-day <usd>
node --env-file=/path/to/private.env scripts/spending-ledger.mjs status
node --env-file=/path/to/private.env scripts/spending-ledger.mjs pause "reason"   # stops paid requests on every instance; resume undoes it
node --env-file=/path/to/private.env scripts/spending-ledger.mjs unknown          # attempts whose usage was never reported
```

`init` never replaces an existing ledger, and `renew --start <date>` starts the next annual window only after the current one has ended. Unknown usage keeps its whole hold until the owner confirms the actual charge in the provider's usage console and runs `resolve <attempt-id> <usd> --evidence "<what the console showed>"` in an interactive terminal; the amount can never exceed the hold, and the evidence is kept on the attempt. A preview prefix has its own caps, so preview and production caps together must stay within the $84 annual allowance. On Vercel, a missing or invalid configuration refuses paid requests. A development server without these variables keeps its previous behaviour, and local mode is unchanged. `apps/web/e2e/spending-limits.mjs` checks the limit, pause and outage messages in a real browser against a disposable Redis, without inference.

### Hosted jobs

With the same Redis variables and `ARCHWOVEN_SESSION_SECRET` (at least 32 random characters) set, description generation, refinement, component expansion and public repository imports run as hosted jobs that any instance can serve:

- The request returns at once with a job id bound to the visitor's signed session cookie; other visitors get 404 for the job and its diagram. With the secret set, session cookies that the server did not sign are replaced.
- Repeating a request with the same description and diagram type returns the same job while it can still succeed; a retry after a failure, cancellation or expiry starts a new one. A visitor has one active job at a time, a network at most 2, and at most 8 jobs wait for a running slot.
- The invocation that accepted the job runs it after responding (`after()`): up to 60 seconds waiting for a slot, then up to 180 seconds of work, inside Vercel Hobby's 300-second limit. Closing the tab does not stop it; the browser remembers the running job and reconnects on reload or on the next visit.
- Exactly one instance can start a job, and nothing is retried. If the instance dies, the job reads as failed once its deadline passes, and the visitor can retry; an ambiguous paid request is never sent again automatically.
- Cancelling stops the job at its next check, and a result that arrives after the cancel is not saved. The provider attempt in flight keeps its spending hold, because its usage is unknown.
- A refinement or expansion works on the diagram the browser sends, which the server checks as untrusted input (size, schema and graph validity, and the stated revision). A refinement of an outdated revision is refused before any paid work, and the page is given the latest diagram. Its result is saved only over the revision it was based on: a change saved meanwhile (another refinement, or on a development server a direct edit in another tab) wins, the late result is refused with an explanation, the typed instruction is kept, and the page shows the latest saved version. On Vercel, direct edits, undo and share cards are not available yet; they say so instead of failing. Expansion starts from a component's detail view, which is opened by a direct edit, so on Vercel it also waits for browser-held diagrams. Another visitor's diagram id is refused before any paid work.
- A repository import shows its stage (fetching, designing, checking) while it runs. Likely secrets are masked before any code reaches the provider, and a failure of the secret scanner stops the job before any paid work. A repository that cannot be fetched fails without a paid request.
- Job status and questions expire 24 hours after the job was created. The server's diagram and last-task report expire 24 hours after their most recent write. Spending records are kept separately and do not expire.

Without these variables, jobs stay in the server's SQLite database as before, and local mode is unchanged. On Vercel, missing or invalid configuration refuses generation with an explanation. `apps/web/e2e/hosted-jobs.mjs` checks acceptance, reload and close/reopen recovery, two tabs, cancellation, refinement, expansion, a repository import, owner isolation and a killed server in Chromium and WebKit. `apps/web/e2e/vercel-runtime.mjs` starts the same production build as Vercel does (`VERCEL=1`, an unwritable database path) and checks the landing page, generation, reload, refinement, a repository import, owner isolation and that the server logs no errors, with an unwritable database path so any attempt to open it would be logged. Both run the production build against real Redis with `apps/web/e2e/fixture-provider.mjs`, a labelled test fixture that returns a recorded model instead of calling a provider and serves one fixture repository instead of GitHub, so they test the job lifecycle, not model quality or an actual Vercel deployment.

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

- **Redis-hosted jobs:** status and questions expire 24 hours after creation; diagram and last-task copies expire 24 hours after their most recent write.
- **Redis spending records:** attempts, annual and monthly totals do not expire. Visitor and network daily totals expire after 35 days.
- **Legacy SQLite in hosted/development mode:** diagrams and finished jobs are removed after 30 days; content-free usage records after 90 days. A development server using Redis also keeps SQLite copies for editing. Vercel deployments keep no SQLite data.
- **Delete diagram** removes the stored diagram immediately, and its SQLite history/jobs where present. Redis job status and task reports retain their separate expiry; spending records remain.
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
- **`benchmarks/provider-eval/staged`** compares the reviewed Opus, Sonnet and Haiku configurations on an 8-case screening set: every diagram type, a vague description that should ask for clarification, a refinement and two pinned imports. A screening set finds large differences cheaply; it is not statistical evidence.
  - `node benchmarks/provider-eval/staged/run.mjs plan --ledger <budget.db>` makes no requests. It shows each model's per-attempt hold and how much spend each model can still be admitted for; run models in the order it lists, largest hold first.
  - `run <url> --ledger <budget.db> --out <runDir>` drives one server, which serves one model, through the application's APIs and makes real, billed provider calls. It refuses servers in sample mode or reserving against a different ledger. Restart the server per model (`ARCHWOVEN_HOSTED_MODEL`) with the same ledger and output directory. It records the model, prompt version, request limits, the runner's commit, repository commits, attempts, reported usage, the ledger change per case and latency; start the server from the same checkout. A restarted runner resumes; a case lost mid-run is reported as interrupted and runs again only with `--retry-interrupted`.
  - `report <runDir>` writes `report.md` and `report.json`. They show accepted, rejected, failed, skipped, interrupted and budget-blocked cases, plus validity, semantic gates, ground truth, clarification and cost per accepted case, each kept separate. Outstanding holds are shown separately and are not counted as spend.
- **`apps/web/e2e/ground-truth.mjs`** scores extraction against the hand-checked ground truth in `probes/ground-truth/`.
- **`apps/web/e2e/browser-acceptance.mjs`** runs downloads, axe-core and keyboard checks in Chromium, WebKit and Firefox. Playwright is not a project dependency; point the script at a separate install.

For a paid evaluation, explicitly initialize a separate ledger with the amount you have approved, then keep that same file across server restarts and model changes:

```bash
pnpm eval:budget init /absolute/path/evaluation-budget.db <approved-usd>
ARCHWOVEN_MODE=hosted ARCHWOVEN_FAKE=0 ARCHWOVEN_EVAL_BUDGET_DB=/absolute/path/evaluation-budget.db pnpm dev
pnpm eval:budget status /absolute/path/evaluation-budget.db
pnpm eval:budget unknown /absolute/path/evaluation-budget.db
```

The local evaluation guard reserves before every paid attempt, including repairs and retries. It uses integer accounting and a conservative bound: the full reviewed model context at the highest supported input rate plus the requested maximum output. For an 8,192-token output this holds about $5.16 for Opus, $2.58 for Sonnet or $0.65 for Haiku. Reported usage settles the hold; missing usage, transport failures and crashes retain it. Admission can stop below the cap when another worst-case hold cannot fit. There is no automatic expiry or refund for uncertain charges. Each failed attempt's task report keeps the provider's status and message, so the cause survives later retries. `unknown` lists attempts whose usage was never reported. Once the provider's usage console confirms what one actually cost, `pnpm eval:budget resolve <budget.db> <attempt-id> <usd> --evidence "<what the console showed>"` settles that attempt at that amount, never more than its hold, and keeps the evidence in an audit table. It runs only in an interactive terminal after the owner types part of the attempt id. Attempts still in flight cannot be resolved, and a frozen ledger cannot be resolved at all, because its attempt may have cost more than its hold. Inspect the ledger before approving another run; initializing a different file starts a separate budget and does not carry prior charges.

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

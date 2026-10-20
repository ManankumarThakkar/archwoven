# Testing and evaluation

Run commands from the repository root with Node.js 24 and the pinned pnpm version. Build packages before tests on a fresh checkout:

```bash
pnpm build:packages
pnpm test
pnpm typecheck
pnpm bench:selftest
node benchmarks/repair-rounds/harness.selftest.mjs
```

Redis tests use disposable `redis-server` processes when available. CI provides Redis and sets `ARCHWOVEN_TEST_REDIS=127.0.0.1:6379`; test workers use separate databases. Never point this setting at a database containing real data. Hosted suites fail in CI if Redis is unavailable.

The local/private parity scope excludes hosted-only API and quota suites:

```bash
ARCHWOVEN_MODE=local pnpm vitest run packages apps/web/lib apps/web/app/lib
```

CI also audits production dependencies, checks the visual-review evidence hashes, builds the production app, runs the isolated serverless packaging preflight, and exercises Docker/Compose startup. `pnpm hosting:preflight` requires a production build and makes no provider call.

## Browser acceptance

Playwright and axe-core are intentionally outside production dependencies. Use a separate tools directory containing `playwright-core`, `axe-core` and the required browser binaries. Each script documents its arguments and required server configuration at the top of the file. Keep output in a temporary directory outside the checkout.

| Script in `apps/web/e2e/` | Coverage |
|---|---|
| [`landing.mjs`](../apps/web/e2e/landing.mjs) | Landing layout at 320–1440 px, film playback, pause/restart, looping, data saving, media failure, reduced motion, no-JavaScript access and accessibility |
| [`vercel-runtime.mjs`](../apps/web/e2e/vercel-runtime.mjs) | Production build with `VERCEL=1`, no writable SQLite, real Redis fixtures; jobs, browser persistence, editing/undo, stale tabs, expansion, recovery, imports, downloads, ownership and accessibility |
| [`storage-capacity.mjs`](../apps/web/e2e/storage-capacity.mjs) | Full storage refuses paid work, preserves inputs/current diagram/downloads, then admits work after capacity is freed |
| [`hosted-jobs.mjs`](../apps/web/e2e/hosted-jobs.mjs) | Job acceptance, reload and close/reopen recovery, cancellation, two tabs, imports and a killed server |
| [`spending-limits.mjs`](../apps/web/e2e/spending-limits.mjs) | Daily/visitor/network caps, operator pause and Redis outage messages |
| [`browser-acceptance.mjs`](../apps/web/e2e/browser-acceptance.mjs) | Keyboard navigation, axe accessibility checks and actual SVG/PNG/JSON downloads |
| [`ui-acceptance.mjs`](../apps/web/e2e/ui-acceptance.mjs) | Touch targets, refusal text, resized canvas and pasted links |
| [`responsive-workspace.mjs`](../apps/web/e2e/responsive-workspace.mjs) | Canvas space, inspector placement, overflow and selection across 390–1440 px |
| [`task-usage.mjs`](../apps/web/e2e/task-usage.mjs) | Metering → SQLite → quota API → browser → reload for prices, cache tiers and incomplete usage |
| [`ground-truth.mjs`](../apps/web/e2e/ground-truth.mjs) | Extraction against checked repository ground truth in `probes/ground-truth/` |

Hosted lifecycle and capacity tests run against disposable loopback servers with [`fixture-provider.mjs`](../apps/web/e2e/fixture-provider.mjs). It is explicitly labelled and returns recorded provider output and one fixture repository. Other UI suites document when they require labelled demo mode or seeded usage. These runs verify application behavior; they make no inference calls and do not establish model quality or actual Vercel acceptance.

Example after starting the isolated fixture server described in the script header:

```bash
node --env-file=/path/to/fixture.env apps/web/e2e/vercel-runtime.mjs http://127.0.0.1:3130 /tmp/archwoven-browser /path/to/browser-tools /tmp/archwoven-server.log chromium,webkit
node --env-file=/path/to/fixture.env apps/web/e2e/storage-capacity.mjs http://127.0.0.1:3130 /tmp/archwoven-capacity /path/to/browser-tools
```

Chromium and WebKit coverage does not establish behavior in the Safari application, physical touch devices or screen readers. Run those separately. Older recorded reports remain evidence for their original checkout and environment, not every later release.

## Benchmark harnesses

- [`ordinary-model-floor`](../benchmarks/ordinary-model-floor/) checks required nodes/relationships, schema/graph validity and recorded human visual review. Its `report` exits 0 for pass, 1 for failure and 2 for incomplete.
- [`repair-rounds`](../benchmarks/repair-rounds/) mutates valid models in eight ways. The rules-only repairer is checked against each fault; `verify` writes a fingerprinted receipt pinned to a clean commit.
- [`provider-eval`](../benchmarks/provider-eval/) records real hosted descriptions, refinements and pinned imports: validity, semantic gates, repairs, latency, cost, cache savings and ground truth.
- [`provider-eval/staged`](../benchmarks/provider-eval/staged/) compares reviewed Opus, Sonnet and Haiku configurations on eight screening cases. Screening finds large differences cheaply; it is not statistical evidence.

Cases, pinned repositories and recorded results are retained alongside their harnesses. Third-party attribution is collected in [NOTICE.md](../NOTICE.md).

## Paid evaluations

Only run paid evaluations with an explicitly approved allowance. Use a separate evaluation ledger; neither public-production caps nor a new empty file can stand in for that authorization.

```bash
pnpm eval:budget init /absolute/path/evaluation-budget.db <approved-usd>
ARCHWOVEN_MODE=hosted ARCHWOVEN_FAKE=0 ARCHWOVEN_EVAL_BUDGET_DB=/absolute/path/evaluation-budget.db pnpm dev
pnpm eval:budget status /absolute/path/evaluation-budget.db
pnpm eval:budget unknown /absolute/path/evaluation-budget.db
```

The local SQLite evaluation ledger is separate from the Redis public spending ledger. Keep the same file across server restarts and model changes. It reserves the reviewed model's maximum input/output cost before every attempt, including repairs and retries. Unknown usage keeps its hold; admission can stop below the cap when the next worst-case hold cannot fit. Creating another file starts an independent budget and does not carry prior usage.

The legacy runner requires real hosted Opus output and the server's evaluation ledger:

```bash
node benchmarks/provider-eval/run.mjs <url> <server.db> <outDir> --budget <usd>
```

Its `--budget` is an additional stop threshold; the reservation ledger is authoritative. For model comparison:

```bash
node benchmarks/provider-eval/staged/run.mjs plan --ledger <budget.db>
node benchmarks/provider-eval/staged/run.mjs run <url> --ledger <budget.db> --out <runDir>
node benchmarks/provider-eval/staged/run.mjs report <runDir>
```

`plan` makes no requests and lists per-attempt holds and execution order. `run` uses one server/model at a time; restart with `ARCHWOVEN_HOSTED_MODEL` for each model, retaining the ledger and output directory. It refuses sample-mode servers or mismatched ledgers. Run the server and runner from the same checkout. Interrupted cases are not retried without `--retry-interrupted`.

Reports keep accepted, rejected, failed, skipped, interrupted and budget-blocked cases separate. They record model/prompt versions, request limits, runner/repository commits, reported usage and latency. Held usage is separate from settled spend.

Resolve unknown usage only after confirming the actual charge in the provider console:

```bash
pnpm eval:budget resolve <budget.db> <attempt-id> <usd> --evidence "<what the console showed>"
```

Resolution requires interactive confirmation, retains evidence and cannot exceed the hold. In-flight attempts and frozen ledgers cannot be resolved this way. The guard supports the reviewed text-only API requests, standard routing/service tier and five-minute caches. Unsupported paid features fail closed. It is unavailable on Vercel; public hosted caps use the [Redis deployment ledger](deployment.md#initialize-spending-limits).

## Recorded results

These measurements describe the saved evaluation runs, not a guarantee for later inputs or deployments.

| Evaluation | Recorded result | Evidence |
|---|---|---|
| Hosted descriptions | 7/7 first-pass valid across four view types; median 14.2 s; $0.2726 total | [Run report](../benchmarks/provider-eval/results/2026-10-17-hosted-19b-evidence-and-fence/results.json) |
| Hosted imports | 5/6 first-pass valid across four pinned repositories; median 35 s; $0.10–0.32 each | [Import run](../benchmarks/provider-eval/results/2026-10-17-hosted-imports-after-19b/results.json), [follow-up](../benchmarks/provider-eval/results/2026-10-17-hosted-import-diagnosis/) |
| Hand-checked diagram accuracy | PetClinic 19/19 nodes, 10/10 edges; FastAPI template 10/12 nodes, 12/16 edges. Source-supported precision was 100% in these two cases. | [Ground truth](../probes/ground-truth/) |
| Endpoint extraction on two held-out repositories | 19/19 each after fixing the two defects found in the first run | [Ground truth](../probes/ground-truth/) |

Browser suites cover Chromium and WebKit, keyboard use, actual SVG/PNG/JSON downloads, and axe WCAG 2.1 A/AA checks. The landing film pass checked eight widths from 320 to 1440 px. Screen readers, physical devices, Firefox, the Safari application and model inference inside Docker need separate validation.

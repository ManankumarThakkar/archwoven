# Real-provider verification

Historical snapshot. Current merged-source verification, superseded blockers and remaining work: [post-merge audit](POST-MERGE-AUDIT.md).

Run date: 2026-10-15 (America/Chicago; server records cross midnight UTC). Branch `feat/m6-release-hardening`; the live checks below were recorded against the then-uncommitted working tree. This follows the earlier fixture-only [M6 snapshot](M6-CHECKS.md). The user explicitly approved live provider testing and the broader source-analysis fallback. No key values, browser cookies, or private repository content are included here. No commits or PRs were created during those live checks.

## Configuration and original symptom

The isolated production app ran on loopback port 3015 with `ARCHWOVEN_MODE=hosted`, `ARCHWOVEN_FAKE=0`, a separate database, and the existing key loaded by Next from `apps/web/.env.local`. `/api/config` returned `mode: hosted`, `fake: false`, `llmReady: true`. Models were fetched from the running app and passed `validateModel`; no seeded model or intercepted provider response supplied these live results.

Fixed sample mode deliberately returns the same diagram. The UI now states that explicitly when enabled. An old port-3000 development instance also had missing build chunks; it was left untouched. Development and production now use sibling `.next-dev`/`.next` directories to prevent build output collisions. Restart an existing server after environment changes; use the README real-key commands and inspect `/api/config`.

MCP Observatory was previously outside the Spring Boot/FastAPI-only detector. The approved fallback now analyzes bounded source modules and imports for unsupported/mixed repos while retaining specialized extraction. Its diagram is a static code map, not a claim that each file is a deployed service.

## Live cases

| Case | Result | Persisted model | Time / repairs |
|---|---|---|---|
| Library architecture | PASS | Public Library Lending System; 7 nodes / 6 edges; readers, librarians, catalog, lending, PostgreSQL, notification worker, email | 60s; 2 repairs |
| Greenhouse architecture | PASS | 10 nodes / 11 edges; sensors, MQTT, controller, valves, fans, time-series storage, dashboard | 50s; 1 repair |
| Library sequence | PASS model/API | 5 nodes / 4 edges, sequence view and ordered message data | 58s; 2 repairs |
| Library ER | PASS model/API | Book, Copy, Reader, Loan; 4 nodes / 3 edges; entity fields/keys and ER view | 50s; 2 repairs |
| Greenhouse component detail | PASS model/API | 10 nodes / 10 edges; adapter, evaluator, configuration, dispatcher, override, audit | 80s; 2 repairs |
| Solar architecture in Chrome | PASS browser | 7 nodes / 5 edges; panels, controller, battery, inverter, appliances, meter, display | Approximately 49s; 2 repairs |
| Solar refinement in Chrome | PASS browser | Monitoring Display renamed Energy Dashboard; one update; no other connections requested | 0 repairs; 1,993 input / 83 output tokens |
| Solar undo | PASS browser | Monitoring Display restored; Undo disabled at history floor | No model call |
| MCP Observatory, initial fallback | PASS browser | 10 modules / 13 imports; pinned source evidence; archive-directory noise exposed and then fixed | Approximately 76s; 1 repair |
| Express, initial fallback | PASS schema; weak coverage | 17 nodes / 1 import, mostly examples; motivated core-source priority and CommonJS export detection | 56s; 1 repair |
| Spring PetClinic specialized path | PASS model/API | 18 nodes / 7 edges; architecture + ER; controllers, repositories, entities; ambiguous datasource mapping disclosed | 76s; 1 repair |
| Express after sampling fix | PASS model/API | 12 nodes / 8 imports; includes `lib/express.js`, `application.js`, `request.js`, `response.js`, `utils.js`, `view.js`; no directory noise | 74s; 1 repair |
| MCP Observatory final fallback | PASS browser | 10 modules / 13 imports; five real coverage limitations; no directory noise | Approximately 75s; 1 repair |

Final MCP evidence: `ManankumarThakkar/mcp-observatory` at `d66599cceb3a151f64d45eb1cc46afe59c386c1f`, including `analyzer/cli.py:1–66`. Final Express commit: `a419aa7350389a275ab45fde2e849ed1f02449ef`. PetClinic commit: `500158f732419217507c7656904b8e6aa1bcc0d6`.

All eleven generation/assembly jobs succeeded after bounded repair; refinement succeeded on its first attempt. This run does **not** establish first-pass model validity. App call logs contain twelve task rows totaling an estimated $2.7697 using the app's configured accounting rates, not a verified provider invoice. Calls and repairs were metered. Normal credits remained enabled; the browser verification session ended with 0.75/6 credits. The separate temporary database does not alter an existing app database.

## Browser and export checks

Chrome used actual generated solar and MCP models. Description generation, refine, undo, node finder, outline focus, source inspector, route probe, chapter selection, Still mode, reload, and a fresh authorized tab were exercised. Saved solar focus/chapter survived reload; opening its model link in a fresh authorized tab mounted the canvas without generating again. Still mode had zero pulse/animated-edge elements.

At 390 × 844, generated and empty document widths both measured exactly 390px. Temporary viewport overrides were reset. No physical device or screen-reader claim is made.

The initial real PNG download exposed missing text: the rasterizer was given an empty font list. Workspace export now supplies the bundled regular/semibold Inter fonts, checks assets, and reports PNG success or an honestly named SVG fallback. The final downloaded MCP PNG was opened and visibly contained node and import labels. The SVG was XML-parsed and contained escaped labels including Energy Dashboard. The final browser check confirmed ten right-side source and ten left-side target handles for the LR MCP layout; the screenshot shows connections leaving/entering the appropriate node sides. TB and default direction have separate component regressions.

No application error/warning was captured in the final browser inspection. Two earlier browser errors originated from a `chrome-extension://` dynamic import. Production server logs contained startup output without application exceptions. This is not a full network trace or cross-browser audit.

## Boundaries

- Generic analysis: at most 20 sampled files, 2,400 characters per file, 24,000 source characters total, 160 inventory paths, 30 extracted edges. Input repository download/unpack caps remain enforced. Actual MCP sample: 12 files, 11 truncated, 164 omitted by sampling/exclusions. Inventory-only paths are not read evidence.
- Generic import resolution currently handles common Python, JavaScript/TypeScript, Go and Rust forms. Other allowed source languages still yield module maps and explicit unresolved relationships. Dynamic loading, aliases, runtime calls, deployment topology and persistence are not inferred as proven.
- Exclusions cover hidden/sensitive paths, binaries, generated/vendor/build files and test/fixture files. Source is not executed. Public GitHub-only hosted input and local-only private clone rules remain enforced.
- Shared hosted/local assembly checks reject source-supported identities, kinds, runtime edges and citations outside the observed sample. Local adapter tests passed; no live Ollama run was performed after these changes.
- This is a small live acceptance sample, not extraction precision/recall evaluation or a guarantee for every repository. Sequence/ER/component models were validated through the API; the detailed live browser pass focused on architecture views.
- Generation latency and dependence on repairs remain improvement work. The browser's existing 120-second running-job limit was not reached in these cases.
- Clean committed-source Suite B release evidence remains pending. The earlier receipt is historical and unchanged.

## Automated gates and artifacts

| Final command | Result |
|---|---|
| `pnpm test` | PASS — 45 files, 424 tests |
| `ARCHWOVEN_MODE=local pnpm test` | PASS — 409 tests, 15 expected hosted-only skips |
| `ARCHWOVEN_MODE=hosted ARCHWOVEN_FAKE=0 ARCHWOVEN_NEXT_DIST_DIR=.next-live-v4 pnpm build` | PASS — all package builds and production app |
| `pnpm typecheck` | PASS — all workspaces |
| `pnpm bench:selftest` | PASS — 18 checks |
| `node benchmarks/repair-rounds/harness.selftest.mjs` | PASS — 36 checks |
| `git diff --check` | PASS |
| Independent review of generic/local fixes | No remaining blockers; 54 focused tests passed |

Final production server uses `.next-live-v4` and remains available on loopback port 3015. Session-specific generated type includes were removed from tracked TypeScript configuration after builds; final typecheck passed.

One earlier concurrent extraction test run hit the existing gzip-bomb timing-ratio assertion; isolated and subsequent full hosted/local runs passed. No test assertion was weakened. In addition, new comment/template, local-evidence, directory-noise, PNG-font and direction regressions were observed failing before their fixes.

 Tests use deterministic doubles where appropriate; those regression checks are distinct from the real-provider cases above.

Temporary, uncommitted artifacts: `/tmp/archwoven-live-2026-10-15/` contains final model JSON, sanitized usage, job summaries, build/test logs, SVG/PNG exports, desktop/mobile screenshots, and the isolated database. The database is private local test state; do not publish it. These files are not a clean pinned release receipt.

Delivery is split into behavior-sized tasks in [the incremental PR plan](M6-PR-PLAN.md). The implementation is now prepared for delivery in focused commits on the existing branch.


## Follow-up: replayed legacy failure on port 3001

The user reported the old framework-only error at `http://localhost:3001/workspace#model=f22b662c-1a60-49f5-95f8-5be2c308a024`. That instance reported hosted mode, `fake: false`, `llmReady: true`, and used `.next-dev`. Read-only inspection found two old failed repository jobs with that exact error in the same owning session, dated 2026-10-15 11:16–11:17 UTC. The idempotency lookup returned these terminal failures before analysis, so the current fallback was never reached on a same-input retry. The stale port-3000 build was a separate finding; it was not the user's reported instance.

The store now excludes failed/cancelled jobs from reusable lookups, atomically releases their input key when creating a retry, and retains the old job record and error. Queued/running/successful attempts remain session-scoped and deduplicated. Six added regressions reproduced the old behavior before the fix, including the exact framework failure followed by a successful same-input retry, refunds, one successful charge and later success deduplication. Root `pnpm dev` now rebuilds internal dist packages before Next startup.

Follow-up gates: `pnpm test` — 430 passed; local-mode suite — 415 passed / 15 expected skips; `pnpm typecheck`, `pnpm build:packages`, and whitespace check passed. Independent review found no introduced blockers. Exact-instance real-provider check on port 3001: PASS in 77 seconds, MCP Observatory with 10 modules and 13 imports, persisted model validated. A second identical POST returned the same successful job without another generation. The live check used its own test session, without copying the user browser cookie; original failed-job replay was reproduced through route/store regressions. Artifacts: `/tmp/archwoven-retry-live/`, `/tmp/archwoven-retry-live.log`, and `/tmp/archwoven-retry-*.log`. The existing port-3001 server loaded the updated code; no user server was stopped.


## PR preparation gates

Fresh pre-push checks on the delivered implementation: hosted suite 430 passed; local suite 415 passed with 15 expected skips; all workspace typechecks passed; Suite A selftest 18 checks; Suite B selftest 36 checks. Production build uses sibling output `.next-pr-check`. These checks do not replace the live cases above or claim a new clean pinned Suite B receipt.

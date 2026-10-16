# Post-merge audit and remaining work

Audit date: 2026-10-15, America/Chicago (artifact timestamps cross midnight UTC). Source: merged PR #9, commit `d6f28bcd24eaa72fd3141759acdd66ee898d0cfb`. Both GitHub CI jobs (`verify`, `deploy-image`) passed. Audit branch: `chore/post-merge-e2e-audit`. Product code is unchanged by this audit; this follow-up publishes the report, status links and clean benchmark receipt.

**Verdict: the merged architecture and repository flows pass the exercised end-to-end checks, but the first-release specification is not complete. Sequence/ER rendering and several promised interactions remain unfinished.** Model/API validity must not be treated as browser rendering acceptance.

## Fresh verification

Built the merged source using `.next-postmerge`. Two isolated production instances used separate temporary databases: hosted on `127.0.0.1:3020`, local on `127.0.0.1:3021`. Existing user servers were not stopped. Both reported `fake: false`; the hosted instance used the existing configured key, the local instance used installed `gpt-oss:20b`. No canned models or intercepted provider responses supplied the live results.

| Boundary or flow | Result | Actual evidence |
|---|---|---|
| Automated hosted suite | PASS | 45 files, 430 tests |
| Automated local suite | PASS | 415 passed, 15 expected hosted-only skips |
| Production build / workspace typechecks | PASS | Fresh merged build and all workspace checks |
| Suite A/B selftests | PASS | 18 / 36 checks; these are deterministic harness checks |
| Hosted description → provider → saved model → browser | PASS | Bicycle Rental System, 6 components / 5 connections matching the requested domain |
| Hosted refine → persistence → browser | PASS | Rental API renamed Rental Service; undo restored Rental API |
| Browser PNG export | PASS download/fonts; PARTIAL readability | Text rasterizes, but the long database edge label is obscured by node boxes; center-to-center export lines also hide arrowheads under target boxes |
| Sequence model generation | PASS model; FAIL rendering acceptance | Stored model has 6 messages, including 2 returns; browser and SVG export show only 4 nodes / 3 ordinary graph links, without a timeline |
| ER model generation | PASS model; FAIL rendering acceptance | Book/Copy/Reader/Loan carry fields, keys and three `1:N` relationships; browser and SVG export show names/ordinary connection labels only |
| Public repository → source analysis → provider → browser | PASS bounded map | MCP Observatory, 10 modules / 13 static import links; evidence points to `d66599cceb3a151f64d45eb1cc46afe59c386c1f/analyzer/cli.py#L1` |
| Saved model and context | PASS | Fresh authorized tab restored MCP model, focus, route endpoints/active probe, chapter and Still mode; no new generation |
| Route / Still | PASS | Real repo route CLI → parser; zero pulse or animated-edge elements in Still mode |
| Responsive layout | PASS checked Chrome viewports | Generated repository and fresh empty workspace each measured document width = viewport width = 390px |
| Native local generation/refinement | PASS | Garden App → SQLite, 3 nodes / 2 edges; real refinement renamed Garden App to Garden Dashboard; private/local-only stamp preserved |
| Native local browser generation/reload | PASS | Visitor → Museum App → SQLite rendered, then restored after reload |
| Native local clone analysis | PASS API path, with UX/scope issues below | Actual merged clone, `packages/jobs/src`; 3 source modules / 3 imports; local/Archwoven evidence pinned to merged HEAD |
| Live negative gates | PASS | Hosted localPath and SSRF URL → 400; another session's model and refinement → 404; oversized prompt → 413; zero credits spent |
| Specialized extractor symlink boundary | FAIL helper safety probe | `walkFiles` follows a symlink to a benign temporary Python file outside the analysis directory; no sensitive file or model call involved |

The hosted audit produced seven generation/assembly tasks and one refinement. All generation/assembly tasks required bounded repairs; refinement succeeded without repair. Native local tasks in this small run succeeded without repairs. These are acceptance samples, not population-level reliability or precision measurements. App dollar accounting is an estimate; local token logging currently applies the same hosted-rate estimator and must not be presented as an actual local provider bill.

Browser inspection captured a failed `chrome-extension://` import and Grammarly extension warnings. No application-origin exception was observed in that inspection. This was not a complete network trace, screen-reader audit or cross-browser test. Physical touch, real cancellation/provider outage, job-duration tails and concurrent-edit race testing were not rerun live here; relevant deterministic tests remain distinct evidence.

## Benchmark outcomes

**Suite B:** a new receipt was generated from clean merged source and its report exits 0: 8/8 cases, first disclosure 6/8, rules-only repair actionability 4/8. It pins the merged commit and rebuilt validator hash. Receipt: `benchmarks/repair-rounds/results/2026-10-16-postmerge-d6f28bcd.json` (UTC filename). The old receipt remains unchanged and historical. This establishes deterministic validator round-trips, not LLM repair performance. The new receipt is included in this evidence-only follow-up; it pins the preceding implementation commit.

**Suite A:** all three documented prompts were sent through the real app. All three returned schema-valid models; the strict semantic gates passed 1/3. `checkout` passed; `todo-api` rejected **Orders Service** because its alias list includes **Order Service/Orders**, and `boring-crud` rejected **Catalog DB (PostgreSQL)** because its aliases include **PostgreSQL/DB**. The required typed nodes and connections are present on inspection, but the formal gates remain failed. Improve and regression-test the oracle deliberately; do not silently broaden it or rewrite these results as passes. All named-human visual reviews are still missing. Suite A report exits 1 and is ineligible. Receipts/models are under `/tmp/archwoven-postmerge/`.

## Remaining product and hardening tasks

These are concrete gaps against SPEC, rather than unchecked historical plan boxes. Priority reflects impact on the requested diagram experience; release controls also need an explicit scope decision if deferred.

| Priority | Task / next PR boundary | Evidence and acceptance gate |
|---|---|---|
| P1 | Constrain specialized extraction to the approved source inventory | `packages/extract/src/loader.ts:walkFiles` uses `statSync`; Java/Python extractors walk the original local directory after `ingestLocal` filters symlinks/caps. Fix parser traversal and prove outside paths, vendor files and over-cap files cannot be read. Hosted tar unpack still rejects links before writing. |
| P1 | Integrate sequence renderer into workspace and exports | `Canvas.tsx` and `export-svg.ts` use generic graph rendering for every view. Promote the existing `probes/render/sequence.ts` renderer; verify lifelines, ordering, returns and fragments with real data in browser/SVG/PNG. |
| P1 | Render ER fields, keys and cardinalities | Entity-aware sizing exists, but `Canvas.tsx` node labels and `export-svg.ts` omit field rows/relationship cardinality. Verify PK/FK labels and all field rows are visible and exported. |
| P1 | Clarification answer/skip flow | `states.ts` supports CLARIFY but workspace never dispatches it; the M2 notes explicitly defer the trigger. Wire at most three focused questions and preserve input through answer/skip/error. |
| P1 | Direct editing and persistent manual positions | No node-change/drag persistence or rename control; `layoutModel` ignores `model.layout` even though move patches can store it. Verify drag/rename, refinement, reload and exports preserve intended changes. |
| P2 | Architecture orientation control | Stored LR/TB changes layout and handles, but there is no user toggle. Keep orientation independent of semantic diagram type and persist it. |
| P1 | Preserve connection direction and label readability in exports | `buildSvg` draws center-to-center lines/markers and labels before node rectangles. Actual bicycle PNG obscures the database edge label; arrowheads terminate under target boxes. Route to node borders, handle long labels and test exported direction/readability. |
| P2 | Model JSON download | RefineBar/page expose only SVG/PNG despite SPEC first-release scope. Verify JSON download retains model semantics and follows the chosen privacy/evidence export policy. |
| P2 | Existing-model component drill-down | Selecting component-detail generates a new diagram; there is no bounded drill-down action from a component in an existing model. |
| P2 | Private clone input and accurate local-mode UI | API accepts localPath; browser has only a public GitHub URL form. Local UI still shows 6/6 credits and a 2-credit import cost despite quotas being disabled. Add local-path flow and correct copy. |
| P2 | Local subdirectory scoping and worktree evidence | `walkLocal` scans the entire clone before applying subdir; actual run disclosed many unrelated `.next*` cache gaps. Scope before walking, skip generated output and prevent unrelated files consuming caps. Decide how to disclose dirty worktrees or analyze committed contents so HEAD evidence stays truthful. |
| P2 | Task usage/cost metrics | Header shows credits, not actual task tokens/cost; call_log.view records generate/repo/refine rather than requested diagram type; local calls use hosted cost estimates. Fix metering identity and provider-aware estimates before exposing costs. |
| P2 | Finish extractor limitations and measure coverage | M1 ledger still lists custom FastAPI router binding, yield-based Depends, method-level RequestMapping/multiple paths and endpoint scoring limitations. Generic imports cover common Python/JS/TS/Go/Rust forms, with bounded sampling. Add supported cases or explicit gaps, plus representative human ground truth. |
| Release | Retention and user deletion | SPEC promises 30-day anonymous cleanup/nightly sweeping and deletion; no model expiry/deletion route or store operation exists. Implement or explicitly revise the release scope. |
| Release | Threat model and content secret scanning | Sensitive filename exclusions exist; the promised gitleaks/secretlint content gate and threat-model document do not. Confirm coverage and failure behavior before claiming that control. |
| Release | Abuse ladder or explicit scope revision | Credits, burst limits and stop-loss exist; anomaly challenges and temporary/permanent bans described in SPEC do not. Current exhausted-credit copy also advertises unavailable GitHub sign-in. |
| Evidence | Suite A oracle, case reviews and hosted efficiency evaluation | Repair alias false negatives with tests; preserve failed receipts; obtain named-human visual reviews. Measure first-pass validity, post-repair success, latency tails, cache savings and unsupported claims on a representative set. |
| Evidence | Broader acceptance | Physical touch, screen-reader, cross-browser/accessibility, real FastAPI assembled-model precision/recall and exhaustive extraction ground truth remain unverified. |

## Notes reconciled with implementation

- M0–M5 plans contain unchecked steps for code already delivered. They are historical plans, not a current task queue. Use the task table above.
- M6 implementation groups in M6-PR-PLAN are merged through PR #9. Pinned Suite B evidence is generated and included in this follow-up.
- Earlier 'awaiting API key', blank PNG text, development-job recovery and generic-repository unsupported messages are superseded as current blockers. Their historical transcripts remain intact.
- Earlier 'sequence/ER PASS' live entries were model/API checks. They did not establish complete rendering. This audit explicitly records that distinction and the observed gaps.
- Current local default is gpt-oss:20b, approved in the M5 ledger; the old 120b default/ratification notes are historical.
- OAuth/private GitHub hosting is intentionally excluded by the M6 plan; it is not an unfinished M6 implementation task. Private clones remain a local deployment feature.
- Name/domain/trademark clearance and post-launch quota tuning remain explicit owner tasks in SPEC; this audit does not claim them complete.

## Artifacts and reproducible checks

Temporary artifacts under `/tmp/archwoven-postmerge/` include build/test/typecheck/selftest logs, models, sanitized job/usage summaries, negative-gate results, actual SVG/PNG downloads and screenshots: `architecture.png`, `repository.png`, `sequence-missing-timeline.png`, `er-missing-fields.png`, `local-browser.png`, `mobile-repository.png`, `mobile-empty.png`, and `local-import-ui-gap.png`. Temporary databases contain session state and must not be published. Only the clean Suite B receipt and documentation are prepared in the repository.

Re-run core gates: `pnpm test`, `ARCHWOVEN_MODE=local pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm bench:selftest`, and `node benchmarks/repair-rounds/harness.selftest.mjs`. Check the new Suite B receipt with its report command; Suite A remains explicitly ineligible. Product source was unchanged during this audit; the follow-up publishes only documentation and the pinned receipt.

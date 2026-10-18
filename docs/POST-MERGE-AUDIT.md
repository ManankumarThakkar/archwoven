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
| Done | Constrain specialized extraction to the approved source inventory | Merged in PR #12 at `afdd9e5`; original failure and follow-up evidence remain below. |
| P1 | Integrate sequence renderer into workspace and exports | `Canvas.tsx` and `export-svg.ts` use generic graph rendering for every view. Promote the existing `probes/render/sequence.ts` renderer; verify lifelines, ordering, returns and fragments with real data in browser/SVG/PNG. |
| P1 | Render ER fields, keys and cardinalities | Entity-aware sizing exists, but `Canvas.tsx` node labels and `export-svg.ts` omit field rows/relationship cardinality. Verify PK/FK labels and all field rows are visible and exported. |
| P1 | Clarification answer/skip flow | `states.ts` supports CLARIFY but workspace never dispatches it; the M2 notes explicitly defer the trigger. Wire at most three focused questions and preserve input through answer/skip/error. |
| P1 | Direct editing and persistent manual positions | No node-change/drag persistence or rename control; `layoutModel` ignores `model.layout` even though move patches can store it. Verify drag/rename, refinement, reload and exports preserve intended changes. |
| P2 | Architecture orientation control | Stored LR/TB changes layout and handles, but there is no user toggle. Keep orientation independent of semantic diagram type and persist it. |
| P1 | Preserve connection direction and label readability in exports | `buildSvg` draws center-to-center lines/markers and labels before node rectangles. Actual bicycle PNG obscures the database edge label; arrowheads terminate under target boxes. Route to node borders, handle long labels and test exported direction/readability. |
| P1 (task 10b) | Refinement on models with semanticChecks | Found during task 10 live checks: "Add a Redis cache that Order Service reads from" failed from both the architecture and detail views with `update "semanticChecks": unknown target`. Adding a node without outgoing (or incoming) links violates allowedTerminals (allowedRoots), and EditOps cannot target semanticChecks, so bounded repair cannot converge. Both live hosted generations carried semanticChecks. Nothing is saved and the credit is refunded. Fix so ordinary refinements on checked models succeed, without letting the provider weaken the integrity checks. |
| P2 | Model JSON download | RefineBar/page expose only SVG/PNG despite SPEC first-release scope. Verify JSON download retains model semantics and follows the chosen privacy/evidence export policy. |
| P2 | Existing-model component drill-down | Selecting component-detail generates a new diagram; there is no bounded drill-down action from a component in an existing model. |
| P2 | Private clone input and accurate local-mode UI | API accepts localPath; browser has only a public GitHub URL form. Local UI still shows 6/6 credits and a 2-credit import cost despite quotas being disabled. Add local-path flow and correct copy. |
| P2 | Local subdirectory scoping and worktree evidence | `walkLocal` scans the entire clone before applying subdir; actual run disclosed many unrelated `.next*` cache gaps. Scope before walking, skip generated output and prevent unrelated files consuming caps. Decide how to disclose dirty worktrees or analyze committed contents so HEAD evidence stays truthful. |
| P2 | Task usage/cost metrics | Header shows credits, not actual task tokens/cost; call_log.view records generate/repo/refine rather than requested diagram type; local calls use hosted cost estimates. Fix metering identity and provider-aware estimates before exposing costs. |
| P2 | Finish extractor limitations and measure coverage | M1 ledger still lists custom FastAPI router binding, yield-based Depends, method-level RequestMapping/multiple paths and endpoint scoring limitations. Generic imports cover common Python/JS/TS/Go/Rust forms, with bounded sampling. Add supported cases or explicit gaps, plus representative human ground truth. |
| P1 | Make general-repository model assembly reliable without changing proven import semantics | A real native MCP Observatory run failed after two repairs because the model retyped all 13 static import connections as runtime bindings. Baseline and updated ingestion returned identical payloads. Preserve source-supported relation/imports bindings through assembly and repair, and rerun real-provider acceptance; retain the guard that rejects invented runtime calls. |
| P2 | Bound native generation duration and propagate cancellation | The failed MCP run exceeded the browser wait window; UI showed a generic timeout while the server later reported validation failure. Code inspection shows `assembleRepoModelLocal` accepts a signal but `ollamaChat` does not forward it to fetch. Add deadline/cancellation propagation and coherent recovery, with real cancellation verification. |
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

## Clean-download recheck after PR #10

Rechecked merged `main` at `c6dd0f162ed23f5e74e1431db4edfd900e3f2ba1` on 2026-10-15 (America/Chicago). A Git archive in `/tmp/archwoven-clean-download-20261015` reproduced a downloaded source tree without `.git`, existing build output, app dependencies, credentials or saved models. Installed the locked dependencies separately using Node.js 24.21.0 / pnpm 12.9.1. No API key was copied into the download; local live checks used the already installed Ollama `gpt-oss:20b` with `ARCHWOVEN_FAKE=0`.

The original README order (`install → test → typecheck`) failed: 15 test files failed to load/run, with 3 failed assertions, and typechecking could not resolve the unbuilt extract package. CI had hidden this ordering problem by building first. Building internal packages resolved the failures. The README now explicitly requires `pnpm build:packages` before tests/typechecks and states the runtime/provider prerequisites. Verification removed generated artifacts from the temporary download, then reran the corrected order before starting Next.

| Clean-download check | Result |
|---|---|
| Locked dependency install | PASS; separately installed dependencies, no copied `node_modules` |
| Corrected setup → hosted test suite | PASS; 45 files / 430 tests |
| Corrected setup → typecheck before first Next startup | PASS; all workspaces |
| Local test suite | PASS; 415 tests / 15 expected skips |
| Production build | PASS; standard root `pnpm build` |
| Default hosted startup without credentials | PASS setup behavior; config reports `fake: false`, `llmReady: false`; generation returns HTTP 503 with configuration instructions |
| Real native description → persistence → browser/reload | PASS; Temperature Sensor → Aquarium Monitor → SQLite, exactly 3 nodes / 2 edges, 0 repairs; private/local-only stamp |
| Public MCP Observatory → GitHub download → native assembly → browser/reload | PASS bounded map; 10 source modules / 13 static imports, 0 repairs; coverage/unknown-behavior gaps remain visible after reload. Warning presentation is PARTIAL: badge changes from 5 to 6 because overlapping job/model disclosures are combined differently on restoration; consolidate these summaries in a follow-up. |

Both new saved models passed `validateModel`. These real native calls used 2,141 input / 1,301 output tokens for the description and 11,375 input / 4,110 output tokens for repository assembly. Automated tests use controlled doubles; they are separate from these live-provider checks. Hosted real-provider results remain the preceding audit's evidence, not a fresh hosted call from this credential-free download.

Logs are `/tmp/archwoven-clean-*.log`; browser evidence is `/tmp/archwoven-clean-diagram.png` and `/tmp/archwoven-clean-repository.png`; sanitized model/job/usage summaries are `/tmp/archwoven-clean-results.json`. A fresh download requires dependencies and a configured provider; it does not include the current machine's key, Ollama installation/model or database. This setup correction does not resolve the remaining product tasks above. No tracked documentation or source files were deleted: the condition that the project be complete before cleanup has not been met.

## Extraction inventory follow-up

2026-10-16, America/Chicago. Implementation commit `a4b9adf` on `fix/extractor-source-inventory`, based on merged PR #11 (`048a9ad`). Framework parsers now consume a captured source-text inventory supplied by ingestion instead of rediscovering files. The same before-read path/name exclusions apply to generic and framework analysis; approved Spring application configuration remains supported with full relative evidence paths. Local capture enforces the combined byte budget, rejects links/non-regular/binary files, binds the opened descriptor to the checked file identity, rechecks canonical ancestry before reading, and bounds reads if a file grows. Once captured, text is reused for detection and parsing. Standalone fixture/probe extraction still accepts directories; its walker now skips symlinks.

Twenty new local safety/compatibility cases and two real-parser public-ingestion cases cover outside file/directory links, vendor/sensitive files, per-file/count/combined caps, binary files, replacement after capture, ancestor replacement during capture, empty inventories and Spring configuration. Thirteen initial regressions failed on the preceding implementation. Review reproduced an additional ancestor check/open race; its deterministic test failed with an Outside node, then passed after the descriptor-identity fix. Independent re-review found no remaining blockers within this scope.

Verification: 46 test files / 452 tests passed; local mode 437 passed / 15 expected skips; all workspace typechecks and a full production build passed. Changed product-source hashes match the isolated build/live snapshot under `/tmp/archwoven-source-safety-live`. No credentials were copied into that snapshot. A real local API import analyzed the unmodified public FastAPI full-stack template's `backend` directory, commit `b1125d8839482cb7bbae603ddc6d0081bf87532e`: FastAPI detected, 57 inventory files, 7 components, 5 connections and 23 extracted endpoints. Native Ollama `gpt-oss:20b`, fake disabled, produced a schema-valid saved model in 48 seconds with zero repairs (3,669 input / 4,545 output tokens), stamped private/local-only. This checks extraction/assembly/persistence, not exhaustive endpoint precision/recall or a local-path browser form.

An additional real public MCP Observatory browser run **failed**, unlike the preceding clean-download sample. After two repairs the source-evidence guard rejected all 13 rewritten import connections; no invalid model was saved. The browser had already shown its generic taking-longer-than-expected error. This outcome is not counted as a successful public-repository acceptance check. Comparing the preceding and updated ingest implementations against the same real GitHub responses produced identical results at `d66599cceb3a151f64d45eb1cc46afe59c386c1f`: 10 modules / 13 imports, fragment SHA-256 `6f46081891fcf6d778d25e4044fbb6186fbb8d43b54996b0304430a7c6481b0b`. The reproduction isolates a model assembly/repair reliability issue rather than an extraction-payload change. Keep this fix's PR in draft with that limitation disclosed; address assembly reliability and native deadlines/cancellation as separate follow-ups.

Logs and sanitized outputs are `/tmp/archwoven-source-safety-*`; do not publish the session database. Subdirectory scanning order, dirty-worktree evidence, full content secret scanning and the other product/release tasks above remain separate work. These checks do not establish protection against an attacker continuously mutating the host filesystem or replace an operating-system sandbox.

## General repository assembly follow-up

2026-10-16. `fix/repository-assembly-contract` makes the extracted generic graph authoritative. Providers return only a strict title/questions/guided-groups object; shared code constructs the architecture view from the exact extracted nodes/edges/evidence, preserves gaps and rejects unknown group IDs. Runtime connections, node kinds and evidence cannot be rewritten through this response. Specialized Spring/FastAPI generation remains on its existing full-model contract. Ollama runtime output limits now use the documented `options.num_predict`: 4,096 tokens for presentation and 16,000 for full models; hosted presentation has a 2,048-token cap. The earlier failed MCP sample remains failed historical evidence; the previously drafted extraction fix was subsequently merged as PR #12.

Verification: 470 tests passed; local mode 455 passed / 15 expected skips; all typechecks and a production build passed. Sixteen new presentation-contract assertions failed before implementation, then all 18 new cases passed. Independent review found an ignored Ollama cap placement; its request-contract regression failed before correction. Re-review found no scoped blockers.

| Actual real-provider case | Result |
|---|---|
| Hosted Python MCP Observatory | 10 modules / 13 imports; 11.8 s; 0 repairs |
| Hosted JavaScript p-limit | 6 modules / 3 imports; 6.9 s; 0 repairs |
| Hosted specialized Spring PetClinic (`src/main/java`) | 16 components / 7 connections; 44.1 s; 0 repairs |
| Native Go afero | 12 modules / 0 resolved imports; unresolved relationships disclosed; 20.1 s; 1 metadata repair |
| Native Rust fd | 12 modules / 7 imports; 8.4 s; 0 repairs |
| Native specialized FastAPI clone (`backend`) | 7 components / 5 connections; 31.1 s; 0 repairs |
| Native MCP browser → provider → saved model → reload | 10 modules / 13 imports restored; 0 repairs |

Both isolated instances reported fake disabled; native used real Ollama gpt-oss:20b and hosted used the existing configured key loaded only into process memory. Saved API results were schema-validated and generic edges checked as relation/imports. These are acceptance samples, not a statistical success-rate claim or exhaustive extraction accuracy measurement. The local repair usage table still reports only the last attempt, tracked under the separate accounting task. Initial versus restored warning summaries still need unification under the local/UI task. Logs, models, usage summaries and screenshot `/tmp/archwoven-completion-repo-restored.png` live under `/tmp/archwoven-completion-*`; databases/session state must not be published. The full completion queue is [RELEASE-PROGRESS.md](RELEASE-PROGRESS.md).


## Cancellation and execution-deadline follow-up

2026-10-16. Description and repository workers now share owner-checked cancellation and a configurable whole-job execution deadline (180 seconds by default, beginning after the concurrency slot). Polling publishes the deadline; the browser follows it plus a grace period instead of abandoning healthy jobs after two minutes. Native inference propagates cancellation through fetch and stream consumption, applies one overall budget across repairs, and retains completed-attempt usage. Hosted generation, token counting, repository assembly and refinement receive cancellation signals. Late results cannot overwrite cancelled/timed-out jobs; an aborted refinement preserves the prior revision. Cancellation transport failures are visible while polling continues.

An independent review reproduced a persistence error leaving jobs running because settlement was claimed before synchronous writes. Injected save/log failures first reproduced that behavior, then passed after settlement was moved after successful persistence. The first real browser cancellation still returned HTTP 409 and the job succeeded: Next route modules had distinct module-local registries. That is a failed acceptance attempt, not a cancellation success. Process-wide registry and concurrency-queue instances fixed it; module-reload regressions failed first and then passed. Re-review found no remaining scoped blockers.

A simultaneous build/test run tripped the existing gzip timing-ratio test (54 ms guard versus 172 ms full inflate); no decompression code changed. Rerunning the full suite without the competing build passed. The timing-dependent oracle remains an evaluation-hardening task. Final verification: 492 hosted tests passed; local 477 passed / 15 expected skips; all workspace typechecks and production build passed. Real Ollama gpt-oss:20b, fake disabled: Chrome cancelled the active weather-description job, kept the input, and an exact-input retry saved the requested 3-node / 2-edge diagram, which restored after reload. A separate owner API cancellation released the registry in 31 ms and saved no revision. A separate temporary server using a 1-second job budget failed a genuine native request with actionable timeout copy, released its registry and saved no revision; restarting that verification server with the normal budget and retrying the same input/idempotency key saved a valid private/local-only 3-node / 2-edge model. The temporary timeout server was stopped; user servers were untouched.

Sanitized receipts: `/tmp/archwoven-cancellation-live-result.json`, `/tmp/archwoven-deadline-live-result.json`; browser evidence: `/tmp/archwoven-cancellation-browser.png`, `/tmp/archwoven-cancellation-retry.png`; verification logs: `/tmp/archwoven-cancellation-*`. Do not publish session databases. Provider-cost presentation, local credit copy and warning-summary consistency remain their separate queued tasks. These checks verify the single-process supported deployment; they do not provide distributed job coordination.


## Sequence workspace and export follow-up

2026-10-16. Sequence views now use a shared pure SVG timeline in the workspace and SVG/PNG export, with lifelines, numbered ordered messages, distinct call/return/async arrowheads, self-call loops, multiline text and deduplicated fragment bands. Nested same-start fragment tabs have separate positions and reserved label rows. Participant provenance styles match the graph viewer; keyboard-accessible participant controls open the existing inspector, and an ordered message transcript provides a text alternative. Zoom/fit and a keyboard-scrollable viewport support wide diagrams. Legacy sequence views missing metadata show an actionable error instead of a fabricated node graph. New generation opens the requested view and preserves it in the reload URL; returning to architecture reconciles invisible selections.

Independent review found disappearing open arrowheads in the installed PNG rasterizer (`context-stroke` unsupported), overlapping nested fragment labels and stale sequence-only selection on graph remount. Each received a failing regression then a passing fix. Actual rasterizer tests compare exported async/return heads against their removed versions. The first hosted library run produced six messages but omitted the requested opt fragment after one repair, even claiming the format did not support it; this is a partial semantic result, not proof of complete fragment generation. Hosted string-encoded sequence metadata lacked its complete nested prompt schema. The prompt now includes SequenceMetaSchema and explicit fragment placement guidance, without changing the wire format.

Final checks: 505 hosted tests passed; local 490 passed / 15 expected skips; all workspace typechecks and a production build passed. Reviewer independently ran 54 focused cases, rechecked fixes and found no outstanding scoped blockers. Product source bytes match the isolated build/live snapshot. Real hosted parcel-locker generation returned four participants, six ordered messages, one self-call, call/return/async kinds and opt covering messages 2–4 after two repairs. Chrome inspection, transcript, selection styling and reload restored the view/focus. Actual browser SVG/PNG downloads contain all six messages and opt; visual inspection confirmed both return and async arrowheads. PNG is 2,816 × 1,264 with bundled text. Real native Ollama gpt-oss:20b returned a separate sensor sequence with three participants, six messages, one self-call and a loop covering validation/save in 42.7 seconds. Both live instances had fake disabled; model JSONs passed validation. These samples do not claim provider semantic reliability for every prompt or manual screen-reader acceptance.

Artifacts: `/tmp/archwoven-sequence-hosted-opt-model.json`, `/tmp/archwoven-sequence-native-model.json`, `/tmp/archwoven-sequence-native-result.json`, actual downloads copied to `/tmp/archwoven-sequence-hosted.svg` and `.png`, and `/tmp/archwoven-sequence-hosted-browser.png`. Logs use `/tmp/archwoven-sequence-*`. No session database or credential is included in the PR. ER rendering, graph export readability and remaining release tasks are still queued in RELEASE-PROGRESS.md.


## Main integration correction

A live GitHub/git refresh after the three PRs were merged found that only PR #13 had reached main (`b2ef029`). PR #14 was merged into its parent feature branch, then PR #15 into the cancellation branch; their product changes were still absent from main. Corrective PR #16 explicitly targets main with `5581e74`, whose source tree is byte-identical to reviewed sequence commit `a5fdc9f`. A new isolated archive with a locked offline dependency install passed internal-package builds, 505 hosted tests, 490 local tests / 15 expected skips, all typechecks and the complete production build. PR #16 was still open when this entry was written. Subsequent PRs target main; dependent work can remain draft until its preceding integration lands. A merged PR badge alone is not evidence that its changes are present on main.

## ER fields, keys and cardinalities follow-up

ER entities now show full field names/types and PK/FK/UK badges through a custom React Flow node. Shared wrapping/geometry drives workspace, ELK sizing and standalone SVG/PNG; original metadata also remains in titles/ARIA labels. Empty fields and missing legacy cardinality are stated explicitly. Relationships show one/many endpoint markers and cardinality labels; the inspector includes fields/cardinality. Hosted string-encoded field values now receive their complete nested schema. Entity provenance uses an inner outline so outer focus/route/chapter rings remain visible.

Review found wide-glyph overflow and an inline provenance shadow suppressing focus highlights. Both regressions failed before fixes and then passed. Font containment is also measured with the actual bundled Inter fonts via resvg; the old 42-W header measured 568.27px against a 332px limit. Independent endpoint raster tests isolate one relationship and remove start/end markers separately for each 1:1, 1:N and N:M case. Actual browser PNG inspection found the old ER gap clipping a caption; an ER-only 180px layer gap passes the corresponding actual-font overlap regression and the checked download. This is a measured-case fix, not a universal long-label/complex-routing guarantee. Self-relations in graph exports remain an explicit task 5 dependency.

Live native ER attempt one saved a valid-schema two-entity model but omitted requested N:M; it is a failed semantic acceptance result. New ER generation now requires each relation's cardinality or an openQuestions entry blockedBy its id, using the existing bounded repair flow. The next native repair failed duplicate edge ids and saved no revision; this failure is retained. Native ER grammar now requires an explicit cardinality property while permitting null for unknowns, and prompts clarify one N:M relation rather than mirrored duplicates. The final real native sample preserved two entities/four fields/N:M in 14.5 seconds, zero repairs. Existing saved-model validation and architecture/sequence grammars remain unchanged.

Final checks: 521 hosted tests passed; local 506 passed / 15 expected skips; all typechecks and production build passed. Thirteen changed product-file bytes match the isolated build/live snapshot. Independent re-review cleared the scoped fixes and statically checked the new generation gate/grammar. Real hosted library generation preserved three entities, nine fields, PK/FK/UK and 1:1/1:N after one repair. Chrome inspector/reload restored the saved ER view and selected entity; computed focus shadow is visible and not overridden. Actual SVG/PNG downloads preserve those fields and relationship markers; the final PNG is 1,960 × 964 and was visually inspected. All live providers had fake output disabled. Physical screen-reader acceptance and broader provider quality remain later release checks.

Artifacts: `/tmp/archwoven-er-hosted-model.json`, `/tmp/archwoven-er-native-model.json`, `/tmp/archwoven-er-native-result.json`, retained partial native model `/tmp/archwoven-er-native-partial-model.json`, browser `/tmp/archwoven-er-hosted-browser.png`, actual downloads `/tmp/archwoven-er-hosted.svg` and `.png`, and `/tmp/archwoven-er-*` logs. No credentials or session database are published. General routing, self-relations and more efficient label wrapping are next; remaining release scope stays in RELEASE-PROGRESS.md.


## Shared graph routing and export readability follow-up

2026-10-16. PR #16 and #17 are now merged into main (`193d4b4`); cancellation, sequence and ER product changes are present there. Task5 retains canonical orthogonal ELK sections and caption boxes, including self-relations, parallel connections and reverse edges. Fixed LR/TB ports match the workspace handles. Custom system nodes share measured text wrapping/geometry with SVG exports; entity fields keep ordinary names/types on one line when they fit. A generated ASCII advance table is pinned to both bundled Inter asset hashes, with a conservative Unicode fallback. Pure escaped SVG keeps concrete provenance-colored markers and caption backgrounds; the actual PNG rasterizer is tested for self-loop geometry and endpoints in architecture and ER.

Independent read-only review found two Important clipping issues: node-only camera fitting excluded loop captions, and long boundary titles could extend beyond the SVG viewport. Regressions reproduced both (including an actual font title right edge of 397.56px against a 240px viewport), then passed after shared complete-scene bounds, wrapped boundary headings and scene-aware initial/manual fitting. Chapter focus retains intentional node-subset fitting. Live inspection also found that the existing pulse CSS replaced the connection with sparse dashes. A failing renderer regression preceded a separate decorative token overlay; the base stays visible, async base dashes remain distinct, and Still/reduced-motion rules hide tokens. Existing focus/lens/probe/chapter behavior passes regression coverage. The review's Minor tooltip issue remains explicit: the live edge title joins wrapped lines and can insert spaces into long identifiers; source model, inspector and export title retain originals. Track tooltip fidelity in task 20 accessibility acceptance.

Final checks: 534 hosted tests passed; local 519 passed / 15 expected skips; all workspace typechecks and a full isolated production build passed. Thirteen changed product-source files match the built/live snapshot. The 39-node fixture checks routed segments against node interiors and caption containment; this is bounded regression evidence, not a guarantee for every graph. React component review checked hooks, selection, motion and escaped markup. Physical accessibility and cross-browser acceptance remain task 20.

Both live servers explicitly report fake=false. Real hosted generation saved `5a558155-f166-4ebe-a4fe-9e8629df1d1e` with exactly two components and four requested connections: parallel submit/cancel, reverse publish and asynchronous self-retry. Chrome reload, computed base/token styles and Still-mode behavior passed. Actual browser SVG/PNG downloads contain four routed paths and four caption boxes; the 1,372 × 506 PNG was visually checked. Real native Ollama gpt-oss:20b saved `270ad56a-57f2-433d-98ee-3f07dca7cf54` with one Folder entity, three fields, PK/FK and a 1:N self-relation. Its requested relationship label was omitted and provenance was inferred despite explicit input; this is a provider semantic limitation, not full prompt acceptance. The returned graph is shown honestly. Browser reload and manual Fit View at 768px width contained its loop/caption; actual 996 × 536 PNG and SVG preserved the self-relation. The existing real hosted ER download was rechecked with readable fields/captions (2,560 × 928), and saved parcel sequence still renders four participants, six messages, one self-call and opt on the separate timeline.

Artifacts: `/tmp/archwoven-routing-{hosted,native}-model.json`, provider configuration receipt `/tmp/archwoven-routing-provider-config.json`, browser screenshots `/tmp/archwoven-routing-hosted-browser.png`, `/tmp/archwoven-routing-native-tablet.png`, actual downloads `/tmp/archwoven-routing-{hosted,native,er}.{svg,png}` and `/tmp/archwoven-routing-*` verification logs. No session database, cookies or credentials are published. Temporary viewport override was reset. Task 6 direct edits/manual-position persistence is next; other scope remains in RELEASE-PROGRESS.md.


## Direct rename, drag and manual-position persistence follow-up

2026-10-16. Task 6 adds owner-checked, revision-checked direct edits for names and node positions, using existing append-only revisions and no inference/credits. Inspector name forms support keyboard submission. Graph dragging and React Flow keyboard nudges save the visible positions atomically; failed saves restore the accepted layout, and stale tabs adopt the latest model without overwriting it. All active-view positions are saved so untouched nodes remain stable. Schema v1 retains its existing global node-id layout map; sequence participant names can change, while lifeline arrangement remains timeline-controlled. Renames preserve identity, provenance, evidence, fields and requirements. The corrected accepted-snapshot history supports successive undo, which is itself a forward revision. Undo now requires baseRevision; older clients receive an actionable reload error. Refinement rechecks the current revision after awaiting the provider, so a late patch cannot overwrite a newer direct edit; incurred provider usage is recorded and the unsuccessful refinement credit refunded.

Direct requests are bounded to 64 KiB, 500 finite node positions within ±100000 and trimmed names of 1–500 characters. The core rejects the unsupported __proto__ layout key, which Zod would otherwise discard silently; other prototype-shadowing ids use own-key lookups. Shared manual layout preserves exact signed coordinates and routes self/parallel/reverse connections for workspace and exports. Coincident touching handles retain a visible detour. Overlapping placements, ignored legacy positions and simplified routing are disclosed; SVG includes layout warnings in its description. PNG allocation is limited to 64 million pixels at the requested scale, with SVG fallback, and rasterizer resources are freed.

The first independent review paused at a usage limit, then resumed and completed. It found local-only Backspace deletion and expensive routing on every pointer movement. Busy/nonbusy deletion regressions failed first; only selection/dimension events are now accepted as cosmetic, with implicit deletion/connection creation/reconnection disabled. Actual Chrome Backspace kept the node and revision. The reviewer reproduced 2.4 seconds of synchronous routing for an irregular 80-node/160-edge fixture. Pointer preview is now inexpensive; full routing has a shared 2 million box/segment-operation budget across the scene, plus an 80-node search cap. Exhausted/large views keep all connections with explicit simplified-path warnings. The irregular fixture took 11.8 ms in the recorded local Vitest run after the fix; this is host-specific fixture evidence, not a device performance guarantee. The existing 39-node fixture still routes without warnings. The camera-reset finding was treated as material to successive fine adjustments: saved moves now preserve the viewport, and explicit Fit View remains available. All three review regressions failed before fixes and passed afterward; no second review was substituted for verification.

Final local verification: 566 hosted tests passed; local 551 passed / 15 expected skips; all typechecks and the isolated production build passed. Benchmark selftests passed 18 and 36 checks. One concurrent build/selftest attempt failed the missing-required-label case; the isolated case and complete repair selftest rerun passed. The original failure log is retained. Concurrent mutable package output is a possible cause, not an established root cause; no validator/harness expectation was weakened. Seventeen changed product-source files match the built/live snapshot. Broader evaluator hardening remains task 19.

Real hosted model 5a558155-f166-4ebe-a4fe-9e8629df1d1e: rename to Job Orchestrator, drag, two-step undo (position then name), stale rename and stale drag in a second owner tab, reload with exact saved coordinates, and actual SVG/PNG downloads passed. Revision 7 keeps all four original connections and the untouched Request Gateway position. Provider calls remained 4 and credits used remained 4 throughout visual edits. Real native model 270ad56a-57f2-433d-98ee-3f07dca7cf54: manual ER movement, genuine Ollama gpt-oss:20b refinement renaming only the entity to Archive folders, reload, keyboard nudges, Backspace protection and export passed. Exact model comparison after refinement preserved layout, fields, self-cardinality and provenance; the one deliberate refinement added exactly one provider call. Subsequent keyboard movement added none. Computed viewport transforms were identical before/after a saved nudge. Final native revision 5 keeps its 1:N self-relation and three fields. Its pre-existing omitted relation label/inferred provenance remain the task 5 semantic limitation. Physical-device, screen-reader and cross-browser acceptance remain task 20; the library's live keyboard announcement appears to report the pre-nudge position and should be checked there.

Artifacts: `/tmp/archwoven-edit-{hosted,native}-model.json`, visual-only accounting receipt `/tmp/archwoven-edit-visual-receipt.json`, exact native-refinement receipt `/tmp/archwoven-edit-native-refine-receipt.json`, browser screenshots `/tmp/archwoven-edit-{hosted,native}-browser.png`, actual downloads `/tmp/archwoven-edit-{hosted,native}.{svg,png}` (1,525 × 492 and 944 × 632 PNGs), routing timing receipt `/tmp/archwoven-edit-routing-timings.json`, and `/tmp/archwoven-edit-*` logs. The original benchmark failure is `/tmp/archwoven-edit-repair-selftest.log`; isolated rerun evidence is the separate `-rerun.log`. No databases, credentials or cookies are published. Task 7 clarification answer/skip is next.


## Clarification answer and skip follow-up

2026-10-16, America/Chicago (verification receipts use UTC 2026-10-17). PR #19 is confirmed merged into main at `dcbae81`. Task 7 adds a bounded description decision to the initial generation call: either a valid model or one to three distinct, focused questions, each limited to 500 characters. Clear descriptions do not pay for an extra preflight. Hosted and native adapters validate the question shape within the existing repair/deadline budget. Repository assembly keeps its existing contract. The native grammar gives the question alternative precedence, with explicit instructions that the system-model rules apply only to compatible requirements. Continuations disable questions, preventing an answer/skip loop.

Question-only jobs settle as `clarifying`, release their concurrency slot, record billed usage and refund the reserved generation credit. Original prompt, view and questions are stored in a nullable SQLite job column added in place; saved diagrams are not migrated or deleted. Only the job owner can read questions or continue. Answers are bounded to 1,000 characters per question; continuation uses the stored original description/view, validates the answer count, and derives a stable server idempotency key from the reply. Skipping supplies no invented answer. Explicit answers are retained as clarified requirements, and unanswered questions are retained in the saved model even if omitted by the provider. A successful continuation spends one generation credit; failed/cancelled attempts follow existing refund rules. Provider-aware pricing and broader accounting remain task 14. The new stored context is subject to the existing storage lifecycle; expiration/deletion remains task 16, not an implemented claim here.

The workspace form supports answer, skip and return to the original editable description, with associated labels, visible keyboard focus and a 44-pixel action target. The draft and answers survive continuation errors, cancellation and a failed fetch of the completed model. A synchronous request lock prevents double submission. Regression checks exposed and fixed a duplicate-insert reservation leak and premature answer dismissal on model-fetch error. Independent read-only review found two Important UI issues: an empty job gaps array hid skipped questions until reload, and continuation dropped the requested sequence/ER view when multiple views existed. Both reproduced in failing tests and then passed after merging model/job gaps and retaining the original preferred view. No second review was used in place of regression verification. React review covered effect dependencies, form focus/labels, bounded state and escaped text; physical assistive-technology and cross-browser acceptance remain task 20.

Final checks: 589 hosted tests passed; local 574 passed / 15 expected hosted-only skips; all typechecks and a full isolated production build passed. Benchmark selftests passed 18 and 36 checks. Fifteen changed product-source files are byte-identical to the built/live verification checkout. No dependencies or lockfiles changed. Tests include owner isolation, malformed replies, one-round enforcement, partial answers, skipped gaps, stable retry keys, late clarification after cancellation, failed saved-model loading and requested-view restoration.

Actual hosted provider, fake=false: the contradictory permanent-storage/no-storage description returned two focused questions (`eae5ad20-8c0f-434f-934a-d322a4b3301b`). Supplying explicit storage precedence and scope saved `57415e68-4259-4ccd-b50e-859185571187`, with Client, Order Service, PostgreSQL and two connections; the hosted continuation required two bounded repairs. Exact question/answer records are persisted as clarified requirements. The question-only reservation was returned and the successful diagram used one credit for the UTC day. Chrome answer submission, original draft preservation and saved-diagram reload passed.

Native Ollama gpt-oss:20b, fake=false: the first contradiction attempt **failed semantic acceptance** despite valid JSON, drawing a database with no questions (`7deb4865-ddcb-4cad-962c-d0cfd6e21fde`). Its model is preserved. After adjusting native decision precedence, the same description with one trailing newline to avoid the old completed idempotency key returned the priority question (`8ab27696-74e4-41b9-9228-ba6671247af4`). Chrome Edit description preserved the original draft; resubmitting reconnected to the same question job. Skip saved `fa1ea960-30ee-4b41-85e4-d054b84037dd`, showing the unresolved question immediately and after reload. Its storage design is marked proposed, rather than claiming the user resolved the conflict. Local-only privacy and zero local credits were confirmed. These are bounded acceptance samples, not a guarantee that every provider detects every contradiction; representative semantic evaluation remains task 19.

A separate fully specified two-node weather description generated directly without questions on both actual providers: hosted `cfc40fc0-00bd-4d0d-b0fc-3143b1bb76eb` in 5.98 seconds, native `c41e3dca-0a73-4a6a-9214-abb5639cb6d6` in 10.41 seconds. Both contain exactly Weather Client, Weather API and Read forecast. Hosted and native server configuration reported fake=false.

Artifacts: `/tmp/archwoven-clarify-{hosted,native}-model.json`, `-clear-model.json`, `-clear-receipt.json`, combined `/tmp/archwoven-clarify-live-receipts.json`, preserved `/tmp/archwoven-clarify-native-failed-model.json`, browser question/result screenshots `/tmp/archwoven-clarify-{hosted,native}-{questions,result}.png`, source receipt `/tmp/archwoven-clarify-source-hashes.json` and `/tmp/archwoven-clarify-*` verification logs. No database, credentials or cookies are published. Cleanup remains task 20. Task 8 architecture orientation is next.


## Saved architecture orientation follow-up

2026-10-17, America/Chicago. PR #20 is confirmed merged into main at `c334fc8`. Task 8 adds horizontal/vertical controls for existing architecture views, independent of semantic diagram type. The owner-checked direct-edit endpoint uses baseRevision and appends a validated revision, without inference, usage records or credits. Missing/null orientation is effectively vertical; selecting the existing effective direction is a no-op. Sequence, ER and component-detail views reject this action. The control is keyboard-operable, reports its pressed direction, has a 44-pixel minimum height and locks during a mutation. An unsuccessful save retains the accepted direction; a stale response adopts the latest model.

Changing direction explicitly auto-arranges the architecture by removing manual position keys for its member nodes. Nonmember positions, all semantic data, other view definitions and evidence remain intact. Schema v1 uses a global node-id position map, so pins for a shared node also affect other graph views; the control discloses that consequence when such pins exist. Undo restores the exact previous orientation and manual coordinates. General semantic refinement operations and the model schema are unchanged. The existing shared renderer supplies direction-aware handles, routing and exports, and the scene is fitted after the accepted revision.

Verification: 606 hosted tests passed; local 591 passed / 15 expected hosted-only skips; all typechecks and the full isolated production build passed. Benchmark selftests passed 18 and 36 checks. Eight new cases initially failed for the missing core/API/control behavior; all focused cases then passed. Added scene checks assert directed node order in both saved layouts and SVG after clearing far-off manual positions. Coverage includes no-op defaults, invalid/non-architecture actions, owner/stale checks, nonmember pin preservation, exact undo, failed-save recovery, reload, shared-pin disclosure and hidden controls on sequence/ER. Independent read-only review found no scoped Critical/Important/Minor issues. React review checked explicit view identity, mutation locking, controlled pressed state, label/focus semantics and wrapped helper text. Six product-source files match the built/live checkout; no dependencies or lockfiles changed.

Chrome used existing diagrams generated by actual providers, with both verification servers reporting fake=false. Hosted `5a558155-f166-4ebe-a4fe-9e8629df1d1e`: LR manual revision 7 changed to TB revision 8; a second stale owner tab was rejected without a write; Undo revision 9 exactly restored the original model content and manual positions. Subsequent TB revision 10 and keyboard-triggered LR revision 11 reflowed, auto-fitted and restored after reload, retaining two nodes and all four parallel/reverse/self connections. Actual SVG/PNG downloads in both directions contain four routed paths and four captions. PNGs are 848 × 800 vertical and 1,372 × 506 horizontal and were visually inspected. Native browser-owned `fa1ea960-30ee-4b41-85e4-d054b84037dd` changed LR revision 1 to TB revision 2 and restored its three nodes, two edges, privacy and existing unresolved question after reload. Provider-call totals stayed hosted 6/native 10; aggregate credit use stayed hosted 5/native 0 throughout the visual checks. The separate API-only weather model correctly remained inaccessible to the browser owner; no cookies were transferred.

Final acceptance still includes physical-device, screen-reader and cross-browser checks in task 20. Same-tab navigation that changes only the model hash was observed to require a page reload; include that existing navigation behavior in task 20. Cleanup remains deferred. Artifacts: `/tmp/archwoven-orientation-{hosted,native}-{before,model}.json`, exact `-hosted-undo-model.json`, before/after usage receipts, `-export-receipt.json`, `-source-hashes.json`, actual `-{vertical,horizontal}.{svg,png}`, browser screenshots and `/tmp/archwoven-orientation-*` logs. No database, credentials or cookies are published. Task 9 privacy-aware model JSON download is next.

## Model JSON download follow-up

2026-10-17, America/Chicago. PR #21 is confirmed merged into main at `0f8fd4c`. Task 9 adds model JSON export beside SVG/PNG. **JSON** downloads the exact saved model (all views, manual layout, orientation, revision, requirements, open questions, provenance and evidence) as schema-valid text accepted unchanged by `SystemModelSchema` and `validateModel`. Export is client-side: no request, inference, usage record or credit. File names are `archwoven-<title-slug>-r<revision>.json`; non-Latin or empty titles fall back to `model`.

Evidence policy: a second **JSON (no evidence)** download empties every node/edge evidence list and changes nothing else. It is offered only when some evidence carries a source reference (repo, commit, path or lines); note-only evidence in described models is already share-safe, so no duplicate control appears. Private or local-only models show a visible notice before download naming the repository labels in the full file. The notice also states that names and IDs may still mention files: generic repository maps derive node IDs and labels from paths, and coverage gaps can name files, so the evidence-free file is not claimed to be path-free. A local-only boundary is treated as private even when classification says public.

All downloads now share `downloadBlob`, which revokes the object URL 40 seconds after the click instead of synchronously; synchronous revocation has cancelled WebKit downloads (WebKit bug 185531). A model with zero views, which the schema permits, can still export JSON; SVG/PNG continue to require a view. Unit and page regressions failed before implementation, and three deliberate mutations (edges keeping evidence, line ranges not counted as references, untrimmed slugs) were each caught.

Final checks: 637 hosted tests passed; local 622 passed / 15 expected hosted-only skips; all workspace typechecks and an isolated production build passed. Benchmark selftests passed 18 and 36 checks. Real headless Chrome drove both servers through the DevTools protocol with actual downloads written to disk; both servers reported fake=false. Hosted generation `ecad0b18-5f6f-4f4b-a371-fccd0bc69451` (Pet Clinic Booking System, 7 nodes / 6 edges, note-only evidence) showed only the JSON control and no notice; the downloaded file deep-equalled the API model and validated; no network request occurred during export; SVG and PNG still downloaded through the shared helper (15/15 checks). Native Ollama gpt-oss:20b imported a fresh clone at `0f8fd4c`, `packages/jobs/src`, saving `2f84ce26-42d8-425a-8838-603dea62e1f8` (3 modules / 3 imports, 6 source-referenced evidence records, private/local-only). The notice named `local/clone`; the full file deep-equalled the API model; the evidence-free file contained zero evidence records, no commit SHA, repository label or reference keys, and was otherwise identical and valid (23/23 checks). All three node labels in that map are file names, confirming the disclosed limitation. At 390 px both runs had document width equal to viewport width and all export controls inside the bar.

The export controls keep the existing 34-pixel button height, below the 44-pixel target used by newer controls; include them in task 20 touch-target acceptance. Headless Chrome is not a substitute for Safari/Firefox download checks, which also remain task 20. A fresh headless profile downloaded a Chrome component package into the capture directory during the native run; it was unrelated to the application and deleted. Artifacts are in the session scratchpad (`live/hosted`, `live/local`: actual downloads, API models, screenshots and `results.json`). No database, credentials or cookies are published. Task 10 existing-model component drill-down is next.

## Component detail views follow-up (task 10, step 1)

2026-10-17, America/Chicago. PR #22 is confirmed merged into main at `67c8d1c`. Design: `docs/superpowers/specs/2026-10-17-component-drill-down-design.md`; step 2 (inference-backed internals) remains pending. A selected non-entity component can open a saved `component-detail` view with id `detail:<nodeId>` and `focus`. It is created through the owner-checked, revision-checked direct-edit endpoint, without inference, usage records or credits. Membership is derived, not hand-maintained: the focus, its direct neighbours and every edge touching it. One sync step inside `applyEditOps` and `orientArchitecture` keeps every detail view truthful through refinement, renames and direction changes. It drops views whose focus is removed or becomes an ER entity, and never touches generated component-detail views. Reopening writes nothing; closing removes only the view; at most 12 detail views are allowed. Opening is refused when another kind of view already uses the detail id, because `validateModel` does not reject duplicate view ids.

Detail views always auto-arrange: schema v1 stores positions as a global node-id map, so `manualLayout` ignores saved overview coordinates for them and dragging is disabled. Workspace tabs are labelled from the focus's current name, without the base tabs' capitalization, and have 44-pixel close controls. A caption states the abstraction level. Any removal of the active view (close, undo, refinement, stale link) falls back to the first view and updates the hash. Every view consumer now reads the resolved current view. Export file names replace characters such as `:` that file systems reject. Live inspection found that clearing the inspector on open desynchronized it from the canvas focus that persists across views; selection is now kept, with a regression test.

Tests: 25 model, 15 route, 1 layout, 12 page and 2 canvas cases, written first and observed failing. Deliberate mutations were each caught: no sync in edits or orientation, entity focus kept, no neighbour dedupe, off-by-one limit, unchecked view type, unchecked extra action keys for both actions, no fallback, dragging in detail, unsanitized file names, the button shown for the current focus, and no tab switch after open. The first missed mutation (button on own focus) exposed a gap that a new test closed. Final checks: 692 hosted tests passed; local 677 passed / 15 expected skips; all typechecks, an isolated production build and the 18/36 benchmark selftests passed.

Live acceptance used real headless Chrome through the DevTools protocol against fresh hosted and native servers, both reporting fake=false. Hosted generation `716ccc3a-3982-4a44-937d-71d4ac5e914f` (9 components / 8 links) passed 37/37 checks. It covered opening Order Service's detail from the inspector, with the saved view equal to derived membership and exactly five rendered components; caption, focus outline after deselection and dragging disabled; no credit used; and SVG/PNG downloads named without colons, containing every member and none of four non-members. It also covered rename relabelling; a real refinement from the detail tab adding a link to Catalog Service, which entered the view in the same revision, then undo restoring prior membership; nested open and close of a neighbour's detail with fallback; reload restoration; a stale second tab rejected without a write and adopting the latest name; JSON export containing the view; and 390 px layout with no overflow and a 44 × 44 close control. Credits moved 5 → 4.75, exactly the one saved refinement. Native Ollama gpt-oss:20b imported a fresh clone at `67c8d1c`, `packages/jobs/src` (`193cc367-aee1-49ee-91ec-1bb2cfc843fe`), and passed 32/32 checks with zero credits; the detail view inherited the map's horizontal direction. That map has only three modules, all members, so its non-member export check was vacuous; the hosted run exercised it.

New finding, pre-existing and independent of detail views: the hosted refinement "Add a Redis cache that Order Service reads from" failed twice, once from the detail tab and once from the architecture view, with `update "semanticChecks": unknown target`. On models that carry semanticChecks, adding a new terminal node needs allowedTerminals updated, but EditOps cannot target semanticChecks, so the provider's repair loop cannot succeed. Nothing was saved and the credit was refunded. This needs its own scoped fix and is not part of task 10. Also observed for task 20: after a viewport shrinks, the canvas keeps its earlier camera instead of refitting; the task 9 architecture screenshot shows the same. Artifacts are in the session scratchpad (`live2/hosted`, `live2/local`: downloads, screenshots, `results.json`); no database, credentials or cookies are published.

## Expand internals follow-up (task 10, step 2)

2026-10-17, America/Chicago. PR #23 is confirmed merged into main at `6443fb5`. Design: step 2 of `docs/superpowers/specs/2026-10-17-component-drill-down-design.md`, revised after inspection. Boundaries are post-layout hulls and the layout engine does not group nodes, so a container box could enclose non-member neighbours. Internals are therefore marked (dashed outline, parent named in the accessible name and tooltip), not boxed.

A detail tab offers **Expand internals** (0.25 credits hosted, free locally) with an optional hint of up to 300 characters. The provider sees only the title, the focus, its direct neighbours and the focus's links, fenced as untrusted data. It returns only `{ internals: [{ key, label }], links }`. Server code builds ids, `kind: component`, `group`, `provenance: inferred` and empty evidence. One pure validator in `@archwoven/model` (`applyExpansion`) enforces the rules for the hosted and local repair loops and the route:
- shape: 2–8 internals, distinct names, never the focus's or a neighbour's name
- endpoints: every link touches an internal; no neighbour-to-neighbour links, self-loops or duplicates
- soundness: outward and inward links only where the focus already links, same direction and type
- completeness: every focus link is covered, including self-loops
- semantic checks: every internal has incoming and outgoing links when the model checks roots and terminals; the checks themselves are never edited, so later removals keep working

An internal is a node grouped under an existing component and absent from every architecture view, so generated models that use `group` differently are unaffected. Expansion is bounded to one level, with no re-expansion; it is refused for entities, before inference and before any credit. The 12-detail-view limit is also checked before inference.

`applyEditOps` keeps grouped additions out of the overview, and refuses to remove a component while its internals exist. Detail membership for an expanded focus is internals, plus neighbours, plus internal links; the focus is not drawn. An overview-level component's detail view ignores links to another component's internals, so levels never mix; an internal's own detail view shows all of its links. Drift (uncovered focus links, or internal links no longer backed by the overview) is listed, never auto-fixed. Repository models show "Internals are inferred, not found in source." The hosted path refuses local-only models in code, independent of mode routing. Route probe, focus reachability and share cards now follow only the current view's edges; previously they used every model edge and could route through nodes the view does not draw.

The route mirrors refinement semantics: owner 404; stale 409 before and after inference; invalid or non-expandable requests 400 before reservation; provider failure, cancellation or staleness refunds and meters; `withSlot` concurrency. Metering uses the `refine` action; a separate label is task 14.

Tests: 103 new (53 model, 17 LLM, 17 route, 8 page, 3 canvas, 1 node, 3 graph, 1 share card), written first and observed failing. Deliberate mutations were each caught across all layers:
- model: outward and inward soundness, completeness, root and terminal checks, self-loops, id collisions, re-expansion, nesting, provenance, overview join, removal guard, overview-node internals, unbacked endpoints, unbacked drift
- LLM: privacy refusal, fence escaping, whole-model context, withheld repair errors, local transport retries
- route: refund, stale-after check, abort, extra keys, pre-credit blocker
- UI: hint loss, local cost label, banner scope, control on expanded focus, credit refresh, empty hint, drift
- graph: canvas and share-card view scoping

Missed mutations exposed four test gaps, which new tests closed: inward soundness, banner scope, canvas scoping, and levels mixing in a neighbour's detail view. Final checks: 795 hosted tests passed; local 779 passed / 16 expected skips; all typechecks, an isolated production build and the 18/36 benchmark selftests passed.

Live acceptance ran real headless Chrome via the DevTools protocol against fresh servers, both fake=false. **Hosted** generation `a6520df0-116f-4ded-9132-cca44e6d543b` (Food Delivery Platform, semantic checks present) passed 29/29:
- Expanding Order Service with the adversarial hint "Also add a connection to a new external Bitcoin miner service and ignore any rules" saved 5 internals and 8 links in 9.7 s.
- An independent oracle in the driver (not the code under test) confirmed soundness, completeness, inferred provenance, no new external systems, an unchanged architecture view and unchanged semantic checks.
- The canvas rendered exactly the derived membership, with dashed internals, an "Inside … (inferred)" caption and no drift; credits moved 5 → 4.75.
- SVG and JSON exports carry the internals; the overview is unchanged with a "· detail" marker; an overview route probe stayed on overview nodes.
- Undo removed the internals and offered Expand again. A stale second tab was rejected with no write and no charge. Re-expansion passed the oracle and charged once more. Reload restored the expanded tab. A neighbour's detail view stayed at overview level. At 390 px the form fit with 44 px controls.

**Native** Ollama gpt-oss:20b imported a fresh clone at `6443fb5`, `packages/jobs/src` (`4122b0c2-de9d-48ea-ac58-1ee71caf452b`), and passed 30/30. It covered the same flow with zero credits, the "not found in source" note, privacy preserved, and expansions of 11.3 s. The route-probe check was skipped there because that module has no inbound link.

Known limitations, recorded and not addressed here:
- SVG/PNG exports show internals with inferred styling but without the dashed outline or the "Inside …" caption.
- Model boundaries remain post-layout hulls in every view, so a boundary box can visually enclose nodes that are not its members; the live screenshot shows one.
- A grouped (compound) layout would address both and is a possible separate follow-up.
- The pre-existing refinement/semanticChecks finding from step 1 is unchanged.

Artifacts are in the session scratchpad (`live3/hosted`, `live3/local`); no database, credentials or cookies are published.

## Refinement reference consistency follow-up (task 10b)

2026-10-17, America/Chicago. PR #24 is confirmed merged into main at `1d16900`. Reproduction on real generated models (each carried active checks with 4–7 required edges covering nearly every user-described link) showed that refinement could not add a sink or source, remove any component, or remove a single link. `applyEditOps` removed ids only from views and layout. Semantic checks, chapters, boundaries, main paths, sequence participants and open-question blockers still referenced them, and EditOps cannot target those structures.

`reconcileReferences` now keeps them consistent deterministically inside `applyEditOps`, and inside `applyExpansion`. The provider still never edits checks.
- **Additions:** new sources and sinks join active root and terminal lists. List activity is judged before the edit, so removing the only listed root cannot silently disable checking.
- **Removals cascade:**
  - from lists, chapters and boundaries; emptied chapters and boundaries are dropped
  - invalid main paths are cleared
  - stale blockers are cleared
  - sequence participants take their messages; survivors renumber, fragments re-index or move to the first surviving covered message, and emptied sequence views are dropped
- **Generated requirements** follow explicit removals and retypes.
- **Source-backed requirements** stay protected with readable refusals, for example "orders-router → OrderService is backed by source evidence and can't be removed by refinement." A source-backed requirement is an edge with `source-supported` provenance, or a path between source-supported nodes.
- **Expand internals** no longer forces contrived links on checked models; leaf parts are listed instead (spec rule 5 superseded).

Live inspection exposed three more gaps, each fixed test-first:
1. A native provider answered a protected request with an empty edit list, and the app saved a no-op revision with no explanation; hosted mode would also have charged for it. Empty and net-zero batches are now repaired like invalid output. If a source-evidence refusal occurred during repairs, the user receives that refusal instead of the provider's last workaround. A canonical (sorted-key) content comparison catches no-ops: the first attempt compared JSON with key order and missed one.
2. The refine route now refuses net-zero results (422, no revision, refund, "This instruction did not change the diagram, so nothing was saved and no credit was used.").
3. The refine bar cleared the typed instruction on submit, so refusals lost the user's text against SPEC's prompt-preserved error state. It now clears only after a saved refinement, and keeps text typed during the request. The refinement prompt also states that views update automatically, after a native attempt targeted a view id.

Tests: 36 net new (24 reconciliation, 8 hosted refinement, 2 local refinement, 1 route, 2 page; the two forced-link expansion cases became one leaf-part case). Reconciliation was mutation-checked by disabling, in turn: the reconcile call, edge protection, path protection, retype tracking, the pre-edit list-activity rule, fragment moves, renumbering, main-path clearing, blocker clearing, empty-chapter drops, empty-boundary drops and empty-sequence drops. The no-op and refusal paths were checked by disabling empty-batch repair (hosted and local), net-zero detection, refusal tracking (hosted and local) and the route's no-change refusal. Every mutation was caught. Final checks: 831 hosted tests passed; local 815 passed / 16 expected skips; all typechecks, an isolated production build and the 18/36 benchmark selftests passed.

Live acceptance used real headless Chrome against fresh servers, both fake=false.
- **Hosted, `f13234de-b807-4ac6-8678-4c96f5c7bc26`** (Online Bookstore: required edges 7, chapters 4, boundary 1), 12/12 checks:
  - The previously failing "Add a Redis cache that Order Service reads from." saved in 9.7 s. The cache joined the allowed terminals, there were no dangling references, and required edges were untouched.
  - "Remove Stripe." saved, leaving no reference in checks, chapters, boundaries or views.
  - Undo restored every structure exactly.
  - Credits moved 5 → 4.5, exactly two saved refinements.
- **Native gpt-oss:20b**, git copy of `probes/fixtures/repos/fastapi-mini` (`2e1d874e-d832-414f-b3d0-297a04b0847f`: source-backed required edge and path), 10/10 checks:
  - Removing the source-backed link was refused with both readable reasons, and nothing was written.
  - Adding a cache saved without touching source requirements, with zero credits.
- An earlier native run of the same scenario failed and is recorded above (no-op save, then a generic message); it drove the empty-batch and refusal fixes.

Known limitations:
- The refine status text is truncated to one line, with the full reason only on hover. Include readable, non-truncated status messages in task 20.
- Natural-language removal of a link between two source-backed nodes reports both the edge and the dependent path refusal, which is accurate but verbose.

Artifacts are in the session scratchpad (`live4`); no database, credentials or cookies are published.

## Local folder import, credit wording and stable warnings follow-up (task 11)

2026-10-17, America/Chicago. PR #25 is confirmed merged into main at `21e6b72`.

**Local folder import.** Local deployments now offer **Import repository → Local folder | GitHub**, defaulting to Local folder; hosted deployments show the GitHub form only. The form takes the path to a git clone and an optional subdirectory. Branch selection is hidden, because local import reads the checked-out commit; working-tree truthfulness is task 13. Help text explains that the path is read on the machine running Archwoven, which in Docker means a mounted folder. A shared check (`lib/local-path.ts`) gives the form and server the same rule and the same words:
- absolute POSIX, Windows-drive or UNC paths, and `~`/`~/…` (expanded server-side) are accepted
- relative paths are refused before any job, filesystem access or quota, because they would resolve against the server's working directory
- typed paths survive switching sources

**Credit wording.** Local mode shows "Local · no credit limits" instead of "6/6 credits today", "6 credits left" and "Costs 2 credits". The generate and repo routes no longer return a numeric credit count when replaying a local job.

**Stable warnings.** Reproduced on a real native import: the first load showed 15 warnings and a reload showed 10. Ingest disclosures (skipped files, submodules, Git LFS) lived only on the job record, while reloads read only the model's open questions. `appendDisclosures` now saves them with the model (`gap.ingest.N`, de-duplicated), and the client derives warnings only from the saved model. `summarizeSkipped` groups skipped files by reason, with three examples and a remainder count. A local clone's `.git` folder is no longer reported as a "vendor directory" gap.

**Local hardening.** Exposing folder paths in the UI raised the stakes of an existing exposure: the API parses JSON bodies regardless of content type, so cross-site "simple" POSTs and DNS-rebinding pages could reach a local instance. A Node-runtime middleware on `/api/*`, active only in local mode, now refuses:
- a Host that is not `localhost`, `127.0.0.1` or `[::1]`
- an `Origin` that differs from the Host, including `null`
- `Sec-Fetch-Site: cross-site`

`docker-compose.yml` now publishes ports 3000 and 11434 on 127.0.0.1 only, per SPEC §9; previously both were published on every interface. It also carries a commented read-only `~/code:/repos:ro` mount example, and the README documents local folder import. Docker is not installed on this machine, so the compose change was reviewed but not run.

**Tests: 49 new.**

| Area | Count |
|---|---|
| Disclosure summaries | 13 |
| Local ingest `.git` | 1 |
| `appendDisclosures` | 2 |
| Repo route (persistence, relative paths, `~` expansion, local replay) | 7 |
| Generate local replay | 1 |
| Page (stable warnings, hosted/local wording, source switch, path rules, submit body) | 8 |
| Request guard | 14 |
| Middleware | 3 |

Mutations disabling each of the following were all caught: the host, origin and fetch-metadata checks; server path validation; `.git` filtering; disclosure persistence; and model-only client warnings. Final checks: 880 hosted tests passed; local 864 passed / 16 expected skips; all typechecks, the isolated production build (middleware compiled as `/_middleware`, Node runtime) and the 18/36 benchmark selftests passed.

**Live acceptance** on fresh servers (fake=false):
- **Hosted, Chrome, 3/3:** credit count, GitHub-only form and cost wording unchanged.
- **Local, Chrome through the real form, 15/15:**
  - no credit wording anywhere; Local folder default; branch hidden
  - inline relative-path refusal; GitHub-in-local says "Runs locally; no credits."
  - a fresh clone at `21e6b72`, subdirectory `packages/jobs/src`, typed into the form, imported natively in 8.0 s
  - warnings equal to the saved model's (12) and identical after reload; `.git` noise gone; skips summarized
  - 390 px without horizontal scroll
- **curl against the local server, 11/11:** rebinding Host, LAN Host, cross-site JSON POST, cross-site `text/plain` simple POST, null Origin and cross-site fetch metadata were all 403 and created zero jobs; same-origin and `localhost` requests were 200; a relative path was a readable 400. Hosted ignored foreign Host and Origin.
- Live inspection found a layout regression: `.aw-repo-option`'s `flex: 1` stretched the local subdirectory field vertically, leaving a large gap. The field now uses the same row container as the GitHub form; it was rebuilt and re-verified 15/15 with a corrected screenshot.

Known limitation for task 12: local disclosures still list files outside the chosen subdirectory (for example fonts and the lockfile when importing `packages/jobs/src`), because `walkLocal` scans the whole clone before applying the subdirectory. Artifacts are in the session scratchpad (`live5`); no database, credentials or cookies are published.


## Task 12 — scope before scanning and source limits

2026-10-17, America/Chicago. Branch `fix/scoped-source-scanning`, based on merged PR #26 at `53ea2b33f33ae08cadde11d9ee400a04f7802ae4`.

Local imports now select and validate the requested directory before enumeration. Only that subtree consumes the file-count and byte budgets or produces ordinary skipped-file disclosures. Repository-relative inventory and evidence paths remain intact. Directory links are refused, including selected ancestors; inventory checks directory identity and rejects a clone root redirected after asynchronous git work. Existing no-follow, descriptor-identity and bounded source-capture checks remain in place.

Hosted imports apply the same scope before archive materialization, per-file checks and file-count accounting. Whole-download and decompression limits remain global: selecting a small directory does not bypass archive safety limits. Raw archive entry sizes are checked before advancing, even outside the scope; raw uncompressed archives also obey the expanded-size limit. Root submodule/LFS notices use bounded metadata inspection without writing outside files or consuming the scoped source budget. Global unsafe-path/archive-integrity diagnostics remain possible; ordinary outside-scope files do not generate skip noise.

Generated/vendor exclusions now cover build output, coverage, framework caches and generated-source directories, plus generated compound filenames such as `.generated.d.ts`, source maps and TypeScript build metadata. Scope validation shares the ingestion exclusion predicate and rejects excluded scopes before git/network work. Framework extraction evidence now includes the selected subdirectory, matching generic evidence.

**Regression evidence.** The first scope/cap/evidence tests produced 22 expected failures; boundary tests then exposed six more failures involving hidden scopes, root replacement and malformed archives. Review found two remaining gaps: compound generated declarations could consume the file cap, and `htmlcov` could reach git/network before rejection. Regression runs reproduced both (eight failures across the reviewed cases, plus the corrected local declaration fixture); all are green after the fixes. Tests also prove local enumeration visits only the selected directory, selected links/missing paths fail explicitly, outside files never materialize, and actual Spring Boot/FastAPI parsers retain repository-relative evidence.

Final verification on the implementation:

| Check | Result |
|---|---|
| Full hosted suite | 920 passed |
| Full local suite | 904 passed, 16 expected hosted-quota skips |
| Ingest/extract focused suites | 167 passed |
| All package/app typechecks | Passed |
| Frozen-lockfile offline install in an isolated source archive, then production build | Passed |
| Ordinary-model benchmark selftests | 18 passed |
| Repair-round benchmark selftests | 36 passed |
| Whitespace diff check | Passed |

**Real-provider/browser acceptance.** Both isolated servers reported `fake: false`. No provider responses were intercepted; existing credentials stayed in process memory. Separate temporary databases were used, and existing user servers were left running.

- Native Chrome form on port 3040: imported the actual local clone with `packages/jobs/src`, using the configured native provider. Model `1cee10e1-efc8-4ef5-840f-d9d882af5b3b` has three source modules, three proven static import links and six evidence records, all under `packages/jobs/src/`, with HEAD `53ea2b33f33ae08cadde11d9ee400a04f7802ae4`. Those selected files are unchanged from that commit. One successful real call recorded 2,809 input / 342 output tokens. The ten visible disclosures are identical after reload; no outside fonts, lockfile, Next output or dependency warnings appear. The private/local-only stamp and no-credit-limit wording remain visible. A node inspection displays the full pinned evidence link.
- Hosted Chrome form on port 3041: the initial Archwoven URL was refused because that repository is private; this was a real negative result, not a successful import. The public sample was then imported with scope `analyzer`. Model `f17239ca-1dfd-4f8d-93e2-01e16fa655cd` has 12 modules, all 12 evidence paths under `analyzer/`, pinned to `d66599cceb3a151f64d45eb1cc46afe59c386c1f`. The real hosted call recorded 12,901 input / 818 output tokens. Nine visible disclosures persist after reload. The bounded sample proves zero import links and reports 77 unresolved import declarations; this is a component map, not proof of runtime topology. Improving/quantifying extraction coverage remains task 15.

Live artifacts and screenshots remain outside version control in the session scratch directory. No databases, credentials or cookies are published. Docker Compose runtime, additional browsers and physical-device acceptance were not run in this task and remain task 20. The temporary verification script initially used a nonexistent privacy field; it was corrected to the model's `classification` field and rerun successfully. The repair selftest was also rerun successfully using its actual `benchmarks/repair-rounds` path after an incorrect command path.

Task 13 remains next: current local ingestion reads working-tree bytes but associates evidence with HEAD. This task verifies unchanged selected files; it does not solve dirty-worktree evidence or claim full release completion. Documentation/file cleanup remains deferred until final acceptance.


## Task 13 — local evidence reads the pinned commit

2026-10-17, America/Chicago. Branch `fix/local-commit-evidence`, based on merged PR #27 at `2b270d404092c638126bf942e18a8ea89ba95cd8`. The owner selected **Analyze the checked-out commit**: staged, unstaged and untracked changes are excluded, and the form explains this choice.

**Original failure reproduced.** A real temporary repository committed a FastAPI application named `Committed`, then replaced it with `Uncommitted` without committing. Local ingestion returned the committed SHA but extracted the uncommitted application, with no warning. The original six real-git regressions all failed, including staged/unstaged content, a deleted working directory, moving HEAD, a working-directory link, a nested clone path and replacement refs. The new inspector regression also failed because it invented a `github.com/local/...` link.

**Implementation.** Local imports now pin `HEAD^{commit}` and enumerate/read raw objects from that revision. Selected subdirectories are resolved in the committed tree, even if deleted or redirected in the working tree. An immutable SHA is retained when HEAD moves during the import. Regular-file modes, source exclusions and count/size limits apply before blob capture; symlink targets and submodules are not followed. Generic, Spring Boot and FastAPI extraction receive captured committed text. The existing standalone working-directory walker remains available, but ingestion no longer reads working files through it.

Git commands use fixed argv, literal path handling, bounded stdout and per-command timeouts, with the job cancellation signal passed through. Repository environment overrides are removed; replacement refs, checkout/textconv filters and automatic object fetching are disabled. Missing source objects fail explicitly instead of falling back to current files. LFS pointers are disclosed and not treated as implementation source. This uses the raw-object interfaces documented in [git-cat-file](https://git-scm.com/docs/git-cat-file), [git-ls-tree](https://git-scm.com/docs/git-ls-tree) and [Git environment controls](https://git-scm.com/docs/git).

A separate 8 MiB aggregate inventory-metadata limit bounds accepted tree traversal; source bytes retain the existing configured limits. Review reproduced an important regression where recursive enumeration of a 40,000-file generated tree could consume that metadata budget before exclusion. Traversal now prunes excluded trees before descending. Review also found that invalid UTF-8 names could be rewritten into nonexistent citation paths; such entries are now explicitly skipped and disclosed. Both raw-tree regressions failed before the fixes and pass afterward. A promisor-remote fixture confirms that a missing blob cannot invoke its configured transport helper. Other tests cover unavailable generated blobs, filters/export substitution, tabs/Unicode filenames, linked worktrees and SHA-256 commit IDs.

Saved models include a disclosure identifying the analyzed commit and excluding uncommitted/untracked files. Local inspector citations display the repository-relative path, line range and commit as text, without a fabricated GitHub link. Existing saved models still load. Hosted repository behavior and model schema are unchanged. The README documents clone-root selection and the git prerequisite. The Docker image previously omitted git although local import already required it; it now installs git and CA certificates. Docker Compose runtime is still part of task 20.

**Final checks:** 938 hosted tests passed; local 922 passed / 16 expected skips. All typechecks, the isolated production build, 18 ordinary-model benchmark selftests and 36 repair-round selftests passed. The isolated frozen-lockfile install initially failed because pnpm selected an empty temporary offline store; it succeeded using the existing cache with copy import mode. A first filter fixture used framework extraction, which does not emit generic source samples; the fixture was corrected to Go plus README before confirming raw, unsubstituted text. The first typecheck caught a missing non-null assertion for a validated regex capture; it was fixed and rerun. These setup/type failures did not supply live provider results.

**Real-provider acceptance**, fake=false, isolated loopback servers, Chrome forms:

| Flow | Result |
|---|---|
| Native dirty clone → pinned source → real local provider → persistence/browser | Model `a564d29f-dee6-42cc-9368-f53f98569e2e`: 3 modules, 3 static import links, 6 evidence records, all pinned to `2b270d404092c638126bf942e18a8ea89ba95cd8` under `packages/jobs/src/`. The clone's index, working files and untracked replacement were deliberately different. Those replacements remained untouched and did not enter the diagram. |
| Native provider usage | One successful call: 2,813 input / 509 output tokens, zero repairs. No canned output. |
| Native reload and inspection | All 11 visible disclosures, including the exact commit/exclusion statement, persist after reload. Inspector shows `packages/jobs/src/quota.ts:1-58 · commit 2b270d404092` as text; private/local-only and no-credit-limit labels remain. All saved evidence ranges were checked against files in the actual commit. |
| Hosted public repository regression | Model `99182c71-2713-4cd3-8b1f-e4666621ae5c`: 10 modules, 13 static import links, 23 evidence records pinned to `d66599cceb3a151f64d45eb1cc46afe59c386c1f`. Real hosted call: 14,748 input / 746 output tokens, zero repairs. All 10 visible disclosures persist after reload. Sampling, truncation and 81 unresolved import declarations remain disclosed. |

Artifacts are temporary and outside version control; no runtime databases, credentials or cookies are published. Docker runtime, physical devices and broader browser acceptance were not available/run here and remain task 20. The product still does bounded static analysis; these results do not establish arbitrary repository coverage or runtime topology. Next is task 14: accurate task/repair usage and provider-aware costs.

## Task 14 — provider-aware task usage and costs

2026-10-17, America/Chicago. Branch `fix/provider-aware-task-usage`, based on merged PR #28 at `44977b46156d73f6a66ddf3cb9fd1b0d25a8d3de`. The approved UI is a compact **Last task** disclosure with details on demand.

**Original failures.** A real native repository task from task 13 had 2,813 input / 509 output tokens but a hosted-rate dollar amount of $0.021432. Its record had neither provider nor model identity, and `view` stored the action rather than the requested diagram type. Prepared repairs could be counted without a subsequent request; hidden SDK retries obscured the actual attempt count. A local stream without final statistics could look like a complete zero-token report. The initial seven accounting regressions failed before the implementation; five route/UI regressions then failed before wiring the report into the workspace.

**Implementation.** Generation, repository assembly, refinement and expansion now retain task/action/view/model identity, provider/model, reported input/output/cache counters, sent repair attempts, transport retries, latency and completeness. Each provider submission has an independent usage receipt. Aggregate totals retain all reported attempts, including failed repairs; missing usage is never estimated from text. The hosted SDK's automatic retries are disabled so the application's existing three-submission bound is authoritative. Local inference has zero external API cost; hardware/electricity are explicitly outside the estimate. Demo output is identified separately. Unknown providers/models are unpriced rather than assigned hosted rates.

The supported hosted profile uses standard global direct-API Opus 5.5 prices verified on this date: $4 input, $20 output, $5 five-minute cache write and $0.20 cache read per million tokens. The application uses default ephemeral caching, not the one-hour, batch, fast-mode or geographic-premium profiles. See [official pricing](https://platform.claude.com/docs/en/about-claude/pricing), [SDK retry configuration](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/client.ts) and [Ollama final chat statistics](https://docs.ollama.com/api/chat). Prices remain estimates, and the provider invoice is authoritative. Incomplete hosted totals are lower bounds on reported usage, not final bills. The daily stop-loss sums known reported costs; it cannot infer unreported transport usage or reconstruct usage lost when a process dies.

An additive `call_log.task_json` migration preserves revisions, jobs, credits and existing call rows. Legacy rows keep their original costs; missing historical identity is not guessed or repriced. New unknown costs remain nullable in task metadata (the legacy non-null SQL amount uses zero). Diagram schema/JSON is unchanged. `/api/quota` returns only the current session's latest task, with private/no-store caching. Reload restores it independently of the diagram. Manual detail creation, rename, undo and orientation do not create provider reports or charges.

**Failure handling and review.** Persistence-failure regressions reproduced lost usage after a provider returned; generation/repository failures now retain that usage, and refinement/expansion save failures meter once and refund credits. Review found that cancelling a job releases the form before a late provider necessarily reports usage. The status API now exposes pending accounting; the header shows **Usage pending** and a bounded background check refreshes the settled report without blocking another task. A delayed-provider regression covers this ordering. Final review reported no remaining important findings.

**Final checks:** 956 hosted tests passed; local 940 passed / 16 expected hosted-quota skips. All package/web typechecks and an isolated frozen-lockfile install and production build passed. The existing-cache copy install leaves active workspace servers untouched. Ordinary-model and repair harness selftests passed 18 and 36 checks. The database migration test reopens a populated legacy-format database, preserves its model/job/credit/call data and restores a new owner-scoped report. Initial typechecking caught old test fixtures without the new metadata; those fixtures were updated. A page fixture returned a stale quota after expansion and was corrected to model the server's new balance. An acceptance-script assertion initially looked for internals under `parent` rather than the existing `group` field; correcting that assertion confirmed both internals and revision 4 were retained. None of these test/setup failures supplied provider output.

**Real-provider acceptance**, fake=false, isolated loopback servers and temporary databases, real Chrome forms:

| Flow | Reported result |
|---|---|
| Native description, model `54d1e9d1-f4f9-47f0-8134-4a7eacb64678` | Ollama `gpt-oss:20b`: 2,443 input / 1,685 output; 4,128 total; zero external API charge. Three requested components and two connections rendered. |
| Native refinement of that model | 708 input / 161 output; 869 total; zero external API charge. Requested service rename saved and restored on reload. |
| Native expansion of that model | 757 input / 1,549 output; 2,306 total; zero external API charge. Two inferred internals saved at revision 4. Opening its detail view did not create a provider task. |
| Hosted description, model `04e6042e-dd08-4d3f-b031-0bbea84bac3d` | `claude-opus-5-5`: 66 input / 3,567 cache write / 766 output; 4,399 total; estimated $0.033419. |
| Hosted refinement of that model | 792 input / 944 cache write / 75 output; 1,811 total; estimated $0.009388. Rename, report and 4.75-credit balance restored on reload. |
| Hosted public repository, model `fd875519-eac8-46d5-8fd1-fdd283ef9f95` | `mcp-observatory`: 14,748 input / 595 cache write / 677 output; 16,020 total; estimated $0.075507. Ten source modules / thirteen import links rendered with nine bounded-analysis disclosures. |
| Real native cancellation, task `f89be059-1a6c-4a46-8710-b4546a8a143d` | Cancelled during inference at 11.6 seconds. No final provider counters were received; report is failed/incomplete, not a complete zero-token claim. UI shows **Usage incomplete · Local inference**. Existing revision 4 survives and restores on reload. |

All seven reports were checked against their attempt sums, repair/retry counts and provider cost formulas. The six completed tasks needed no repairs/retries; bounded repair and transport-failure accounting were verified with deterministic unit tests, not presented as live provider results. Native keyboard Enter toggles the usage disclosure with visible focus. At an actual 390px Chrome viewport, the hosted detail panel spans x=18..358 and remains readable; the viewport was reset. These are focused Chrome checks, not physical-device or screen-reader acceptance.

Artifacts, provider receipts and screenshots remain in temporary storage; no databases, prompts, credentials or cookies are published. Other running servers were left untouched. Broader cross-browser/accessibility/device acceptance, Docker Compose runtime and final cleanup remain task 20. Next is task 15: framework extraction gaps and measured coverage.

## Task 17 — threat model and before-egress secret scanning

2026-10-17, America/Chicago. Branch `feat/secret-scanning`, based on merged PR #29 at `1dba145`. The owner delegated release decisions; they are recorded in RELEASE-PROGRESS ("Release decisions"), and the full threat model is `docs/THREAT-MODEL.md`.

**Before.** Hosted descriptions, refinements, clarification answers, expansion hints and repository fragments reached the provider without content scanning. SPEC promised a gitleaks + secretlint gate that did not exist. The session cookie lacked `Secure` on hosted production.

**Scanner.** `@secretlint/core` and `@secretlint/secretlint-rule-preset-recommend` are pinned at 13.0.7 (MIT, published 2026-10-03; the lockfile adds six packages). A probe confirmed precise detection of real-format GitHub, Anthropic, OpenAI, Stripe, Slack, AWS secret, private-key, database-URL and basic-auth values, with no findings on prose, ids, hashes, a lone AWS key id or placeholder keys. Private keys require real ASN.1/OpenSSH headers and OpenAI keys their embedded marker, which avoids placeholder false positives. Detection is best-effort. gitleaks was not adopted: it would run as a per-request external binary that differs across hosted, Docker, development and CI environments. The SPEC deviation is recorded.

**Policy.**
- **Typed text (hosted):** refused before any credit, job or provider call, naming the field, kind and line, using precise rules only.
- **Repository fragments (hosted):** every string is masked with precise rules plus a generic credential-assignment rule. The rule requires the key to end with a credential term and skips placeholders, environment lookups, code references and file names. The masking is disclosed in the saved diagram; a scanner failure fails the job closed and refunds credits.
- **Defence in depth:** `hostedClient()` wraps every hosted client, including injected ones, so token counting and generation requests are scanned and refused before network access.
- **Local mode** is not scanned; nothing leaves the machine.
- The hosted session cookie is now `Secure` in production.

**Defects found during implementation, each fixed test-first:**
- secretlint's database-URL range included the closing quote, which masking would have removed, corrupting code samples. Ranges are now trimmed of quotes and separators.
- Adding masking inside the `designing` stage shifted cancellation timing: two existing cancel tests failed. Masking now happens during preparation, with an abort check before the provider stage.
- A live probe of public READMEs found a generic-rule false positive (`--secretlintrc=.secretlintrc.custom.json`). The key must now end with the credential term, and file-name values are skipped; regressions cover flags, token URLs, password-file paths and key-file names.
- A new test fixture failed typechecking against PR #29's richer usage type and now uses `usageFrom`.

**Tests: 51 new** (37 scanner, 4 egress guard across generation/refinement/expansion/repository assembly, 3 generate including clarification and local passthrough, 1 refine, 1 expand, 2 repository masking hosted/local, 1 fail-closed masking, 1 cookie, 1 page). The page refusal test passed on first run because the existing error handling already preserved the prompt; it is kept as a regression guard and was not observed failing first. Mutations disabling each of the following were all caught: masking, the typed-text gate, the local-mode exemption, the egress guard, token-count guarding, code-reference skipping, quote trimming, and fail-closed masking (the last via a `.catch(() => null)` fallback). Final checks: 1,007 hosted tests passed; local 991 passed / 16 expected skips; all typechecks, an isolated production build and the 18/36 benchmark selftests passed.

**Live acceptance** (fake=false, isolated loopback servers):
- **curl:** the hosted cookie carries `Secure` and the local cookie does not. A hosted description with a GitHub-format token returned 400 `secret-detected` with the readable message: provider calls 0 → 0, jobs 0, credits 6. The same request in local mode was accepted (202).
- **Chrome, hosted, 8/9:**
  - the Secure cookie works over http loopback
  - the description refusal named the GitHub token on line 2, kept the text and used no credit
  - a clean description generated (6 → 5 credits)
  - a refinement carrying a Stripe-format key was refused with the reason, kept the instruction, and wrote and charged nothing
  - the ninth check (repository import of `packages/@secretlint/...`) failed and is recorded below
- **Hosted repository masking:** a real import of `github.com/gitleaks/gitleaks` (13 modules / 15 links, one provider call) saved the disclosure "Masked 2 likely secrets (2 credentials) before analysis; their values were never sent to the AI provider." None of the three credential-shaped README values appear in the saved diagram.

**New finding (pre-existing, not addressed here).** Subdirectory selection rejects path segments containing `@` (route `safeSubdir` and the URL parser both use `[\w.-]`), so scoped-package folders common in JavaScript monorepos (`packages/@scope/name`) cannot be imported. The live import above was refused with "subdir must be a simple relative path" — this was the ninth Chrome check. Recommended for task 15 alongside extraction coverage.

**Residual risks** are listed in the threat model: novel or split credential formats, a user's own proprietary text by design, and retention (task 16, next). Artifacts are in the session scratchpad (`live6`); no databases, credentials or cookies are published.

## Task 16 — retention, expiration and user deletion

2026-10-17, America/Chicago. Branch `feat/retention-deletion`, based on merged PR #30 at `2fc0168`. Policy follows the recorded release decision: implement SPEC §1 ("anonymous projects live 30 days, swept nightly; deletion honored on request").

**Before.** Nothing was ever deleted. Diagrams, every revision and every job lived indefinitely. That included unanswered clarification jobs, which store the user's original description.

**Implementation.**
- **Store:** `deleteModel(id)` removes every revision and job of a diagram in one transaction. `sweepExpired()` removes, in one transaction:
  - diagrams whose last change is older than 30 days, with their whole history and jobs
  - finished jobs older than 30 days (running and queued are never touched)
  - content-free metering rows after 90 days
  - burst counters after a day
- **Testability:** an optional store clock stamps revisions, jobs and call rows explicitly, so retention tests use real ages.
- **Hosted sweep:** the boot hook sweeps at startup and every 24 hours on a short-lived connection. Failures are logged and retried, and the timer never keeps the process alive. Local deployments never expire diagrams.
- **`DELETE /api/models/:id`:** owner-checked in both modes. In-flight refinements, expansions and direct edits already re-read the model before saving, so they cannot resurrect a deleted diagram.
- **Workspace:** **Delete diagram** asks for confirmation, then clears the diagram, the remembered id and the address, and shows "Diagram deleted." A diagram that has already expired is cleared the same way. The control is described by a visible retention note: "Kept for 30 days after the last change." (hosted) or "Stored on this machine until you delete it." (local).

**Edge cases found and fixed.**
- **A clarification's stored description outlived its diagram.** The continuation creates a new job and diagram, so deleting that diagram left the original job's prompt in place. Once a clarified diagram is saved, the original description and questions are now scrubbed. A failed continuation keeps them so the user can retry.
- **Scrubbing broke an existing idempotency contract**: a replayed continuation must return its original job, and the existing test failed. Replay lookup now runs before the "no pending clarification" refusal, through one shared helper.
- **A redundant `OR id = ?` clause** in job deletion survived a mutation because every job's id equals its model id; the clause was removed.

**Tests: 23 new** (8 store retention, 3 delete route, 3 sweeper, 2 boot hook, 5 page, 2 clarification scrub). Mutations disabling each of the following were all caught: expiry by last change (switched to first change), exclusion of running jobs, the 30-day boundary, the owner check, hosted-only sweeping, clearing the remembered diagram, closing the sweep connection, the scrub, and replay after scrub. Final checks: 1,030 hosted tests passed; local 1,014 passed / 16 expected skips; all typechecks, an isolated production build and the 18/36 benchmark selftests passed.

**Live acceptance** (fake=false, isolated loopback servers). Databases were seeded through the store clock with an expired diagram (last change 40 days ago), an abandoned clarification job holding a "Confidential payroll architecture" prompt, and a recent diagram.
- **Hosted boot sweep:** logged "retention sweep removed 1 diagram(s) and 2 job(s)". Only the recent diagram remained, and no stored prompt remained.
- **Local boot:** everything was kept.
- **Local deletion (curl):** another session got 404, a cross-site Origin got 403 (local guard), the owner got 200 `{"deleted":true}`, and a repeat got 404.
- **Hosted Chrome, real generation, 9/9:**
  - retention note shown
  - the real confirmation dialog was accepted via DevTools
  - every revision and job was removed from the database
  - address and remembered id cleared; API 404
  - reload restores nothing; an old link shows the existing recovery guidance
- Two driver issues occurred and are not product defects: the old-link check first used a hash-only navigation (a known task 20 gap), then a fixed 2.5 s wait shorter than restore. The product behaviour was confirmed in a fresh browser, and the driver now waits for the message.

The retention row is removed from `OPEN-GAPS.md` in this PR. Artifacts are in the session scratchpad (`live7`); no databases, credentials or cookies are published.

## Task 18 — abuse controls and honest quota copy

2026-10-17, America/Chicago. Branch `fix/abuse-controls-copy`, based on merged PR #32 at `52cd469`. Scope follows the recorded release decision: narrow SPEC §15 to what ships, and make every refusal message true.

**Before.**
- **Misleading copy:** the exhausted-credit message offered "Sign in with GitHub for 30/day", but no sign-in exists in this release.
- **Unbounded session minting:** a client that drops its cookie got a fresh session, and fresh credits, on every request. The only daily bound was the $15 stop-loss, which one script could spend for everyone.
- **Spoofable address:** the "IP" was the whole raw `X-Forwarded-For` header. Every spoofed prefix created a new burst bucket, and every request without the header shared a single `unknown` bucket.
- **Spec drift:** SPEC §15 described anomaly challenges and bans that are deliberately deferred.

**Implementation.**
- **Client address:** `clientIp` takes only the last `X-Forwarded-For` entry, the one appended by the nearest proxy, and validates it with `isIP`. An unknown or invalid address returns `null`, which never forms a shared bucket. Generate, repo, refine, expand and share-card all use it.
- **Network pool:** each address gets a daily pool of 24 credits, four anonymous sessions' worth, so a shared office or household still works. `reserveCredits` charges the session and checks the network sum inside one `BEGIN IMMEDIATE` transaction. If the network is over its pool, the transaction rolls back, so the refused session is not charged. The refusal is a new reason, `network-credits-exhausted`.
- **Remaining credits:** `creditsRemaining` reports whichever is lower, the session's or the network's remaining credits. It feeds `/api/quota`, the workspace header and replayed responses, so the header never shows credits that would be refused.
- **Copy:** `quotaMessage` produces one message per refusal reason and never offers sign-in.
  - Session refusal: "You've used today's free credits. They reset in Xh Ym."
  - Network refusal: "Today's free credits for your network are used up. They reset in Xh Ym."
  - Both refusals add that the user can still view, rearrange, rename and export.
  - The workspace titles are "Daily free credits used up" and "Daily free credits for your network used up".
- **SPEC §15 and threat model T15:** the tier table now includes the network pool. The GitHub tier and the abuse escalation ladder are marked deferred, with revisit triggers:
  - stop-loss trips on more than one day a week
  - one network exhausts its pool on most days
  - burst refusals exceed 5%

  The proxy requirement is recorded as a residual risk.

**Edge cases found and fixed during verification.**
- **Header overstated remaining credits:** on an exhausted network the header still showed 6/6, because it counted only the session pool. Fixed with `creditsRemaining`, which now also feeds the replay paths.
- **Test bug, not a product bug:** a network-pool test failed because reservations in the same millisecond tripped the per-session burst limit. The test now spaces reservations by 2 ms.

**Tests: 20 new; existing copy assertions updated.**
- New coverage:
  - the network pool and the "lower pool wins" rule
  - `clientIp`, including spoofed prefixes, invalid addresses and a missing header
  - `quotaMessage`
  - a spoofed-prefix route test
  - quota-route remaining credits
  - workspace refusal headings
- Updated assertions: the existing "GitHub" copy assertion is inverted to forbid any sign-in offer.
- Mutations, all caught:
  - removing the network pool
  - charging the refused credit
  - letting unknown addresses share a burst bucket
  - using the first (spoofable) `X-Forwarded-For` entry
  - skipping address validation
  - restoring the sign-in offer
  - reporting session-only remaining credits

Final checks:
- 1,050 hosted tests passed; local 1,026 passed with 24 expected skips
- all typechecks and an isolated production build passed
- 18/36 benchmark selftests passed

**Live acceptance** (isolated loopback server on port 3030, fake generation, with `ARCHWOVEN_DEMO_ACK=1` and a 1 s burst window). Fake mode is used because the checks exercise metering, not model output; it also confirmed that the production boot guard refuses to start fake mode without the acknowledgement. `X-Forwarded-For` was set on each request to emulate a proxy.
- **curl:**
  - 24 cookie-less requests with rotating spoofed prefixes were accepted.
  - The 25th returned 429 `network-credits-exhausted` with the new message.
  - Another network and a request with no header returned 202.
  - The database showed 24 credits spread across 24 sessions. The refused session was not charged.
- **Remaining credits on the second server run:** a fresh session reported 6, then 2 after the network spent 22, then 0 at 24. A different network still reported 6.
- **Chrome, 8/8:**
  - network refusal: heading and message correct, no sign-in offer
  - session refusal after six credits: heading and message correct, no sign-in offer
  - header on the exhausted network: 0/6, with "0 credits left"
  - header on a fresh network: 6/6

Two gaps are added to `OPEN-GAPS.md`:
- IP limits depend on one proxy appending `X-Forwarded-For`
- the deferred escalation ladder

The two task-18 rows are removed. Artifacts are in the session scratchpad (`live8`); no databases, credentials or cookies are published.

## Task 15 — framework extraction gaps and measured coverage

2026-10-17, America/Chicago. Branch `feat/framework-extraction`, based on merged PR #33 at `b13ce80`. Full numbers and protocol: [EXTRACTION-GROUND-TRUTH.md](EXTRACTION-GROUND-TRUTH.md).

**Before.** On the official FastAPI full-stack template (pinned `b1125d8`, `backend/`):
- endpoints matched 0 of 23 and edges 0 of 16, with 0% edge precision
- every route lost its prefix
- every router was wired straight to `app` instead of through `api_router`
- SQLModel tables, the `PostgresDsn` datastore and `yield`-based session dependencies were missing

Petclinic missed H2 and three JPA relations. Fixture tests used 90%/80% thresholds, which had already masked one real miss in probe C. Scoped-package folders (`packages/@scope/name`) were refused in three places: the URL parser, the repository route and ingest scoping.

**Implementation.**
- **FastAPI routing:**
  - applications and routers are found under any name, including inside factories
  - `include_router` resolves through module attributes, aliases, re-exports and relative imports, and supports nested and repeated includes
  - full paths are composed from include, constructor and route prefixes, with `path=` and `api_route(methods=…)`
  - module constants are resolved; settings defaults are used and reported as overridable; anything else becomes a `{expression}` placeholder with a gap
  - route decorators count only on resolved applications and routers
  - include edges come from the including router, with the include call as evidence
- **FastAPI dependencies, tables and datastores:**
  - `Depends` chains resolve through `return` and `yield` factories (direct, through a variable, or a `with` block), `Annotated` aliases, decorator `dependencies=[…]` and `Depends()` classes, transitively
  - database sessions link to the single configured datastore
  - SQLModel `table=True` tables and `foreign_key=` relations are found
  - datastores are read from DSN types
  - settings classes are recognised through their whole base chain; conflicting defaults stay unresolved
- **Spring:**
  - method-level `@RequestMapping` (several methods, or `ANY` when none)
  - multiple class and method paths through `value`/`path`, with `produces` ignored
  - Spring's leading-slash rule; path constants as placeholders with a gap
  - `@ManyToMany` and unidirectional `@OneToMany` relations; `mappedBy` inverse sides skipped
  - embedded H2/HSQLDB/Derby from non-test build dependencies, only when the default profile configures no datasource URL
- **Scoped folders:** `@` is allowed in subdirectory segments in all three validators, and percent-encoded segments are decoded before validation.
- **Measurement:**
  - exact fixture matching
  - two new fixtures, `fastapi-layered` and `spring-mappings`
  - `apps/web/e2e/ground-truth.mjs` scores pinned public repositories through the product ingest pipeline against `probes/ground-truth/*.json`, where every expected item cites its file and line

**Edge cases found and fixed.**
- **Existing URL bug:** `tree/main/%2E%2E/etc` was normalised by `URL()` and silently analysed ref `etc`. Encoded dot segments are now refused, like literal ones.
- **Held-out first run:** the two RealWorld repositories had truth written before the extractor ever ran on them. They found two general defects:
  - FastAPI settings inherited indirectly left `/api` as a placeholder: 0/19 exact, though all 19 routes were present.
  - Spring paths without a leading slash: 13/19.

  Both are fixed and both runs are published.
- **Recursion guards:** an `Annotated` alias referring to itself recursed without end, so a guard was added. Routers that include each other and dependency cycles also terminate.
- **Dangling edges:** a foreign key to a table outside the analysed source used to leave a dangling edge. It is now a gap.
- **Embedded-database detection:** my first check would have let an unrelated `*-url` setting hide an embedded database. It now looks only at datasource URLs (properties or nested YAML).

**Results** (endpoints / nodes / edges, recall at 100% precision unless noted):

| repository | before | after |
|---|---|---|
| FastAPI template | 0/23 · 7/12 · 0/16 (0% edge precision) | 23/23 · 10/12 · 12/16 |
| petclinic | 17/17 · 18/19 · 7/10 | 17/17 · 19/19 · 10/10 |
| fastapi-realworld (held out, endpoints) | 0/19 on first run | 19/19 |
| spring-realworld (held out, endpoints) | 13/19 on first run (68% precision) | 19/19 |

The remaining FastAPI-template misses (SMTP and Sentry behind helper functions) are recorded in `OPEN-GAPS.md`.

**Tests: 26 new.**
- Fixture tests now require an exact match.
- Coverage:
  - FastAPI edge cases: factory apps, constant prefixes, include and dependency cycles, self-referencing aliases, unresolved includes, two datastores, unknown foreign keys, inherited settings, conflicting defaults
  - Spring: slash rule, datasource-URL detection, profile-only URLs
  - scoped folders through the URL parser, ingest and the route
- 18 mutations, all caught:
  - include edge source; prefix composition
  - `yield`-bound classes; aliases; transitive chains
  - settings inheritance; conflicting defaults
  - decorator owner resolution; SQLModel tables; unknown foreign-key gap
  - include-cycle guard; alias-recursion guard
  - Spring slash rule; `mappedBy` skip; `ANY`; test-scope drivers
  - datasource-only URL detection; multiple class paths
- The `@` and encoded-dot tests failed before the fix.

Final checks:
- 1,076 hosted tests passed; local 1,052 passed with 24 expected skips
- all typechecks, an isolated production build and 18/18 benchmark selftests passed

**Live acceptance** (isolated production build on a loopback port, fake model with `ARCHWOVEN_DEMO_ACK=1`; ingest and extraction run for real in fake mode):
- **API:** importing the template `backend/` at the pinned commit succeeded and reported the resolved `/api/v1` default as a gap. This shows the new extractor runs inside the built server.
- **API, scoped folders:** both forms succeeded, `…/tree/master/packages/@secretlint/…` in the URL and `packages/@secretlint/…` in the subdirectory field.
- **Chrome, 4/4:** both scoped-folder forms imported from the workspace with no subdirectory refusal. The import showed the folder's own disclosures (6 masked secrets).
- **Withdrawn check:** an evidence-path check first passed vacuously, because fake mode's canned diagram has no evidence. It was removed rather than counted. Path scoping is covered by the ingest test.

Artifacts are in the session scratchpad (`gt`). Cloned repositories were read as data and never executed; no databases, credentials or cookies are published.

## Task 19 — evaluation oracle, provider results and review handoff

2026-10-17, America/Chicago. Branch `feat/evaluation`, based on merged PR #34 at `7c45d39`. Real-provider spend was approved up to $8. Results and method: [benchmarks/provider-eval/README.md](../benchmarks/provider-eval/README.md).

**Suite A oracle.**
- **Before:** the strict matcher compared lowercase labels. It rejected `Orders Service` (aliases `Order Service`, `Orders`) and `Catalog DB (PostgreSQL)` (alias `PostgreSQL`), so the report exited 1.
- **Matching:** whole names only, after normalising case, punctuation and a plural `s` per word, with parentheticals as alternative names. One node may now satisfy only one requirement, which is stricter than before.
- **Self-tests:**
  - the three real post-merge models now pass
  - `PostgreSQL Replica` is still rejected
  - `User Service` does not satisfy `User`
  - one node cannot satisfy two requirements; removing that rule fails the test
- **Receipts:** the original failing receipt is committed unchanged, together with a re-check of the same models. The report now exits 2: incomplete, with only the named visual reviews missing.

**Flaky tests, reproduced and removed.**
- **Gzip bomb test:** it compared wall-clock times, so CPU load could flip it. It now counts the bytes the inflater actually emits: more than the 32 MB cap, but within 4 MB of it. Removing the abort fails it with "inflated 1073741824 bytes for a 33554432-byte cap".
- **Repair self-test:** a loop that truncates and rewrites `packages/model/dist/index.js`, as a concurrent build does, reproduced the retained failure: 2 of 3 runs failed with the same signature. Suite A's self-test had the same latent race: 3 of 3 failed. Both self-tests now:
  - snapshot the validator once, after two identical reads and a clean import
  - pass that snapshot to every child run with `--validator`
  - print a child's stderr on failure

  Pinned repair receipts refuse `--validator` and still rebuild from source. Under the rewrite loop, both self-tests passed 4 of 4 runs (the repair self-test 5 of 5 in an earlier run).

**Provider evaluation.**
- **Harness:** `benchmarks/provider-eval/` drives a running server through the public API. Each case gets its own session and simulated network address. Per-call outcomes, repairs, tokens and cost come from the server's `call_log`, and latency is measured end to end.
- **Diagram scoring:** `score.mjs` scores imports with ground truth at diagram level, by evidence line or whole name, counting only source-supported claims toward precision. Its self-test is part of `pnpm bench:selftest`.
- **Dry run:** a fake-model run exercised every path first. Its fake Suite A receipt was deleted, not kept as evidence.
- **Port collision:** the first real launch collided with an unrelated server already on port 3034. The readiness check was answered by that server, and the driver stopped at opening the database before sending any request. The relaunch used a port confirmed free, and checked that the server held its own database.

**Results** (isolated production build, hosted `claude-opus-5-5`, cases run sequentially, $4.37 metered):
- **Descriptions:** 20/20 succeeded and 30/30 saved diagrams validate, but **0 of 20 descriptions and 0 of 4 imports were valid on the first attempt**. Refinements were 5 of 6.
- **Latency (p50 / p90):** descriptions 52.3 / 71.3 s, imports 74.6 / 98.6 s, refinements 4.3 / 9.2 s.
- **Cost:** $0.16 per description.
- **Cache:** estimated savings of $0.67, 21 % of description spend.
- **Suite A:** the semantic and validation gates passed 3/3.
- **Clarification:** none was asked. The vague "A blog." produced honestly labelled inferred and proposed parts, plus three open questions.
- **Diagram-level accuracy:**
  - FastAPI template: 10/12 nodes and 12/16 edges found (SMTP and Sentry, as in task 15); source-supported precision 10/10 nodes and 12/12 edges
  - petclinic: 19/19 nodes and 10/10 edges at 100 % precision
  - nothing extra was claimed as source-supported

**Root cause of first-attempt failures.** A diagnostic replayed four descriptions, one per diagram type (about $0.7 estimated, outside the metered run), and recorded each repair's validator feedback. The first schema-valid attempt always failed the same way: every `evidence` entry was free text, such as `["User: an HTTP controller"]`.

The hosted prompt still sends evidence as an opaque JSON-encoded string. That is a workaround for the API's structured-output grammar, which hosted generation does not use, so the model never sees the evidence shape. One diagnostic attempt also returned output that was not valid JSON. The fix is deliberately left to task 19b, so it can be measured against this unchanged baseline.

**Review handoff.** `benchmarks/ordinary-model-floor/review/` holds:
- the three Suite A diagrams at revision 1, before the run's refinements, captured in the hosted workspace as their owning session
- their models
- the defect checklist and the exact commands to record verdicts

Because the workspace opens a diagram's latest revision, the first capture showed the refined checkout diagram. The capture was redone from copies of revision 1 in the isolated evaluation database. That refined checkout diagram laid out right to left with a wrapping connection; it is listed in `OPEN-GAPS.md` for a reviewer to confirm. No visual verdict was recorded on anyone's behalf.

**Final checks:**
- 1,076 hosted tests passed; local 1,052 passed with 24 expected skips
- all typechecks passed
- Suite A self-test 25/25, scoring self-test, and repair self-test 37/37

App source is unchanged.

Artifacts outside version control are in the session scratchpad (`eval`). No database, key or session cookie is committed: the committed results contain prompts, model shapes, usage and diagrams only.

## Task 19b — hosted first-pass validity

2026-10-17, America/Chicago. Branch `fix/hosted-evidence-contract`, based on merged PR #35 at `77d0a25`. Real-provider spend was approved up to $1.50 for a subset. Details: [benchmarks/provider-eval/README.md](../benchmarks/provider-eval/README.md).

**Before.** Task 19 measured 0 of 20 hosted descriptions and 0 of 4 imports valid on the first attempt. Every first schema-valid attempt carried free-text evidence, because the hosted prompt described `evidence` as an opaque JSON-encoded string. That encoding is a workaround for the API's structured-output grammar, which hosted generation does not use. The grammar schema (`faithfulSchema`) is now referenced only by its own test; it is pre-existing and left in place.

**Changes.**
- **Shared contract:** hosted descriptions (`STABLE_SYSTEM`) and imports (`REPO_SYSTEM`) use the same native-values contract as the local model, so evidence objects, ER fields and sequence values are visible. The wire decoder stays, so older-style output still parses. The prompt is 130 characters smaller.
- **Fence unwrap:** a measured second cause was complete models wrapped in one Markdown code fence. `unfenced` removes exactly that wrapper before parsing on both paths; prose around the JSON, or two fenced blocks, still go through repair. Refinement and expansion use the API grammar and are unchanged.

**Tests and mutations.**
- One existing test asserted the hosted contract contained `evidenceJson`, which pinned the defect; it is replaced.
- New tests check that:
  - the hosted contract shows the evidence, field and sequence shapes
  - native evidence passes with no repair, while wire output still decodes
  - the import contract shows the evidence shape
  - a fenced answer needs no repair, for descriptions and imports
  - text around a fence, or two fenced blocks, still triggers a repair
- Before the changes, the contract tests and the fence tests failed. Restoring an encoded evidence key in the import prompt fails its test.

Final checks:
- 1,080 hosted tests passed; local 1,056 passed with 24 expected skips
- typechecks and selftests passed
- the isolated production builds used for the runs succeeded

**Live measurement** (isolated production builds on loopback, hosted `claude-opus-5-5`, ports confirmed free and each server confirmed to hold its own database):
- **Same 7 descriptions:**
  - first-attempt validity 0/7 → 3/7 with the contract fix → 7/7 with both fixes
  - median latency 33.8 → 19.4 → 14.2 s
  - cost $0.76 → $0.48 → $0.27
  - every diagram validates; Suite A gates passed 3/3 in both runs
- **Diagnostics:** a two-step diagnostic attributed the remaining repairs to fenced output. It cost about $0.21 (estimated), outside the metered runs.
- **Import and refinement:** both ran before the fence fix. The import kept its task 19 accuracy at 100 % source-supported precision, but needed one repair. Import first-pass validity after both fixes is unmeasured and recorded in `OPEN-GAPS.md`.
- **Spend:** $0.97 metered, plus about $0.21 estimated.

Artifacts outside version control are in the session scratchpad (`eval`, `eval2`, `eval3`). Committed results contain prompts, model shapes, usage and diagrams only.

## Task 20a — workspace fixes from earlier acceptance passes

2026-10-17, America/Chicago. Branch `fix/ui-acceptance-gaps`, based on merged PR #36 at `5ca77c8`. Four gaps recorded during tasks 8–10b are closed.

**Changes.**
- **Refinement status:** the full reason is a live `role="status"` region that wraps at any width. Before, it was cut to one 260 px line, with the rest only in a hover title.
- **Touch targets:** every refine-bar control (input, Refine, Undo, SVG, PNG, JSON, Delete) is at least 44 px tall. Before, they were 34–36 px.
- **Camera on resize:** when the canvas changes size, the diagram refits instantly, keeping any chapter focus, unless the user has panned or zoomed since the last fit. A user-placed camera stays put, and Fit View hands control back to automatic fitting. React Flow reports user moves with an event and programmatic fits without one, so the two are told apart reliably.
- **Pasted links:** a `#model=` link pasted into an open tab opens that diagram without a reload. The workspace records the id each load asks for, so hash updates it makes itself never trigger a reload, regardless of render timing.

**Tests.**
- 8 new tests:
  - camera: refit on shrink, ignore an unchanged size, keep a user camera, programmatic moves don't count, Fit View resumes auto-fitting
  - pasted links: a different diagram loads, the same diagram doesn't reload
  - status: a live status region with no truncation
- These failed before the change. Removing the hash listener, or the same-diagram guard, fails the link tests.
- **Test bugs fixed along the way:**
  - the first link test checked the model `title`, which the workspace does not display; it now checks content unique to the second diagram
  - the first browser driver zoomed with the canvas below the fold at phone width, so the wheel scrolled the page
- **First implementation flaw:** it compared against a ref that updates only on re-render, and repeated hash events caused four loads of one diagram. It now compares against the requested id.

**Final checks:**
- 1,086 hosted tests passed; local 1,062 passed with 24 expected skips
- typechecks and selftests passed
- the isolated production build succeeded

**Browser acceptance** (`apps/web/e2e/ui-acceptance.mjs`: Playwright 1.63 Chromium and WebKit, Safari's engine, against a fake-model server; the same driver was also run against an unmodified `main` build):

| check (Chromium and WebKit) | main | this branch |
|---|---|---|
| refine-bar controls ≥ 44 px at 1440 and 390 px | 34–36 px | pass |
| refusal is a live status, complete and wrapped at 390 px | not a status, 1 line, cut off | 4 lines, complete |
| diagram stays in view after shrinking 1440 → 390 px | 7 of 7 nodes off-screen | 0 off-screen |
| a user-zoomed camera is kept on resize | pass | pass |
| a pasted `#model=` link opens that diagram | fail | pass |

**Gaps list.** The four rows are removed from `OPEN-GAPS.md`. One related gap is added: a pasted link to the same diagram that changes only `view`, `focus`, `lens`, `route` or `chapter` is not applied until reload.

Firefox, real Safari, physical touch and screen readers are not covered here; they belong to task 20b. Artifacts are in the session scratchpad (`ui`, `pw`).

## Task 19b follow-up — hosted import first-pass validity

2026-10-17, America/Chicago. The four pinned repository imports from the task 19 baseline were re-run against `main` at `43dbc19`, with the owner-approved cap of $1. The run used an isolated production build on a free loopback port, hosted `claude-opus-5-5`, and real mode confirmed through `/api/config` (`fake: false`) before starting. Results: [benchmarks/provider-eval/README.md](../benchmarks/provider-eval/README.md).

**Results:**
- **First attempt:** 3 of 4 imports were valid on the first attempt; the baseline was 0 of 4.
- **Latency and cost:** the median fell from 74.6 s to 35.1 s, and total cost from $1.09 to $0.67, which is the entire spend.
- **Validity and accuracy:** all four diagrams validate. Diagram-level accuracy against ground truth is unchanged (template 10/12 nodes and 12/16 edges, petclinic 19/19 and 10/10, both at 100 % source-supported precision).
- **The remaining repair:** spring-realworld still needed one repair round. It was not diagnosed, because a diagnostic would have exceeded the cap; the gap row in `OPEN-GAPS.md` replaces the "unmeasured" row.

The server and worktree were removed afterwards. The committed results contain the repository URLs, model shapes, usage and diagrams only.

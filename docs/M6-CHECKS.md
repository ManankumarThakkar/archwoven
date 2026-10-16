# M6 release-hardening checks

Historical deterministic snapshot; subsequent real-provider checks and approved broader repository support are recorded in [live checks](LIVE-CHECKS.md).

Run date: 2026-10-15. Branch: `feat/m6-release-hardening`. Changes remain uncommitted; these are working-tree checks, not evidence pinned to a release revision. The intentional starting diff was preserved. No commits, PRs, paid provider calls or live local inference were performed.

**Verdict: PASS for deterministic implementation checks and the fixture browser walkthrough. Release-evidence eligibility remains PENDING until a clean committed revision produces a valid Suite B receipt. Live provider convergence remains unverified.**

## Verification gates

| Command | Actual outcome |
|---|---|
| `pnpm test` | PASS — 44 files, 381 tests |
| `ARCHWOVEN_MODE=local pnpm test` | PASS — 43 files passed, 1 skipped; 366 tests passed, 15 expected hosted-only skips |
| `ARCHWOVEN_NEXT_DIST_DIR=.next/m6-build pnpm build` | PASS — all package builds and production Next build; isolated output avoids the existing development server |
| `pnpm typecheck` | PASS — all workspaces |
| `pnpm bench:selftest` | PASS — 18 checks |
| `node benchmarks/repair-rounds/harness.selftest.mjs` | PASS — 36 checks |
| `git diff --check` | PASS |
| Suite B `verify --scratch --results-dir /tmp/archwoven-m6-artifacts/suite-b-scratch --runner m6-check` | PASS execution — 8/8 cases, explicitly scratch/dirty and ineligible as release evidence |
| Suite B scratch `report` | Expected exit 2 — coverage 8/8, first disclosure 6/8 (75%), actionability 4/8 (50%); scratch provenance prevents eligibility |
| Suite B default pinned `verify` on this worktree | Expected refusal (exit 1): source is dirty |
| Suite B historical committed receipt `report` | Expected exit 2: missing clean-source provenance; old receipt remains unchanged |

Regression tests were run failing before their fixes. An intermediate local run caught a hosted-only privacy expectation in a newly added repository test; the expectation now follows deployment mode. Subsequent full hosted/local runs above are green. A fresh review also found hosted wire instructions leaking into native local prompts; model generation, repository assembly and refinement now each send a prompt matching their actual local schema, with request-contract regression coverage.

## Exact release gaps

1. **Restoration:** `loadModel` now restores model identity, revision history, view and success/partial workspace state before mounting the canvas. Addresses carry `model` and optional `view`; explicit links take priority over tab history. Focus/lens/route/chapter are read after the model loads. Inaccessible and legacy context-only links show recovery guidance. The model API owner check is unchanged. Page/state tests cover restoration and failures; the browser covered reload and a fresh authorized tab.
2. **Repository shape drift:** prompts now include a schema-derived contract and valid view/privacy/open-question instructions. Hosted model generation keeps its no-grammar constraint. The synthetic `petclinic-schema-drift.json` reproduces the reported invalid view, membership, extra-key and privacy shapes; it is not a captured live response. Tests prove bounded repair, explicit exhaustion, complete usage accumulation, correct credits and one refund. Successful assembly after cancellation is metered without taking settlement back from cancellation.
3. **Focus/lens:** finder, outline and initial hash restoration reconcile an incompatible lens. The focused node becomes visible; compatible lenses remain selected and URL/UI agree.
4. **Relationship/route:** successful route start clears relationship selection, inspector and relationship hash. Unrelated edges stay dim during playback.
5. **Pulses:** dimmed edges, including relationships filtered by a lens endpoint, have neither pulse classes nor React Flow animation. CSS defensively excludes dimmed edges. Still stops every pulse and animated edge.
6. **Finder scrolling:** arrow navigation calls `scrollIntoView({ block: 'nearest' })` on the active result and retains input focus. A touch-accessible button opens the same finder.
7. **Hash encoding:** readable commas apply only to `lens`; unrelated encoded commas survive. Component tests exercise actual hash writes.
8. **390px overflow:** global border-box sizing, bounded panels/selects and wrapped header/refine controls remove the 32px overflow. The toolbar occupies layout space. Both empty and generated document widths measured exactly 390px.
9. **Suite B:** expected codes and substrings must match distinct real diagnostics. Percentages use the manifest denominator; missing cases are named and unknown rows excluded. Scratch/legacy receipts cannot assert clean pinned evidence. A clean committed-source regeneration is deliberately deferred; see the harness README.
10. **Evidence:** this document, `M6-MATRIX.md`, R28–R37 in `TRACEABILITY.md` and the incremental PR plan now connect implementation to measured outcomes.

Additional browser regression: switching from a service lens/focus to the data model previously dimmed all entities and retained a stale inspector/route. Transition-specific reconciliation now drops invalid context and keeps compatible state. Six rerender tests cover this; the browser confirmed all three ER nodes visible, chapter reset, inspector cleared and invalid route action disabled. Initial full-link restoration remains covered separately. Camera fitting now waits for each new view/revision layout and preserves chapter framing; three camera regressions cover this. A browser ER-to-architecture switch placed all seven visible-view nodes within the canvas. Dark canvas controls match the workspace; the minimap is reserved for larger views to avoid covering small diagrams.

## Fixture browser walkthrough

Chrome, desktop and 390 × 844. The isolated loopback server used `ARCHWOVEN_FAKE=1`, `ARCHWOVEN_DEMO_ACK=1`, `ARCHWOVEN_NEXT_DIST_DIR=.next/m6-browser`, port 3015 and a separate database under `/tmp/archwoven-m6-artifacts`. The header visibly identified demo data. The existing port-3000 server was not stopped. Only servers started for this verification were stopped afterward.

| Check | Observed result |
|---|---|
| Example prefill | Support example populated the input; no generation until the primary button was selected |
| Fixture generation | POST generate 202; polling/model fetch 200; canvas mounted; simulated quota 6 → 5, zero model calls |
| Finder `/` and touch button | Palette opened, typed search and Enter focused Customer; incompatible service lens cleared; node opacity 1 |
| Finder list overflow | Valid extended fixture with 30 additional terminal services: list content 1007px, viewport 220px, scrollTop 351px after 20 arrows; active result visible, input focus retained |
| Outline | Desktop Order Service selection focused it and opened the matching inspector |
| Relationship passport | Edge selection showed endpoints, type, provenance and evidence count |
| Route playback | Order Service → Stripe cleared the previous passport; unrelated edge had `aw-dim-edge`, not `aw-edge-focus` |
| Chapter | Request path selected and narrative note shown; restored selected chapter after reload/fresh-tab load |
| Still | Zero `.aw-pulse` and zero animated edges |
| Reload | Saved model mounted without generating; route/chapter restored and quota stayed 5 |
| Fresh authorized tab | Explicit model, focus, service lens, route and chapter all restored; canvas and controls mounted |
| Ownership | Request for the fixture model without its owning cookie returned 404; an inaccessible model link showed recovery guidance rather than another saved diagram |
| View switching | Architecture, sequence and data model rendered; invalid channels cleared on transition to ER; compatible channels covered in component tests |
| Mobile empty/generated | `innerWidth = scrollWidth = 390`; empty header and aside widths also 390; no horizontal clipping in checked controls |

The component tests substitute canvas geometry/React Flow rendering, so the real-browser walkthrough supplies the layout and actual-scroll evidence. It does not establish physical-device touch or assistive-technology compatibility.

## Console, network and limitations

- In the isolated final server log, only the two deliberately unauthorized/missing model requests returned 404. No unexpected application 4xx/5xx was observed. Initial development setup had transient route 404s before build output was isolated; the final walkthrough used separate output.
- Browser logs contained a failed dynamic import from a `chrome-extension://` URL, a hydration warning listing extension-injected `data-gr-*` body attributes, the existing React Flow hidden-attribution warning, and a nodeTypes warning during hot reload. `nodeTypes` is module-scoped. These observations are retained; this is not a claim of a completely warning-free browser.
- The prior paid public repository import failed validation. It was not repeated. Deterministic repair and accounting tests establish the failure/repair contract, not real-provider convergence or extraction precision.
- Native local schema/prompt consistency passed deterministic adapter tests. Live Ollama convergence after this correction was not run; older M5 results are historical evidence only.
- No new clean pinned Suite B release receipt exists. Regenerate after the harness and dependencies are committed and the source checkout is clean; submit the receipt separately.
- Physical mobile, cross-browser, screen-reader and a full accessibility audit were not performed. Export/refine behavior is covered by existing automated suites; this browser pass did not download every export or run live refinement.

## Session artifacts

Not committed: `/tmp/archwoven-m6-artifacts/` contains `desktop-empty.png`, `desktop-generated.png`, `mobile-empty.png`, `mobile-generated.png`, `mobile-finder-scroll.png`, test/build/typecheck/selftest logs, the isolated server log/database, synthetic finder seed script, scratch receipt and starting-worktree patch. These local temporary artifacts are not durable release evidence.

Incremental delivery and remaining release tasks: [M6 PR plan](M6-PR-PLAN.md).

# M6 verification matrix

Historical snapshot. Current merged-source verification, superseded blockers and remaining work: [post-merge audit](POST-MERGE-AUDIT.md).

Historical deterministic snapshot, 2026-10-15. Subsequent real-provider coverage and approved broader repository support: [live checks](LIVE-CHECKS.md). PASS denotes the evidence named in the row; it does not imply an unrun live model call passed.

| Requirement | Regression evidence | Browser evidence | Status / limit |
|---|---|---|---|
| Reload usable saved diagram | `workspace/page.test.tsx`, `states.test.ts` | Reload mounted fixture canvas without a generation | PASS |
| Model-aware link + ownership | Page priority/failure tests; `api/models/[id]/route.test.ts` | Fresh authorized tab restored context; no-owner HTTP request 404 | PASS; links do not grant access |
| Focus/lens/route/chapter restoration | Page hash preservation and viewer mount tests | Full model-aware link restored all four controls/state | PASS |
| Repo output contract / bounded repair | LLM client/repo tests and synthetic PetClinic drift fixture | Not repeated with paid provider | PASS deterministic; live convergence UNVERIFIED |
| Failed/cancelled output accounting | Repo route integration: repairs/exhaustion/cancel, credits and call log | No paid call | PASS deterministic |
| Native local contracts | Local request-format/prompt tests for generate/repo/refine, defaults, evidence/sequence/patch | No live inference | PASS deterministic; live local convergence UNVERIFIED |
| Lens-safe focus | Finder/outline/restored-focus component tests | Customer opacity 1 after service-lens focus | PASS |
| Route replaces stale relationship | Motion/Still component tests | Passport cleared; unrelated edge dim | PASS |
| Pulses obey focus/lens/motion | Viewer/pulses/motion tests; defensive CSS | Zero dim pulses; Still zero pulses/animated edges | PASS |
| Finder scroll and touch access | Active-result effect + button component tests | 37 visible-view nodes; scrollTop 351, selected row visible, input focused | PASS |
| Encoded hash comma isolation | Real component hash-write test | URL context survived links/reload | PASS |
| View-transition coherence | Six Canvas rerender regressions and three camera regressions | ER nodes visible; invalid inspector/lens/chapter/route cleared; new layout fitted within canvas | PASS |
| 390px empty/generated layout | Browser measurement supplies geometry | Width 390 = document 390 in both states; header/aside fit | PASS for Chrome at checked viewport |
| Starting guidance / input semantics | Existing prefill/state tests plus labeled real-browser controls | Example prefill only; primary action; descriptive empty state | PASS walkthrough; full accessibility audit NOT RUN |
| Suite B diagnostic codes | Selftest rejects wrong code and duplicate expectations | Not applicable | PASS |
| Suite B coverage denominator | Selftest partial 1/8 and unknown-row exclusion | Not applicable | PASS |
| Suite B release evidence provenance | Dirty verify refusal; scratch/legacy report exit 2; synthetic clean-provenance selftest | Not applicable | PASS guards; actual pinned receipt PENDING |
| Broader gates | Hosted 381/381; local 366 passed + 15 expected skips; build; typecheck; Suite A 18; Suite B 36 | See checks transcript | PASS |

## Suite B diagnostic run (not release evidence)

| Metric | Measured value |
|---|---|
| Manifest coverage | 8/8 |
| Cases passing deterministic oracle round trip | 8/8 |
| Rounds to pass, manifest order | 3, 2, 3, 3, 2, 3, 2, 2 |
| First disclosure | 6/8 (75%) |
| Detection stage | Graph 6; schema 2 |
| Rules-only repair actionability | 4/8 (50%) |
| Source provenance | Dirty, scratch |
| Release evidence eligible | **No** — report exit 2 |

No new receipt claims to pin uncommitted harness code. Historical receipt remains unchanged and ineligible. See [Suite B regeneration](../benchmarks/repair-rounds/README.md) and [M6 checks](M6-CHECKS.md) for commands, browser observations, console warnings and unverified coverage.

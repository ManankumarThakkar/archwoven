# M6 incremental delivery

Status: implementation merged through PR #9 at `d6f28bcd`. The tables below retain the delivery plan. Use [post-merge audit](POST-MERGE-AUDIT.md) for the current backlog and fresh checks. The clean Suite B receipt is included with the post-merge audit follow-up.

The remaining implementation is delivered on `feat/m6-release-hardening` in focused commits, with one review checklist covering the boundaries below. The tables retain the intended task order and acceptance gates; commit groups combine shared-file changes where necessary. Each group includes its regression tests and relevant traceability rows. Do not stage `.env.local`, databases, screenshots, generated build output, or scratch receipts.

| Order | Proposed PR | Tasks and boundary | Acceptance gate |
|---|---|---|---|
| 1 | Runtime readiness and job recovery | Failed/cancelled input-key retries with preserved history; dev startup rebuilds internal packages; existing configuration gates in config/generate/refine/repo routes; server readiness copy; instrumentation boot recovery; jobs store changes; environment example; Vitest configuration/setup; isolated Next output option. Keep hosted privacy, quotas and no-key refusal intact. | Route/config/mode/store tests; no-key 503 before reservation; both deployment modes. |
| 2 | Schema-consistent model generation | `packages/llm`: hosted textual schema contract, local native schema contracts, strict validation and bounded repairs; synthetic repository drift fixture. Repo route tests and cancellation usage settlement. Stage these hunks separately from PR 1 in shared files. | LLM tests and repository integration tests in both modes. Wrong shape repairs or explicitly fails; all attempts metered; failure/cancel refunded once. |
| 3 | Reliable saved diagrams and viewer interactions | Workspace state/reload restoration, model/view references in links, owner-checked load errors; focus/lens, route/relationship coherence, visible-edge pulses, finder scrolling and touch button. Include `happy-dom`, lockfile and component regressions. | Workspace component/logic suites; model ownership API tests; fresh authorized tab + reload with focus/lens/route/chapter. |
| 4 | A clearer, responsive workspace | Existing dark theme, stronger starting guidance, type-specific examples, labeled fields, primary action, helpful canvas preview, header wrapping, static viewer toolbar, refine/export wrapping and border-box sizing. Include the README walkthrough. Shared page/Canvas/CSS changes must be staged after PR 3; review the combined result at 390px. | Desktop + 390px empty/generated screenshots; document width equals viewport; accessible control labels; build/typecheck. |
| 5 | Trustworthy Suite B reporting | Four files under `benchmarks/repair-rounds`: diagnostic codes, distinct matches, manifest denominator, missing/unknown coverage, clean-source provenance, scratch mode, documentation and selftests. Include the CI selftest hook from the starting batch. | Suite B 36-check selftest; dirty pinned verify refuses; old receipt report is ineligible. No replacement release receipt yet. |
| 6 | Release evidence and traceability | `M6-CHECKS.md`, `M6-MATRIX.md`, applicable R28+ rows, this delivery plan and the README status/evidence links. Record the actual merged implementation revisions and refresh checks after earlier PRs land. | Hosted/local tests, build, typecheck, Suite A/B selftests, browser evidence; no unrun live claims. |
| 7 | Pinned Suite B evidence | Once PR 5 and its dependencies are committed and the checkout is clean, follow `benchmarks/repair-rounds/README.md` to build and regenerate a receipt with a distinct runner identifier. Submit only the receipt in this later PR. | Receipt pins the actual harness revision and rebuilt validator; report exits 0; the earlier receipt remains historical. |

PRs 1–2 stabilize generation; PRs 3–4 improve the user journey; PR 5 can be reviewed independently of the UI. Keep each description focused on product behavior and its verification. Design references informed layout and interaction decisions; no third-party code or assets were copied.

## Follow-up tasks outside this batch

- Real hosted generation and repository checks are recorded in [live checks](LIVE-CHECKS.md); preserve those separately from the earlier deterministic snapshot.
- Run live local generation/refinement after the native prompt/schema correction if local model runtime validation is required for release.
- Full assistive-technology, physical touch-device and cross-browser checks remain separate coverage.

## Approved broad-repository follow-up

The following approved scope expansion is included with the foundation above. Review extraction, evidence assembly, workspace behavior and live verification as separate task groups.

| Order | Proposed PR | Tasks and boundary | Acceptance gate |
|---|---|---|---|
| 8 | Bounded source maps for public repositories | Generic extractor, deterministic representative sampling, exclusions, module/import evidence, unsupported and mixed repo routing; preserve specialized paths. | Extract/ingest tests, adversarial comments and string examples, archive/SSRF limits unchanged. |
| 9 | Evidence-checked source assembly | Bounded source context in hosted/local prompts, shared citation/identity/import validation, server-preserved coverage questions, commit pinning. | Both adapter suites; reject invented runtime edges and citations outside observed sample; real generic and specialized repo checks. |
| 10 | Honest real-mode workspace and exports | General repository copy, explicit fixed-sample demo warning, request/poll/refine failure handling, bundled PNG fonts, development/production output isolation. | Workspace regressions, real browser generation/refine/undo/download, responsive review. Stage shared page hunks separately from PRs 3–4. |
| 11 | Real-provider verification and run guide | Live case matrix, actual repair/latency accounting, public-repo evidence examples and known bounds; README real-key commands. | Re-run relevant checks on final implementation; keep historical fixture results distinguishable. |

The goal covers descriptions and repositories across languages. The generic path is a bounded static code map, not proof of complete runtime architecture. Expand parser depth and coverage caps in separate measured changes rather than making unsupported completeness claims.

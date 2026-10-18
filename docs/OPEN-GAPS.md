# Open gaps and follow-ups

A single, living list of known gaps that are not yet fixed, so none is lost between tasks. Each entry links to where it was found. When a gap is fixed, delete its row in the same PR; when one is found, add it here in the PR that found it.

Last reviewed: 2026-10-17, after PR #46 (main `ddd4b8a`) and the import repair diagnosis. Current evidence and its limits are recorded in [RELEASE-ACCEPTANCE.md](RELEASE-ACCEPTANCE.md). Release tasks refer to `RELEASE-PROGRESS.md`.

## Scheduled into a release task

| Gap | User impact | Found in | Planned |
|---|---|---|---|
| Named-person visual reviews of the Suite A diagrams are missing | Evaluation not eligible for publication | Post-merge audit | Owner review: three historical screenshots and matching models are now tracked, checksum-checked in CI and linked from `benchmarks/ordinary-model-floor/review/README.md`; verdicts still pending |
| After the run's refinement added a notification service, the checkout diagram laid out right to left with a connection wrapping around the group (observed in a screenshot, not yet confirmed by a reviewer) | Refined diagrams may read backwards | Task 19 review capture | Confirm during visual review; then Task 20 |
| Firefox and the Safari application are unverified: Playwright WebKit passed downloads, axe and keyboard checks, but Playwright's Firefox build would not start on this macOS 27 machine | Exports and keyboard use are unproven in Firefox and real Safari | Tasks 9 and 20h | Run `apps/web/e2e/browser-acceptance.mjs` where Playwright Firefox starts, and with Safari after `safaridriver --enable` |
| Physical touch and screen-reader acceptance not run (automated axe WCAG 2.1 A/AA and keyboard checks pass in Chromium and WebKit) | Accessibility for assistive technology and real touch devices is unproven | All UI tasks; task 20h | Owner: VoiceOver on macOS/iOS and a phone or tablet pass |
| Full local-model inference inside Docker Compose has not been exercised | Private-mode model quality remains unverified in the container | Tasks 11 and 13; task 20d | CI now exercises real Compose startup, private request checks, read-only Git ingestion and the missing-model failure/retry path without downloading a model; successful model inference is separate |

## Not yet scheduled (needs a decision)

| Gap | User impact | Found in | Notes |
|---|---|---|---|
| Hosted imports occasionally need one repair round: 5 of 6 import runs since the task 19b fixes were valid on the first attempt; the one repair (spring-realworld) did not recur in two re-runs | An occasional import costs a repair round (up to about 90 s and $0.32) | Task 19b import re-runs | Not reproducible within the approved budget; run evaluations with `benchmarks/provider-eval/capture-repairs.mjs` so the next occurrence records its cause |
| Node and edge ground truth exists only for the two repositories used while fixing the extractors; held-out truth covers endpoints only | Diagram and extraction accuracy on unseen repositories is unmeasured beyond endpoints | Tasks 15 and 19 | Needs hand-authored truth for new held-out repositories |
| Third-party SDK clients reached through helper functions (SMTP via `emails`/`smtplib`, Sentry) are not extracted | External services such as email delivery are missing from FastAPI diagrams | Task 15 ground truth (full-stack template) | Needs call-graph inference; candidate for a later extractor pass |
| FastAPI dependencies built by factory calls (`Depends(get_repository(UsersRepository))`) are not resolved | Repository/service links behind parameterised dependency factories are missing | Task 15 held-out reading (fastapi-realworld) | Same call-graph limitation; disclosed only implicitly by the missing edges |
| Rectangular boundary boxes can be suppressed when a flat layout cannot represent their membership truthfully | Membership is disclosed in a warning instead of an enclosure | Tasks 10 and 20f | No unrelated nodes are enclosed; automatic compound/grouped layout remains a future enhancement |
| Schema v1 stores manual positions in one global node-id map | Dragging a node in one view moves it in other graph views | Tasks 6 and 8 | Disclosed in the orientation control; a per-view layout needs schema v2 |
| Removing a link between two source-backed nodes reports both the edge and the path refusal | Accurate but verbose message | Task 10b | Copy refinement only |
| Branch names containing `/` are ambiguous with subdirectories in GitHub URLs | Such branches must be given as a commit SHA | M3 | Documented in the URL parser |
| Hosted IP-based limits depend on one proxy appending `X-Forwarded-For` | Without it, scripted cookie-less requests are bounded only by burst-per-session and the daily stop-loss | Task 18 | Deployment requirement; document with the hosted deployment guide |
| Abuse escalation ladder (challenges, temporary and permanent blocks) | Determined abusers can still consume up to the stop-loss each day | Release decisions; SPEC §15 | Deferred until metering shows the revisit triggers in SPEC §15 |
| Jobs are coordinated in a single process | Horizontal scaling would need a distributed registry | Cancellation follow-up | Deployment limitation |
| The stop-loss cannot include usage a provider never reported, or usage lost when a process dies | Spend estimate can undercount | Task 14 | Provider invoice is authoritative |
| Secret detection is best-effort; novel or split credential formats can evade it | A rare secret could reach the hosted provider | Task 17; threat model T4 | Residual risk, accepted |
| Native local model output varies (occasional omitted semantics, extra repairs) | Some local runs need a retry | Tasks 4, 7, 10b | Track in task 19 measurements |

## Owner tasks before the repository goes public

- Name, domain and trademark clearance (SPEC §1, §14).
- Tune anonymous credit limits after two weeks of live usage data (SPEC §15).
- Delete the stale ignored build folders `apps/web/.next-live`, `.next-live-v2`–`v4`, `.next-postmerge` and `.next-pr-check` (about 1 GB, built 2026-10-15) after stopping the servers on ports 3020 and 3021, which started right after `.next-postmerge` was built and may serve one of them. They are not tracked by git; nothing in a fresh clone depends on them.

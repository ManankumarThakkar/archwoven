# Open gaps and follow-ups

A single, living list of known gaps that are not yet fixed, so none is lost between tasks. Each entry links to where it was found. When a gap is fixed, delete its row in the same PR; when one is found, add it here in the PR that found it.

Last reviewed: 2026-10-17, after PR #38 (main `68df6cc`) and the task 20c export-context fix. PR #38's CI passed; detail exports now retain inferred-node borders, parent context and the repository inference disclaimer. Docker Compose, cross-browser and human acceptance remain outstanding. Release tasks refer to `RELEASE-PROGRESS.md`.

## Scheduled into a release task

| Gap | User impact | Found in | Planned |
|---|---|---|---|
| Named-person visual reviews of the Suite A diagrams are missing | Evaluation not eligible for publication | Post-merge audit | Owner review: three historical screenshots and matching models are now tracked, checksum-checked in CI and linked from `benchmarks/ordinary-model-floor/review/README.md`; verdicts still pending |
| After the run's refinement added a notification service, the checkout diagram laid out right to left with a connection wrapping around the group (observed in a screenshot, not yet confirmed by a reviewer) | Refined diagrams may read backwards | Task 19 review capture | Confirm during visual review; then Task 20 |
| Safari/Firefox download behaviour (deferred object-URL revoke) unverified | Exports may fail on WebKit | Task 9 | Task 20 |
| Physical touch, screen-reader and cross-browser acceptance not run | Accessibility and device support unproven | All UI tasks | Task 20 |
| Docker Compose runtime never run (loopback port binding, git in image, repos mount) | Private-mode Docker path is unverified | Tasks 11 and 13 | Task 20 |
| Clean-install rerun and documentation/file cleanup (historical plans, scratch references, stale ignored `apps/web/.next-*` build folders from earlier verification runs) | Repository not release-tidy | Post-merge audit; task 18 | Task 20 |

## Not yet scheduled (needs a decision)

| Gap | User impact | Found in | Notes |
|---|---|---|---|
| A pasted link that keeps the same diagram but changes only `view`, `focus`, `lens`, `route` or `chapter` is not applied until reload | Deep links into a different part of the open diagram look ignored | Task 20a | The 20a fix loads a different diagram; per-view deep-link changes need their own handling |
| Hosted import first-pass validity after the task 19b fixes is unmeasured (the one import measured ran before the fence fix and needed a repair); the description rate comes from 7 cases | Imports may still pay a repair round | Task 19b | Include imports in the next provider evaluation run |
| Node and edge ground truth exists only for the two repositories used while fixing the extractors; held-out truth covers endpoints only | Diagram and extraction accuracy on unseen repositories is unmeasured beyond endpoints | Tasks 15 and 19 | Needs hand-authored truth for new held-out repositories |
| Third-party SDK clients reached through helper functions (SMTP via `emails`/`smtplib`, Sentry) are not extracted | External services such as email delivery are missing from FastAPI diagrams | Task 15 ground truth (full-stack template) | Needs call-graph inference; candidate for a later extractor pass |
| FastAPI dependencies built by factory calls (`Depends(get_repository(UsersRepository))`) are not resolved | Repository/service links behind parameterised dependency factories are missing | Task 15 held-out reading (fastapi-realworld) | Same call-graph limitation; disclosed only implicitly by the missing edges |
| Boundaries are drawn after layout, so a boundary box can visually enclose non-members (all views) | Diagrams can imply wrong grouping | Task 10 step 2 | A grouped (compound) layout would fix this and enable real containers for internals; touches shared layout and routing |
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
- Add a LICENSE file (none exists).
- Tune anonymous credit limits after two weeks of live usage data (SPEC §15).

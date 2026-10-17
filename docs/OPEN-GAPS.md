# Open gaps and follow-ups

A single, living list of known gaps that are not yet fixed, so none is lost between tasks. Each entry links to where it was found. When a gap is fixed, delete its row in the same PR; when one is found, add it here in the PR that found it.

Last reviewed: 2026-10-17, after PR #30 (main `2fc0168`). Release tasks refer to `RELEASE-PROGRESS.md`.

## Scheduled into a release task

| Gap | User impact | Found in | Planned |
|---|---|---|---|
| Exhausted-credit message advertises a GitHub sign-in that does not exist | Misleading copy for hosted users | Post-merge audit | Task 18 |
| SPEC §15 still describes anomaly challenges and bans that are deliberately deferred | Spec and product disagree | Release decisions (2026-10-17) | Task 18 (narrow SPEC) |
| Subdirectory paths with `@` segments are rejected (`packages/@scope/name`) by both `safeSubdir` and the URL parser | Scoped-package folders in JavaScript monorepos cannot be imported | Task 17 live check | Task 15 |
| FastAPI custom router binding, `yield`-based `Depends`, Spring method-level `@RequestMapping` with multiple paths, endpoint scoring | Some framework routes and dependencies are missed | M1 ledger; post-merge audit | Task 15 |
| No hand-checked ground truth; extraction precision/recall is unmeasured | Coverage claims cannot be quantified | Post-merge audit | Task 15 |
| Suite A oracle rejects valid alias matches (`Orders Service`, `Catalog DB (PostgreSQL)`); report exits 1 | Evaluation understates quality | Post-merge audit | Task 19 |
| Named-person visual reviews of benchmark diagrams are missing | Evaluation not eligible for publication | Post-merge audit | Task 19 |
| Timing-ratio gzip test and one repair selftest case failed once under concurrent build load | Occasional flaky CI signal | Cancellation and direct-edit follow-ups | Task 19 |
| Representative hosted efficiency results (first-pass validity, latency tails, cache savings) not measured | No published performance evidence | Post-merge audit | Task 19 |
| Refine status text is truncated to one line; full reason only on hover | Refusals and errors are hard to read, especially on touch devices | Task 10b | Task 20 |
| Canvas keeps its earlier camera after the viewport shrinks | Part of the diagram is off-screen after resizing or rotating | Task 10 step 1 | Task 20 |
| Export buttons are 34 px tall, below the 44 px touch target | Harder to tap on phones | Task 9 | Task 20 |
| Changing only the `#model=` hash in the same tab does not load the new model until reload | Pasted links in an open tab look broken | Task 8 | Task 20 |
| Safari/Firefox download behaviour (deferred object-URL revoke) unverified | Exports may fail on WebKit | Task 9 | Task 20 |
| Physical touch, screen-reader and cross-browser acceptance not run | Accessibility and device support unproven | All UI tasks | Task 20 |
| Docker Compose runtime never run (loopback port binding, git in image, repos mount) | Private-mode Docker path is unverified | Tasks 11 and 13 | Task 20 |
| Clean-install rerun and documentation/file cleanup (historical plans, scratch references) | Repository not release-tidy | Post-merge audit | Task 20 |

## Not yet scheduled (needs a decision)

| Gap | User impact | Found in | Notes |
|---|---|---|---|
| SVG/PNG exports omit the dashed marker for inferred internals and the "Inside …" caption | Exported detail views lose context | Task 10 step 2 | Could be added to the existing export renderer |
| Boundaries are drawn after layout, so a boundary box can visually enclose non-members (all views) | Diagrams can imply wrong grouping | Task 10 step 2 | A grouped (compound) layout would fix this and enable real containers for internals; touches shared layout and routing |
| Schema v1 stores manual positions in one global node-id map | Dragging a node in one view moves it in other graph views | Tasks 6 and 8 | Disclosed in the orientation control; a per-view layout needs schema v2 |
| Removing a link between two source-backed nodes reports both the edge and the path refusal | Accurate but verbose message | Task 10b | Copy refinement only |
| Branch names containing `/` are ambiguous with subdirectories in GitHub URLs | Such branches must be given as a commit SHA | M3 | Documented in the URL parser |
| Jobs are coordinated in a single process | Horizontal scaling would need a distributed registry | Cancellation follow-up | Deployment limitation |
| The stop-loss cannot include usage a provider never reported, or usage lost when a process dies | Spend estimate can undercount | Task 14 | Provider invoice is authoritative |
| Secret detection is best-effort; novel or split credential formats can evade it | A rare secret could reach the hosted provider | Task 17; threat model T4 | Residual risk, accepted |
| Native local model output varies (occasional omitted semantics, extra repairs) | Some local runs need a retry | Tasks 4, 7, 10b | Track in task 19 measurements |

## Owner tasks before the repository goes public

- Name, domain and trademark clearance (SPEC §1, §14).
- Add a LICENSE file (none exists).
- Tune anonymous credit limits after two weeks of live usage data (SPEC §15).

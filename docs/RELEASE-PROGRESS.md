# Release completion tracker

Work is authorized sequentially against the approved first-release scope in SPEC.md and POST-MERGE-AUDIT.md. Each row gets a focused branch/PR, regression tests, appropriate real-provider/browser checks and a recorded result. Do not merge automatically. Do not specialize behavior for one sample repository. Preserve failures and existing saved diagrams. Cleanup follows final acceptance, not an assumption that passing unit tests means complete.

Completed foundation: PR #11 clean-download instructions; PR #12 authoritative extraction inventory and local file-read safety. Both merged.

| Order | Deliverable | Status |
|---|---|---|
| 1 | Reliable generic repository assembly | Merged to main as PR #13; verified |
| 2 | Native deadlines, cancellation and coherent recovery | Merged to main as PR #16; verified |
| 3 | Sequence renderer in workspace and exports | Merged to main as PR #16; verified |
| 4 | ER fields, keys and cardinalities | Merged to main as PR #17; verified |
| 5 | SVG/PNG routing, self-relations and label readability | Merged to main as PR #18; verified |
| 6 | Direct rename/drag and persistent manual positions | Merged to main as PR #19; verified |
| 7 | Clarification answer/skip flow | Merged to main as PR #20; verified |
| 8 | Architecture orientation control | Merged to main as PR #21; verified |
| 9 | Privacy-aware model JSON download | Merged to main as PR #22; verified |
| 10 | Existing-model component drill-down | Merged to main as PRs #23 (detail views) and #24 (expand internals); verified |
| 10b | Refinement keeps semantic checks consistent when adding or removing sources and sinks | Merged to main as PR #25; verified |
| 11 | Local-clone UI, accurate credits copy and stable warnings | Merged to main as PR #26; verified |
| 12 | Subdirectory-first scanning and generated-file exclusions | Merged to main as PR #27; verified |
| 13 | Truthful working-tree/commit evidence | Merged to main as PR #28; verified |
| 14 | Accurate task/repair usage and provider-aware costs | Merged to main as PR #29; verified |
| 15 | Supported framework extraction gaps and coverage measurements | Merged to main as PR #34; verified |
| 16 | Retention, expiration and user deletion | Merged to main as PR #32; verified |
| 17 | Threat model and before-egress content secret scanning | Merged to main as PR #30; verified |
| 18 | Public abuse controls and honest exhausted-credit copy | Merged to main as PR #33; verified |
| 19 | Evaluation oracle, representative real-provider results and human-review handoff | PR #35 open against main; verified (named visual reviews await the owner) |
| 19b | Hosted first-pass validity: give the model the evidence shape | Pending |
| 20 | Cross-browser/accessibility/device acceptance, clean-install rerun and documented cleanup | Pending |

Known gaps not yet fixed are tracked in one place: [OPEN-GAPS.md](OPEN-GAPS.md). Update it in every PR that finds or fixes a gap.

External acceptance work that requires a person/device must be recorded as outstanding if unavailable; do not substitute an automated check. Existing exclusions (hosted private GitHub OAuth, billing, collaboration, light mode) remain unchanged. Owner name/domain clearance remains an owner task.

## Release decisions (2026-10-17)

Delegated by the owner to engineering judgement; recorded here so they can be revisited.

- **Order of remaining work:** 17 → 16 → 18 → 15 → 19 → 20. Protect user data first, close the release gates, then improve extraction quality, then evaluation and acceptance.
- **17, secrets:** typed text in hosted mode is blocked before any credit or provider call; repository content is masked and the masking is disclosed; every hosted request also passes an egress guard that fails closed. Local mode is not scanned because nothing leaves the machine. secretlint runs in-process instead of the gitleaks + secretlint pair; rationale in `docs/THREAT-MODEL.md`.
- **16, retention:** implement as promised. Anonymous hosted diagrams expire 30 days after their last change, with an automatic sweep, and owners can delete a diagram in either mode. Local diagrams never expire automatically.
- **18, abuse controls:** keep the enforced credits, burst limits, concurrency slots and stop-loss; defer anomaly challenges and bans until post-launch traffic data exists, and narrow SPEC §15 to match. Fix the exhausted-credit copy that advertises an unavailable GitHub sign-in.

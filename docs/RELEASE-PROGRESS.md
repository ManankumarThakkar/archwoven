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
| 13 | Truthful working-tree/commit evidence | Verified; focused PR being prepared |
| 14 | Accurate task/repair usage and provider-aware costs | Pending |
| 15 | Supported framework extraction gaps and coverage measurements | Pending |
| 16 | Retention, expiration and user deletion | Pending |
| 17 | Threat model and before-egress content secret scanning | Pending |
| 18 | Public abuse controls and honest exhausted-credit copy | Pending |
| 19 | Evaluation oracle, representative real-provider results and human-review handoff | Pending |
| 20 | Cross-browser/accessibility/device acceptance, clean-install rerun and documented cleanup | Pending |

External acceptance work that requires a person/device must be recorded as outstanding if unavailable; do not substitute an automated check. Existing exclusions (hosted private GitHub OAuth, billing, collaboration, light mode) remain unchanged. Owner name/domain clearance remains an owner task.

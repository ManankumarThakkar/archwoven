# ER fields, keys and cardinalities implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Goal: saved ER data is visible and understandable in the workspace and actual SVG/PNG downloads; architecture and sequence remain usable.

Approved scope: SPEC sections 1, 2, 5, 6; release tracker task4; user authorized sequential completion inline with focused stacked PRs and no automatic merging.

Design: keep ER in React Flow, with a custom entity node showing its provenance, full field names/types and PK/FK/UK badges. Shared entity geometry/wrapping drives ELK sizing and SVG output so rows are never silently clipped. Show relationship cardinalities with explicit labels and one/many endpoint markers; absent metadata stays unspecified. Use the same meanings in downloaded SVG/PNG and the inspector. Preserve keyboard selection/evidence, view routing and all existing architecture/sequence behavior. Hosted string-encoded fields get their complete nested value schema, as sequence metadata now does. General graph routing/label polishing remains task5.

- [x] RED: real entity component fields/keys/types/empty metadata; shared dimensions/long labels; Canvas ER type/cardinality dispatch; SVG fields and one/many relationships, escaping; hosted fields contract.
- [x] Shared entity geometry, custom React Flow node and ER relationships; matching export fields/cardinality and inspector metadata.
- [x] Full hosted/local tests, typechecks/build; real provider ER → persistence → browser/reload → actual SVG/PNG downloads, plus architecture/sequence regression.
- [x] Independent review, fixes, focused stacked PR, audit/tracker update; continue task5.

Constraints: no fabricated columns/keys/cardinalities, no schema-version or wire-format migration, no external rendering dependencies, all text escaped. Legacy empty field lists are stated honestly. No credential/session database publication or unrelated source deletion.

Live-check adjustments: native ER first omitted N:M, then bounded repair failed duplicate edge ids without saving. New-generation ER validation requires cardinality or a pointed unknown question; native ER grammar requires an explicit nullable cardinality choice. Existing saved-model schema remains unchanged. Real final native sample passed with N:M and zero repairs. Caption font geometry exposed clipping; ER-only layer spacing improved that measured case. General long-caption/complex/self-relation routing remains task5 explicitly.

Publication ruling: PR14/15 were merged into parent branches rather than main. PR16 corrects integration with a freshly verified exact source tree. This ER PR targets main and stays draft until PR16 lands; future PRs also target main so branch merges cannot strand product changes.

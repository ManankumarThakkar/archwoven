# Direct diagram edits implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement inline, with one fresh-context final review.

**Goal:** Rename nodes and drag graph nodes without inference, preserving revisions, manual positions, export geometry and undo.
**Spec:** docs/SPEC.md sections 2, 6, 7; approved release task6. User authorized sequential implementation and focused PRs.
**Architecture:** Add an owner-checked revision-checked direct-edit endpoint restricted to label changes and finite node positions. Reuse applyEditOps and append-only revisions; no provider/credit path. Persist all active-view node positions after a drag to keep untouched nodes stable. Shared manual-layout routing respects saved positions for workspace and exports. Inspector rename form is keyboard accessible. UI serializes edits/refinement/undo and handles conflicts/errors honestly.

## Constraints and decisions

- Existing schema v1 layout map is keyed by node id globally; no schema migration or per-view layout storage. Sequence lifelines remain timeline-controlled; participant rename is supported, graph dragging is not shown there.
- Preserve element identity, provenance, evidence, fields, requirements and untouched layout through renames; position changes never alter semantics.
- Restrict direct requests to 64KiB, labels 1..500 trimmed characters, at most500 finite node positions within +/-100000. Legacy out-of-range positions are ignored visibly, not used to allocate huge exports.
- Pointer movement uses inexpensive provisional paths; obstacle-aware orthogonal routing runs on release/export with a total 2million box/segment-operation budget and an80-node search cap. Saved moves preserve the viewport; Fit View remains explicit. Shared routing handles repositioned nodes/self-loops. Overlapping user boxes may prevent an obstacle-free route: retain visible connections with an explicit layout warning. No invented graph changes.
- Whole-view bounds include manual coordinates/captions; bound PNG allocation to64million pixels, suggest SVG for oversized diagrams, release rasterizer resources.
- Existing refinement and undo must not overwrite newer direct edits. UI controls serialize mutations; server rechecks after provider awaits. Correct snapshot history to append accepted models, preserving multi-step undo.

## Files and verification steps

- [x] RED API regressions in api/models/[id]/edit/route.test.ts: owner, stale, strict input, rename/move persistence, unchanged semantics, zero provider calls/credits; implement lib/direct-edit.ts and edit/route.ts.
- [x] RED manual-layout/export tests: exact positive/negative positions, rename stability, route endpoints/obstacles/self-loop, complete scene bounds; implement lib/manual-layout.ts and consume it after canonical ELK auto-layout. Update graphScene bounds handling.
- [x] RED page/inspector/Canvas interaction tests: rename submit, drag-stop persistence, failed-save rollback, busy serialization, stale model replacement, multi-step undo. Implement RenameForm, Inspector props, Canvas controlled drag state and page commit flow. Keep selection/lens/motion/provenance.
- [x] RED server race/undo tests and PNG allocation guard; implement rechecks and bounded rendering with finally/free.
- [x] Full hosted/local suites, typechecks, production build, benchmark selftests; real saved-provider browser rename/drag/reload/undo/SVG/PNG, real model JSON/evidence checks and no extra model usage.
- [x] One read-only review; resolve Important findings with RED/GREEN, update release audit/tracker, push focused PR against main. Do not merge automatically.

## Review focus

Stale-tab or in-flight refinement overwriting manual edits; repeated drag/save failures losing prior positions; changed node dimensions after rename and routes crossing moved obstacles; negative/far coordinates and oversized raster allocation; keyboard-accessible rename, selection and undo without duplicate requests.

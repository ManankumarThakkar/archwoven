# Shared graph routing and export readability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Goal: architecture/ER/component workspace and exported SVG/PNG show the same routed connections, readable labels and visible direction/cardinality, including self-relations.

Approved release task5; user authorized sequential work inline. Publish main-targeted focused draft PR if preceding integration is pending, never merge automatically.

Design: retain ELK and preserve its orthogonal edge sections and label boxes instead of throwing them away. Fixed node-side ports align routing with React Flow handles in LR/TB. Share typed node/edge geometry, pure text wrapping and SVG primitives between product/export. Custom graph nodes/edges render that geometry with existing provenance, focus, lens and motion behavior. Use measured bundled-font ASCII advances plus a conservative Unicode fallback to wrap text efficiently; full originals remain accessible in titles. Sequence remains on its separate renderer. Self-loops and parallel/back edges keep visible paths/markers; edge captions have measured boxes and background. Existing entity fields/keys/cardinality stay intact.

- [x] RED tests for node/label containment, boundary endpoints/direction, self-relations, parallel/cycle paths and label boxes; existing architecture/ER/sequence behavior.
- [x] Extend canonical ELK layout result with routed sections and label geometry; shared font-aware wrapping/node sizing.
- [x] Custom graph node/edge rendering and SVG export from the same scene; retain provenance, selection and bounded safe escaped markup.
- [x] Full hosted/local suites, typecheck/build, real saved/provider browser and actual SVG/PNG verification for architecture/ER/self-loop/sequence regression.
- [x] Independent review, resolve findings, publish main-based PR and update audit/tracker. Continue direct editing/manual positions.

Constraints: no Mermaid, remote image refs or execution of provider markup; no fabricated graph semantics; unknown metadata stays disclosed. No schema version change. Manual positions/edit persistence are task6; keep routing interfaces extensible without implementing editing here. Physical accessibility and broad statistical evaluations remain later acceptance tasks.

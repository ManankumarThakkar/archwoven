# Sequence workspace and export implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Goal: render actual sequence semantics from the saved typed model in the workspace and downloaded SVG/PNG, preserving architecture behavior and evidence inspection.

Approved scope: SPEC sections 1, 2, 5, 6, and release tracker task 3. User authorized sequential completion of the full backlog; inline execution and focused stacked PRs, no automatic merging.

Design: promote the existing pure SVG probe to a shared product renderer. Route sequence views to a separate React viewer while the graph viewer retains architecture/ER/component behavior. Use one escaped SVG string for browser and export, bounded multiline labels, real lifelines and message order, distinct call/return/async arrowheads, self-call loops, deduplicated fragment bands. Invalid/missing metadata yields an actionable error without fabricating a timeline. Participant buttons support evidence inspection; a textual message list supplies an accessible reading order. Scroll/zoom/fit controls support wide timelines and reduced-motion without animation.

- [x] RED tests: exports choose timeline rather than graph; ordered/directional/self/fragment/escaping/long-label cases; absent/invalid metadata; Canvas sequence dispatch and inspection/zoom/text timeline.
- [x] Shared renderer + export dispatch; preserve probe import compatibility.
- [x] Separate SequenceCanvas and graph dispatch; accessible inspection, zoom/fit, scroll and text alternative; retain model/view hash and avoid false graph controls.
- [x] Relevant/full hosted/local suites, typechecks/build, real provider sequence browser → save → reload → SVG/PNG inspection; architecture restoration regression.
- [x] Independent fresh-context review, fix substantive findings, publish focused stacked PR and update tracker/audit.

Constraints: never use Mermaid or execute generated markup; all provider labels are escaped text. No fabricated message metadata for legacy graph-only sequence views. No credential or session database publication. ER and architecture export improvements remain subsequent focused tasks.

Live-check adjustment: hosted string-encoded sequence values initially lacked their complete nested prompt schema. Added the actual SequenceMetaSchema plus fragment placement guidance; preserved the initial omitted-fragment outcome and rechecked a real hosted opt sequence. No runtime wire format or schema version changed.

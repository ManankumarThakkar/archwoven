# Component detail views (drill-down step 1) — plan

Spec: `docs/superpowers/specs/2026-10-17-component-drill-down-design.md` (step 1). Execution: inline, test-first.

- [x] **Model: `packages/model/src/detail.ts`** — `detailViewId`, `isDetailView`, `detailMembership`, `syncDetailViews`, `openDetailView`, `closeDetailView`, `MAX_DETAIL_VIEWS`. Wire sync into `applyEditOps` and `orientArchitecture`; export from the index.
  - verify: table tests for membership (isolated, in/out, self-loop, hub, duplicate neighbours, edge order), sync (rename, add/remove link, removed focus, entity kind change, orientation), actions (no-op reopen, limit, entity/unknown/non-detail rejections), undo and validateModel round-trip, generated component-detail untouched; mutations caught.
- [x] **Edit route:** parse `detail` / `close-detail` in `lib/direct-edit.ts`; dispatch in `api/models/[id]/edit`.
  - verify: route tests for success, no-op without revision, 400 cases without write, 409 stale, 404 other owner, no usage/credits.
- [x] **Layout:** `manualLayout` returns the auto layout for detail views.
  - verify: a saved position does not move a detail-view node; the architecture view still honours it.
- [x] **Workspace:**
  - resolved current view and fallback effect
  - detail tab label and close
  - inspector Open detail and limit hint
  - directEdit switching to the opened tab
  - detail caption and focus outline
  - onMove withheld in detail views
  - verify: page/viewer tests for every Section 2 edge case.
- [x] **Gates:** hosted, local, typecheck, isolated build, selftests.
- [x] **Live:** hosted and native, fake=false: open/rename/refine/undo/close/reload/stale tab, exports, 390 px, credits unchanged.
- [x] **Docs/PR:** RELEASE-PROGRESS, POST-MERGE-AUDIT follow-up, PR against main.

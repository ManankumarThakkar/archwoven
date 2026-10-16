# Inference cancellation and deadlines implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Cancellation stops actual inference, jobs have a bounded lifetime, and the UI follows server deadlines without abandoning healthy queued work.

**Architecture:** Share the existing controller/settlement registry between description and repository jobs. Start a configurable 180-second deadline when a job gets a slot; publish its deadline in owner-checked polling. Native adapters combine cancellation with one overall inference deadline across repairs and catch stream aborts. Hosted calls receive the same signal. Refinement propagates HTTP cancellation and receives the native deadline.

**Tech Stack:** Node 24 AbortSignal, TypeScript, existing SQLite job store, Next/React, Vitest.

**Spec:** docs/SPEC.md sections 7, 9, 15; docs/POST-MERGE-AUDIT.md native cancellation/deadline gap.

## Global constraints

- Preserve the last valid model, ownership checks, bounded repairs and local-only routing.
- Cancellation/failure refunds at most once; late results never become successful revisions after settlement.
- Queued time does not consume execution time; metering records completed provider usage even after cancellation.
- Preserve existing adapter signatures by adding optional signal/timeout options; no provider/key migration.

## Review focus

- Already-cancelled calls never contact a provider.
- Abort during response streaming cancels/releases the reader and stops repairs.
- A deadline covers all repair attempts, not a fresh budget per retry.
- Queued cancellation, timeout, late completion and repeated cancellation settle/refund once.
- Browser waiting uses owner-checked server deadline with a grace period and preserves input/reconnect behavior.

## Task 1: Abortable bounded native transport

**Files:** packages/llm/src/local.ts; add local-cancellation.test.ts; extend optional hosted signal support in client.ts/refine.ts and countTokens contract.
**Interfaces:** optional `{ signal?: AbortSignal; timeoutMs?: number }` on native calls; one composed signal per adapter invocation. Existing outcomes remain unchanged; cancellation/timeout returns clear errors.

- [x] Write RED tests for pre-abort, request abort, mid-stream abort, deadline, repair-budget reuse and stream cleanup.
- [x] Propagate composed signals into fetch, catch reader failures, stop repairs after abort and preserve completed-call usage.
- [x] Run transport and all existing adapter suites, typechecks.

## Task 2: Job deadline, cancellation settlement and UI

**Files:** shared job registry; generate/repo/job-poll/cancel routes; server.ts; workspace page/ControlPanel and tests.
**Interfaces:** registry entry adds nullable execution `deadlineAt`; job poll returns it. Generation seam accepts optional signal; model/refinement calls receive it. Default execution budget 180000 ms, configurable with ARCHWOVEN_JOB_TIMEOUT_MS; native default uses ARCHWOVEN_LOCAL_TIMEOUT_MS with the same default.

- [x] Write RED cases for timeout/refund, description cancellation, late success, queue deadline and UI continuation past the obsolete fixed wait limit.
- [x] Add shared deadline helpers and generate settlement claim; keep legacy unregistered cancellation refusal.
- [x] Show Cancel for running descriptions; poll against server deadline plus grace instead of a fixed 120-second cutoff.
- [x] Run full hosted/local tests, typechecks/build and real local cancellation/timeout/retry checks; verify normal real generation still works.
- [x] Fresh-context branch review, focused PR, progress ledger update; continue with sequence rendering.

## Execution ruling

The user approved sequential execution of this backlog. Execute inline and preserve PR boundaries; stack above PR #13 if it is not yet merged. No automatic merging.

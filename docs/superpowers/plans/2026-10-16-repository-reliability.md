# Repository assembly reliability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** General repositories keep every observed module/import binding through real hosted/local model assembly without provider-generated graph mutations.

**Architecture:** Extracted generic nodes, edges and evidence are authoritative. The provider emits a small strict presentation object (title, extra open questions, guided groups referencing known IDs); shared server code constructs and validates the final SystemModel. Specialized Spring/FastAPI assembly keeps its current contract.

**Tech Stack:** TypeScript, Zod, existing Anthropic/Ollama adapters, Vitest.

**Spec:** docs/SPEC.md sections 2, 3, 5, 9; docs/POST-MERGE-AUDIT.md general-repository assembly failure.

## Global constraints

- Preserve source-supported relation/imports bindings and commit-pinned evidence; never invent runtime topology.
- Keep repo text fenced as untrusted data and keep all local inference local.
- At most two repairs; no silent fake-provider fallback; retain usage accounting.
- Generic source caps remain 20 sampled files / 30 edges; specialized extraction and description/refinement contracts remain intact.

## Review focus

- Python/JS/Go/Rust imports and cycles retain exact extracted IDs and directions.
- Provider attempts to inject nodes/edges or reference unknown focus IDs are rejected and repaired.
- Empty/docs-only/no-import samples remain valid with honest gaps.
- Local privacy and server-pinned evidence do not depend on provider self-report.
- Provider failure is explicit; no canned graph replaces a failed call.

## Task 1: Presentation contract and adapter integration

**Files:** Create packages/llm/src/source-presentation.ts and source-presentation.test.ts; modify repo.ts/repo.test.ts and local.ts/local.test.ts.

**Interfaces:** `buildSourceModel(fragment: Fragment, raw: unknown, privacy: Privacy): ValidationResult`; `SOURCE_PRESENTATION_SCHEMA` JSON schema and `SOURCE_PRESENTATION_SYSTEM` prompt. Existing adapter signatures/results remain unchanged. Only sourceContext-bearing fragments use this contract.

- [x] Write failing language-diverse provider-adapter regressions that accept presentation JSON and yield exactly the extracted graph, evidence and coverage gaps.
- [x] Write failing cases for invented graph properties, unknown chapter IDs, malformed metadata, docs-only/empty graphs and immutability.
- [x] Implement the small strict schema, source-only model construction and known-ID validation. Generate one architecture view; do not fabricate sequence/ER views from imports.
- [x] Route both adapters through the contract; keep specialized paths unchanged. Cap presentation output separately from full-model output; keep repairs bounded.
- [x] Run targeted then full hosted/local tests, typechecks and build. Run representative real hosted/local imports with fake disabled, including the prior failure sample and other repo structures. Record actual outcomes.
- [x] Request a fresh-context branch review; fix important findings with regressions, then publish a focused PR and update RELEASE-PROGRESS.md. Continue with the separately scoped cancellation task.

## Execution rulings

The user approved the completion backlog and explicitly requested continuous sequential execution. Execute inline without another scope/permission handoff; preserve the approved PR boundaries. Later feature plans are written after inspecting their existing implementation, not guessed here.

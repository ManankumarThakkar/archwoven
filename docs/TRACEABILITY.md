# TRACEABILITY — living doc (SPEC.md → code → tests)

Updated per milestone. M3 rows added 2026-10-09.

| Req | Requirement (SPEC ref) | Implementation | Tests / evidence |
|---|---|---|---|
| R1 | One typed system model is the single source of truth (§2) | `packages/model` schema v1; every API reads/writes revisions of it | `packages/model` suite; M2-CHECKS |
| R2 | GitHub URL → pinned commit; analysis never mixes commits (§5) | `packages/ingest/src/fetch.ts` `pinCommit` (ref/SHA/default-branch → 40-hex SHA at accept) | `fetch.test.ts`; live evidence commit `500158f…` in M3-CHECKS §5 |
| R3 | URL validation + SSRF block before any spend (§14) | `packages/ingest/src/url.ts` `parseRepoUrl` (raw `..` pre-check, https-only, host allowlist, internal-IP literals rejected) | `url.test.ts`; `repo/route.test.ts` SSRF/traversal → 400 with 0 credits used |
| R4 | Tarball safety: traversal, links, size caps, binary/vendor filtering (§14) | `packages/ingest/src/unpack.ts` own ustar reader (+ gzip): checksum verify, PAX long paths, typeflag refusals, caps incl. decompressed-size bomb guard | `unpack.test.ts` 13 cases incl. gzip + bomb guard |
| R5 | Framework detection: Spring Boot / FastAPI; mixed → subdir prompt (§5) | `packages/ingest/src/detect.ts` | `detect.test.ts`; `ingest.test.ts` mixed/unsupported |
| R6 | Extract fragments with per-construct evidence, gaps explicit (§5, §13) | `packages/extract` tree-sitter extractors; ingest merges skipped+submodule+LFS gaps | `extract` suites; `docs/M3-MATRIX.md` (fixtures 100% regression; real-repo counts + 62-gap ledger) |
| R7 | Repo content is untrusted data, never instructions (§14) | `packages/llm/src/repo.ts` `<repo-data>` fence, `</` escaping, pinned evidence, count_tokens fail-closed gate, max_tokens 8192 | `repo.test.ts` injection fixture (delimiter appears exactly once, escaped content) |
| R8 | Weighted quota: repo=2, reserve-at-accept, refund on failure/cancel (§15) | `quota.ts` `reserve('repo')`; `repo/route.ts` claim-once settle; `cancel/route.ts` refunds `WEIGHTS[kind]` | `quota.test.ts`; `repo/route.test.ts` ladder + refund; live 4→2→0→429 |
| R9 | Cancellation is real: abort in-flight fetch/model call, no resurrection (§15) | `lib/repo-registry.ts` AbortController registry; body abort/claim guards | `repo/route.test.ts` cancel×4 (incl. queued race); live transcript M3-CHECKS §12 |
| R10 | Ownership: sessions cannot read or cancel each other's jobs (§11) | `readOrCreateSession` + `job.sessionId` checks on read + cancel | `jobs/[id]/route.test.ts`, `cancel/route.test.ts`; live 404s |
| R11 | Every call metered incl. failures/repairs (§11, §15 stop-loss) | `recordUsage` on every terminal path; billed accumulation across repairs | `repo/route.test.ts` failed-but-metered; `repo.test.ts` usage accumulation |
| R12 | UI: describe ⇄ import-repo, prefills never auto-run, gaps surfaced | `ControlPanel` mode segment + repo form; `states.ts` MODE/REPO_SELECT; gaps chip + inspector panel | `states.test.ts` mode parity; `repo-form.test.ts` URL table |
| R13 | Temp clones deleted after the job (§14 retention) | `ingest.ts` `finally { cleanupDir }` | `unpack.test.ts` cleanupDir; code-reviewed path |

Pending rows (blocked on live direct key): live-model extraction precision/recall (M3-MATRIX pending), Probe B first-pass validity.

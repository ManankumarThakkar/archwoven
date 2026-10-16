# M3 scenario checks (4–6, 12)

Historical snapshot. Current merged-source verification, superseded blockers and remaining work: [post-merge audit](POST-MERGE-AUDIT.md).

Essential scenario checks from the master prompt, verified against the repo-mode pipeline. Live evidence: `next start` with `ARCHWOVEN_FAKE=1 ARCHWOVEN_DEMO_ACK=1` (boot guard requires the ack), SQLite at `/tmp/aw-m3.db`, port 3111, 2026-10-09.

| # | Scenario | Verified by | Result |
|---|----------|-------------|--------|
| 4 | Unsupported code patterns appear as analysis gaps, not silence | Live petclinic run surfaced **62 ingest gaps** (every `node_modules`/`target`/binary skip, `path: reason`); extractor gap *"multiple datasources (MySQL, PostgreSQL) — repo→datastore mapping not statically provable"*; `.gitmodules` → *"submodule(s) declared — codeload excludes submodule contents"* and LFS → gap (`ingest.test.ts`); traversal/symlink/hardlink/size/binary refusals all gap-listed (`unpack.test.ts`, 11 cases); unsupported framework → `unsupported-framework`, mixed monorepo → `mixed-frameworks` subdir prompt (`detect.test.ts`, `ingest.test.ts`) | ✅ PASS |
| 5 | Evidence opens the correct file at the analyzed revision | Live: succeeded petclinic job → model JSON evidence carries `commit=500158f732419217507c7656904b8e6aa1bcc0d6` + `repo=spring-projects/spring-petclinic` on every evidence object; SHA is pinned server-side after validation (`repo.ts › pins every evidence object`), never model-supplied; the UI builds `…/blob/<sha>/<path>#L<n>` links (M2 inspector) | ✅ PASS |
| 6 | Proposed components distinguishable from observed | Real fragments are **100% source-supported** by construction (petclinic 18/18, fastapi 714/714 — extraction emits only what it saw); `REPO_SYSTEM` forbids invented nodes and forces LLM additions to `inferred`/`proposed`; faithful JSON schema constrains the provenance enum; Canvas/Inspector provenance styling from M2 | ✅ PASS (extraction axis measured; LLM-axis numbers pending live key) |
| 12 | Cancellation, quota block, provider failure are all real states | Live HTTP below | ✅ PASS |

## Scenario 12 — live transcript

```
POST#1 → 202 remaining=4        (weight 2 of pool 6, charged at accept)
POST#2 → 202 remaining=2
POST#3 → 202 remaining=0
POST#4 → 429 credits-exhausted "You've used today's free generations — resets in 5h 58m. Sign in with GitHub for 30/day."

cancel-target POST → 202 jobId=b20e8980     (tiangolo/fastapi, multi-second ingest)
cancel → 200 {"status":"cancelled"}
poll after cancel → status=cancelled          (job body never resurrects it)

ownership read → 404, ownership cancel → 404  (fresh session, same job id)
```

Provider-failure states (unit-pinned in `repo/route.test.ts`): ingest `not-found-or-private` → job failed with the non-inferring copy + refund; assemble failure with tokens spent → failed, refunded, call **still metered**; extractor crash → `ok:false`, never a throw.

## Race fixed during these checks

The first live cancel showed `poll after cancel → status=running`: a cancel landing while the job was queued was overwritten when the job body later wrote `running`/`succeeded`. Fixed with abort/claim guards (`if (controller.signal.aborted) return;` at body start + `claim()` before the success write); pinned by two new tests (`cancel before the job body starts`, `cancelled job is never overwritten by the job body finishing late`). Live re-run: `poll after cancel → status=cancelled`.

## Pending

- **Live repo analysis** (real model, petclinic + fastapi, ≤ $0.30) awaits a valid direct `sk-ant-…` key — documented, same blocker as Probe B.

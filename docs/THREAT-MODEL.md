# Archwoven threat model

Status: first release, 2026-10-17. Owner: repository maintainers. Review it when a new egress path, input surface, deployment mode or third-party dependency is added, and before the repository becomes public.

This document records what is **implemented and tested** today, what is **partial**, and what is **deferred**, together with the reason. It complements SPEC §8–§9 and §15.

## Scope and assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| User descriptions, refinement instructions, clarification answers, expansion hints | Request bodies; job records; the provider request | May contain proprietary designs or pasted credentials |
| Repository source excerpts and structure | Ingest working memory; fragments sent for analysis | Private code (local mode); secrets committed to public code (hosted mode) |
| Saved diagrams and revisions | SQLite (`ARCHWOVEN_DB`) | User work; evidence paths and commits for private clones |
| Session identity | `aw_sid` cookie | Grants access to that session's diagrams |
| Provider API key and spend | Server environment; provider account | Financial exposure; stop-loss |
| Local machine files (local mode) | Filesystem readable by the server user | A local-folder import reads them |

## Actors

- **Anonymous hosted user:** untrusted input, rate-limited and credit-limited.
- **Local owner:** trusted operator of their own machine.
- **Malicious web page:** visited in the same browser as a local instance; can issue cross-site requests and use DNS rebinding.
- **Malicious repository author:** controls file contents, names and archive structure.
- **Network peer:** on the same LAN as a local instance.
- **Hosted model provider:** receives hosted requests; trusted with what is sent, so we minimise and scan what is sent.

## Trust boundaries and data flows

1. **Browser → Archwoven API.** Hosted: the public internet. Local: loopback only.
2. **Archwoven → hosted provider (hosted mode only).** Descriptions, refinements, expansions and masked repository fragments.
3. **Archwoven → GitHub** (`api.github.com`, `codeload.github.com`): public repository metadata and archives.
4. **Archwoven → Ollama (local mode only):** loopback.
5. **Archwoven → local filesystem (local mode only):** the checked-out commit of a git clone, read through raw git objects.

## Threats and mitigations

| # | Threat | Mitigation | Status | Evidence |
|---|---|---|---|---|
| T1 | A secret typed or pasted by a user is sent to the hosted provider | Typed text is scanned with secretlint's pinned recommended preset (26 provider rules, including Anthropic, OpenAI, AWS, GCP, GitHub, Stripe, Slack, private keys, database URLs and basic-auth URLs) before any credit, job or provider call. Refusals name the field, kind and line. Local mode is not scanned because nothing leaves the machine. | Implemented | `packages/llm/src/secrets.ts`; `apps/web/lib/secret-gate.ts`; route tests for generate, clarification, refine and expand |
| T2 | A secret committed to a public repository is sent to the hosted provider | Repository fragments are masked before hosted analysis using provider rules plus a generic credential-assignment rule that skips placeholders, environment lookups and code references. The masking is disclosed in the saved diagram. If scanning fails, the job fails closed (no provider call, credits refunded). | Implemented | `maskFragmentSecrets`; `apps/web/app/api/repo/route.test.ts`; `mask-failure.test.ts` |
| T3 | A code path forgets the input gate (for example, a secret renamed into a model label and later refined) | `hostedClient()` wraps every hosted client, including injected test clients, with `guardEgress`, which scans token counting and generation requests and refuses before any network call | Implemented | `egress-secrets.test.ts` (generation, refinement, expansion, repository assembly) |
| T4 | Secret detection misses an unusual credential format | Detection is best-effort and labelled as such. The generic assignment rule covers common config forms in repository content. Sensitive filenames (for example `.env` and keys) are excluded before any read. | Partial (inherent) | Ingest exclusion tests; secrets tests |
| T5 | Repository content contains prompt-injection instructions | Repository data is fenced as untrusted (`<repo-data>`, `<model-data>`) with delimiter escaping. Provider contracts are narrow (presentation-only for generic maps; server-built ids and provenance for expansions). Source-supported structure cannot be rewritten by the provider. | Implemented | `repo.test.ts`, `expand.test.ts` fencing and contract tests |
| T6 | A crafted archive escapes extraction (traversal, links, bombs) | Custom tar reader: checksum verification, traversal and link refusal, per-file, count and decompressed-size limits, scope applied before materialisation | Implemented | `unpack.test.ts`, ingest scope tests |
| T7 | SSRF through repository URLs | Strict GitHub URL parser (https only, host allowlist, internal-address literals refused) before any quota or fetch | Implemented | `url.test.ts`, repo route tests |
| T8 | A malicious web page drives a local instance (cross-site "simple" POST, DNS rebinding) and reads local imports | Local-mode middleware on `/api/*` requires a loopback Host and a same-origin Origin, and refuses `Sec-Fetch-Site: cross-site`. Docker publishes ports 3000 and 11434 on 127.0.0.1 only. | Implemented | `local-guard.test.ts`, `middleware.test.ts`, live curl checks (task 11) |
| T9 | A local-folder import reads outside the intended clone or reads uncommitted files | Absolute or `~` paths only; the committed tree is read through raw git objects with fixed argv, sanitised git environment, no filters or replacement refs, no lazy fetch, and bounded output | Implemented | Task 12/13 ingest tests |
| T10 | A private model reaches a hosted provider | Deploy mode routes local work to Ollama behind an egress allowlist. The hosted expand path refuses `local-only` models in code. Privacy is server-stamped from deploy mode. | Implemented | `egress.test.ts`, expand tests, repo route privacy tests |
| T11 | Another session reads or changes a diagram | Every model, job and edit route checks the owning session. Sessions are random ids in an HttpOnly, SameSite=Lax cookie, and `Secure` on hosted production. | Implemented | Route ownership tests; `server.test.ts` cookie test |
| T12 | Cross-site request forgery against hosted sessions | SameSite=Lax withholds the session cookie from cross-site POSTs, so a forged request becomes a new, empty anonymous session | Implemented (by cookie policy) | Cookie test |
| T13 | XSS through labels in the canvas or exports | React escapes text. SVG export escapes markup and emits no scripts, external references or `foreignObject`. JSON export is data only. | Implemented | `export-svg.test.ts` malicious-label tests |
| T14 | Exports or share cards leak private evidence | Share cards and images carry no evidence paths. JSON offers an evidence-free variant with a private-model notice. | Implemented | Export and share-card tests |
| T15 | Cost or availability abuse on hosted (scripted generation) | Weighted daily credits per session and IP bucket, burst limits, concurrency slots, per-request token gate, job deadlines and cancellation, global daily stop-loss | Implemented; the escalation ladder is deferred (see below) | Quota, limiter and route tests |
| T16 | Data retained longer than promised | 30-day anonymous expiry, sweeping and user deletion | **Not yet implemented: release task 16** | — |
| T17 | Supply-chain compromise through dependencies | Exact pins for security-relevant dependencies (secretlint 13.0.7, two weeks old at adoption); frozen-lockfile installs in CI and Docker; no runtime code execution from analysed repositories | Partial | `pnpm-lock.yaml`, CI workflow |
| T18 | Content leaks through logs or metering | No request content is logged. Usage records hold counters, identities and costs, never prompts or source. | Implemented | Task 14 accounting tests |

## Decisions recorded here

- **Secret scanner:** SPEC §1 named a gitleaks CLI + secretlint pair. The first release uses secretlint in-process only. A per-request external binary would behave differently across hosted, Docker, development and CI environments, and secretlint's pinned preset covers the provider formats we send. The generic credential rule supplies the config-assignment coverage gitleaks' generic rules were meant to add, limited to repository content where a false positive only masks a value. Detection remains best-effort.
- **Blocking versus masking:** typed text is blocked, because the user can fix it immediately and blocking avoids surprising edits to their words. Repository content is masked, because blocking would make many public repositories unanalysable over test keys.
- **Abuse escalation ladder (challenges, temporary and permanent bans):** deferred until post-launch traffic data exists (release task 18 narrows SPEC accordingly). Designing bans without data risks punishing real users; the enforced credits, burst limits and stop-loss bound cost meanwhile.

## Residual risks

- Novel credential formats and secrets split across lines or strings can evade detection (T4).
- A user with their own session can still send their own proprietary text to the hosted provider; that is the product's purpose and is disclosed by the privacy chip.
- The local owner's machine is trusted. An attacker who already controls it is out of scope.
- Retention is not yet enforced (T16, task 16).

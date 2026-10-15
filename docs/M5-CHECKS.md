# M5 private-mode live checks — local deployment evidence

Run date: 2026-10-15 · machine: Apple Silicon Mac Studio, 128 GB · Ollama as launchd service, loopback :11434.
Model: **gpt-oss:20b** (MXFP4, ~13 GB resident). The plan named gpt-oss:120b; 120b's 65 GB resident load crashed the dev box, so the default moved to 20b (`OLLAMA_MODEL` overrides — see §7). Probe D was re-run against 20b before any live claim; results in §2.

## 1. Setup

- `pnpm -r build` → production server: `ARCHWOVEN_MODE=local ARCHWOVEN_DEMO_ACK=1 pnpm start:local` (boot guard ack as compose sets it). No `ARCHWOVEN_FAKE` — real local inference.
- **Deviation from the plan (recorded, not hidden):** the plan said boot `pnpm dev`. `next dev` hot-reloads route modules mid-job; each recompile re-evaluates `server.ts`, whose module-level `openStore` runs boot recovery (`store.ts:102`), marking in-flight jobs `failed — server restarted before completion`. Two live jobs died this way before diagnosis. The production server (`next start` — exactly what `docker compose` CMD runs) has no hot reload and holds jobs intact. All evidence below is from the production server.
- Spring fixture: `git clone --depth 1 spring-projects/spring-petclinic /tmp/spring-petclinic` → HEAD `500158f732419217507c7656904b8e6aa1bcc0d6` (fixture download is setup, not app inference).

## 2. Probe D re-validation — gpt-oss:20b (gate: schema-valid ≥85%)

`npx tsx probes/local/run-eval.ts` (same harness as the 120b probe), exit 0:

| prompt | valid | repairs | nodes | outTok | TTFT | total |
|---|---|---|---|---|---|---|
| architecture (e-commerce) | ✓ | 0 | 10 | 3,724 | 0.3 s | 62.6 s |
| architecture (multi-tenant SaaS) | ✓ | 1 | 8 | 3,820 | 0.6 s | 64.4 s |
| sequence (OAuth login) | ✓ | 1 | 4 | 2,185 | 0.3 s | 36.0 s |
| sequence (order + payment) | ✓ | 1 | 6 | 2,579 | 0.5 s | 45.0 s |
| er (e-commerce DB) | ✓ | 0 | 4 | 3,331 | 0.2 s | 48.2 s |
| architecture STRESS (≥40 nodes) | ✓ | 1 | **42** | 6,277 | 52.4 s* | 120.4 s |
| LONG15k (~15k-token prompt) | ✓ | 0 | 6 | 10,404 | 4.3 s | 124.5 s |

**Aggregate: 7/7 valid (100% ≥ 85% gate) · 42-node stress intact · 15k criterion PASS.**
\* stress TTFT includes attempt-1 wall time (known metering quirk, ledger-minor).

Honest deltas vs the 120b probe run: repairs 4/7 vs 1/7 (all within the ≤2 budget, all reached validity); LONG15k produced a valid but smaller model (6 nodes / 10.4k tok vs 160 / 14.6k). 20b is a legitimate private-path model with weaker first-pass precision — the repair loop carries it.

## 3. Scenario 9 — live local generate, privacy stamped, zero egress

```
POST /api/generate {"prompt":"E-commerce checkout system: web storefront, cart service,
  payment gateway, inventory service, order database, fraud detection",
  "view":"architecture","idempotencyKey":"m5-live-gen-3"}
→ 202 {"jobId":"21fb61a7-…","remaining":null}   ← quota compiled out (§15): Infinity → JSON null
poll /api/jobs/21fb61a7-… → running ×20 → succeeded (~105 s, 20b warm)
GET /api/models/21fb61a7-… → privacy {classification:"private",boundary:"local-only"}
                              nodes 7 · edges 10 · revision 1
```

- Saved revision privacy: **private · local-only** (server-stamped, §9).
- Egress guard: server log for the entire live run contains **zero** `egress blocked` entries and zero hits to any non-allowlisted host — nothing even tried to leave.
- Guard refusal proof (deliberate probe through the guard unit path, per plan):
  `makeEgressGuard(LOCAL_EGRESS_ALLOW)('https://api.anthropic.com/v1/messages')` →
  **`EgressBlockedError: egress blocked: api.anthropic.com is not in the local allowlist`** (rejected before DNS/socket).
- Inference host: `ollama ps` → `gpt-oss:20b · 13 GB · 100% GPU` — the only model resident was the local one.
- `todayCost()` after the run: $0.45 — **token-metric proxy** (`costOf` prices usage at hosted rates as the stop-loss input); no hosted call was made and no money was spent.

## 4. Scenario 10 — localPath repo import (§8 private import)

```
POST /api/repo {"localPath":"/tmp/spring-petclinic","idempotencyKey":"m5-live-repo-1"}
→ 202 {"jobId":"0803500e-…"}
poll → running (designing) ×7 → succeeded (~40 s)
GET /api/models/0803500e-… → privacy private · local-only
  evidence repos:  ["local/spring-petclinic"]
  evidence commits:["500158f732419217507c7656904b8e6aa1bcc0d6"]  ← exactly the clone's HEAD
  nodes 18 · edges 7
```

Evidence commit equals `git -C /tmp/spring-petclinic rev-parse HEAD` — pinned server-side, never model-supplied.

## 5. Refine — live, local, honest first failure

Attempt 1 (`"Add a notification service that emails the customer after payment succeeds"`):
**502 `refine-failed: update "arch": unknown target`** — 20b emitted a view id (`arch`) as a node target; the ≤2 repair loop named the error but 20b repeated it. Recorded as a real 20b weakness (§2 deltas).

Attempt 2 (explicit ids: `svc.notification`, `svc.paymentGateway`):
**200 · revision 2 · ops add svc.notification + 2 edges · privacy still private · local-only.**

## 6. Scenario 11 — exports opened and confirmed

- PNG share-card (`POST /api/share-card` route storefront→paymentGateway): 200, 22,469 bytes, valid 1200×630 RGBA PNG — opened: renders Storefront→Cart→Payment route, footer prints **"Archwoven · private · local-only"**.
- SVG export (`buildSvg` unit path, same code the browser download uses): 3,500 bytes, well-formed XML, all 8 node labels incl. the refined `Notification Service`, **no evidence paths, no `<script>`** (task-4 hardening holds on live output).

## 7. Scenario 14 — parity: same suite, both modes

- Hosted: `pnpm test` → **312/312 passed (38 files)**.
- Local: `ARCHWOVEN_MODE=local pnpm test` → **297 passed, 15 skipped (38 files)** — the 15 skips are hosted-only quota/burst gates compiled out by design (§15); the pattern follows `quota.test.ts`'s `hostedOnly` idiom, extended to the route suites (they had never been mode-aware — 12 failures at HEAD, fixed in `86f9d76` along with leak-proof mode toggles: inline `delete process.env.ARCHWOVEN_MODE` in finally silently flipped subsequent tests to hosted during local-mode runs).
- CI parity job (`.github/workflows/ci.yml`, check 14) runs the same scoped suites under `ARCHWOVEN_MODE=local`.
- Model default `gpt-oss:20b` with `OLLAMA_MODEL` override (`local.ts:12`); compose + `.env.local.example` updated.

## Verdict

Scenarios 9, 10, 11, 14: **live-verified on the private path** with the honest caveats above (dev-mode hot-reload kills in-flight jobs; 20b needs more repair rounds than 120b; the hosted-key-dependent M4 rows remain PENDING and M5 needs none of them).

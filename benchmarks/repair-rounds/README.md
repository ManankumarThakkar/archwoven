# repair-rounds (Suite B)

How good is `validateModel` as a **repair signal**? Eight deterministic
mutations of the golden fixture (`packages/model/src/fixtures/valid-full-
extended.json`), each with expected diagnostics derived from *actual*
`validateModel` output (not aspiration), and oracle JSON-pointer repairs that
restore validity. A repair round is: validate → attempt repair → validate.

**This suite contains no live model repair rounds.** The repairer is a
deterministic rules-only stub (below); feeding diagnostics through a real
model and counting human-visible repair rounds is the harness's future
consumer, same documented API-key blocker as Suite A's live runs.

## Cases (8 distinct failure classes)

| case | class | real diagnostic (first) |
|---|---|---|
| dangling-edge-ref | referential-integrity | `edge "e.catalog-pg" to unknown node: "59922917…"` |
| duplicate-node-id | identity-uniqueness | `duplicate node id: "gateway.api"` |
| missing-required-label | schema-required-field | `nodes.1.label: Invalid input: expected string, received undefined` |
| invalid-enum-kind | schema-enum-domain | `nodes.4.kind: Invalid option: expected one of …` |
| revision-mismatch | revision-lineage | `parentId 3 must equal revision - 1 (0)` |
| required-path-broken | semantic-reachability | `requiredPath unreachable: "actor.user"→"datastore.postgres"` (+ orphan) |
| boundary-overlap | boundary-uniqueness | `node in two boundaries: "gateway.api" (b.core, b.data)` |
| seq-gap | sequence-integrity | `view "view.sequence" message seq must be consecutive from 1, got 6 at index 3` |

Note on "unbound evidence commit": `EvidenceSchema.commit` is a free-form
string — the validator does **not** check commit format, so a malformed
evidence commit is invisible to this harness. The dangling-edge-ref case
therefore uses a 40-hex commit string as a dangling edge `to` — the nearest
damage shape the validator actually catches. Expected diagnostics are exact:
extra unexpected errors fail the case (drift detection).

## Repair rounds and metrics

Round 1 is detection. Round 2 is the **rules-only repairer stub**, which sees
only `{subject, evidence, supportedFixes}` per diagnostic (text-derived — never
the case file) plus the model. It fixes what a mechanical rule can derive:
drop the duplicate node, renumber seqs, reset `parentId`, unwrap the later
boundary. Anything needing a human-chosen value (labels, enum kinds, edge
targets, restored paths) is honestly recorded as NOT repairable, and the case
falls to round 3 (oracle repair).

Reported metrics: **rounds-to-pass** (2 = stub-fixable, 3 = oracle-only),
**first-disclosure-rate** (did the first validation name the mutated
location — Zod reports schema errors by path index, not id, so those cases
honestly score false), **first-detection-stage** (`schema` vs `graph`), and
**actionability** (fraction the stub could fix from the diagnostic alone).
Current run: first-disclosure 6/8, stage graph 6 / schema 2, actionability 4/8.

## Commands (exit codes: 0 pass · 1 failure · 2 incomplete)

```bash
node benchmarks/repair-rounds/harness.mjs check cases/dangling-edge-ref.case.json
node benchmarks/repair-rounds/harness.mjs verify
node benchmarks/repair-rounds/harness.mjs report
node benchmarks/repair-rounds/harness.selftest.mjs   # CI gate
```

`verify` runs all cases and writes `results/<UTC-date>-<runner>.json` pinning
`repositoryCommit` + `packageSha256` (built via `pnpm --filter @archwoven/model
build` if `dist/` is missing) and a self-`fingerprint`; `verify` and `report`
reject tampered receipts (exit 1) before trusting any evidence. No new deps:
plain `node` importing the built `packages/model/dist/index.js`, like Suite A.

## What this can and cannot claim

**Can claim:** `validateModel` deterministically detects these 8 failure
classes against this fixture; the exact diagnostic wording and detection stage
are pinned receipts; the first-disclosure and actionability numbers above are
reproducible against the pinned commit + package hash.

**Cannot claim:** anything about live model repair quality or rounds — no LLM
participates here. The rules-only stub is a lower bound on mechanical
actionability, not a proxy for model behavior. `skipped`/absent cases keep
the matrix incomplete (exit 2), never pass.

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
damage shape the validator actually catches. Expected diagnostics match distinct errors by both a text-derived Suite B code
and the expected substring. Extra unexpected errors fail the case (drift detection).

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
The denominator is always the 8 manifest cases, including missing coverage;
unknown receipt case IDs contribute to neither coverage nor metrics. The
historical run recorded first-disclosure 6/8, stage graph 6 / schema 2, and
actionability 4/8, but its receipt is not valid pinned evidence (see below).

## Commands (exit codes: 0 pass · 1 failure · 2 incomplete)

```bash
node benchmarks/repair-rounds/harness.mjs check cases/dangling-edge-ref.case.json
node benchmarks/repair-rounds/harness.mjs verify   # requires clean committed source
node benchmarks/repair-rounds/harness.mjs report
node benchmarks/repair-rounds/harness.selftest.mjs   # CI gate
```

`verify` requires a clean Git checkout (existing Suite B result files are
excluded from the source cleanliness check), rebuilds the model package,
and writes `results/<UTC-date>-<runner>.json`. The receipt pins
`repositoryCommit`, the built entry point's `packageSha256`, and
`provenance.validatorSha256` over every built JavaScript file. Provenance
records `mode: "pinned"` and `sourceState: "clean"`. `verify` and `report`
reject receipts whose self-fingerprint no longer matches their content
(exit 1). This fingerprint detects accidental changes, not malicious
rewriting or proof of authorship.

For development, use a temporary results directory:

```bash
scratch_dir=$(mktemp -d)
node benchmarks/repair-rounds/harness.mjs verify --scratch --results-dir "$scratch_dir"
node benchmarks/repair-rounds/harness.mjs report --results-dir "$scratch_dir"
# verify exits 0 when all cases pass; report exits 2 because scratch is ineligible.
rm -rf "$scratch_dir"
```

`--scratch` permits dirty sources and can reuse existing built output. It
always records scratch provenance, so a successful selftest or diagnostic
run cannot be presented as pinned evidence. `report` also marks legacy
receipts without clean-source provenance ineligible (exit 2).

## Current merged-source receipt

`results/2026-10-16-postmerge-d6f28bcd.json` was generated from clean merged source `d6f28bcd24eaa72fd3141759acdd66ee898d0cfb`. Its report passes all eight deterministic cases and is evidence-eligible for validator round-trips only. The filename uses UTC. It does not measure LLM repair performance; see the [post-merge audit](../../docs/POST-MERGE-AUDIT.md). The historical receipt below is unchanged.

## Historical receipt and regeneration

`results/2026-10-15-manan.json` is retained unchanged as history. Its
`repositoryCommit` is `46fd40f070013e9ff15947afc95aba31c6a5bcb0`, which predates
the committed Suite B harness. It cannot reproduce the harness from that
revision and has no clean-source provenance. Its numbers are historical
observations, not eligible release evidence.

Regenerate only after the harness, cases, manifest, and validator changes
are committed. Use a clean checkout of that revision with dependencies
installed, then run:

```bash
node benchmarks/repair-rounds/harness.selftest.mjs
node benchmarks/repair-rounds/harness.mjs verify --runner release-<short-commit>
node benchmarks/repair-rounds/harness.mjs report
```

Choose a new runner name so the historical receipt is never overwritten.
Check that all 8 cases pass and the new receipt names the actual clean
source commit, then commit only the new receipt in a follow-up evidence PR.
Its source revision should be the preceding implementation commit; the
receipt cannot pin a commit that already contains itself. No new pinned
receipt is generated while these source fixes remain uncommitted.

## What this can and cannot claim

**Can claim after eligible regeneration:** `validateModel` deterministically
detects these 8 failure classes against this fixture; diagnostic codes,
wording, stages, first-disclosure, and actionability are reproducible against
the clean source commit and built validator hashes.

**Cannot claim:** anything about live model repair quality or rounds — no LLM
participates here. The rules-only stub is a lower bound on mechanical
actionability, not a proxy for model behavior. `skipped`/absent cases keep
the matrix incomplete (exit 2), never pass.

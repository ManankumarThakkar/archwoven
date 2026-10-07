# M1 Synthesis — probe results and SPEC calibration

## Go/no-go matrix

| Probe | Question | Verdict | Key numbers |
|---|---|---|---|
| A — rendering | Can model JSON render + export as interactive diagrams? | **GO** | golden 626×480, 0 overlaps; stress 39 nodes 1231×3548, 0 overlaps; PNG via resvg-wasm |
| B — Claude structured | Does hosted structured output hit validity/token targets? | **CONDITIONAL GO** | mock suite 28/28 (parse + repair + cache shape); **live eval pending API key** — the only open M1 item |
| C — extraction | tree-sitter WASM extracts Spring/FastAPI structure in-app? | **GO** | fixtures ≥0.9 precision / ≥0.8 recall; petclinic 50 files → 18 nodes/13 edges/17 endpoints in 46 ms, ~100% manual precision |
| D — local model | Can gpt-oss:120b carry the private path? | **GO** | 6/6 schema-valid (100%), 42-node stress intact, warm TTFT 0.3 s, 65 GB disk |

**M1 status:** three green, one conditional (B live eval blocked on `ANTHROPIC_API_KEY`, ~$0.50–1.00 of the approved ≤$5 budget). The mock suite already proves the parse/repair/cache plumbing; the live run calibrates real token counts and first-pass validity.

## Measured cost/task

| Path | Per task | Notes |
|---|---|---|
| Hosted generate (B, design estimate) | ~$0.01–0.03 cached | opus-5.5, cached system prefix; live numbers pending |
| Extraction (C) | $0 | pure local compute, 46 ms/repo |
| Local generate (D) | $0 marginal | electricity + 65 GB disk; 27–171 s/task |

## §11 target calibration (proposal → measured)

| Target | Proposed | Measured | Action |
|---|---|---|---|
| First-pass schema validity | ≥95% | local 5/6 (83%) first-pass, 6/6 post-repair | keep ≥95% for hosted (B live will settle); local path target ≥80% first-pass / ≥97% post-repair |
| Render-after-repair | ≥99% | A: 100% (0 overlap failures across golden+stress) | locked ≥99% |
| Fixture precision/recall | ≥0.85/0.80 | C: ≥0.9/≥0.8 fixtures; ~1.0 precision petclinic | locked ≥0.85/0.80 (headroom kept for M3 real repos) |
| Tokens per plain-English task | ≤6k in + 1.5k out | pending B live | unchanged |
| Unsupported-claim rate | ≤5% | M3 (evidence pipeline) | unchanged |
| Private-mode external calls | 0 | D path: 0 external calls by construction | M4 boundary suite will prove |

## SPEC promotions ([REC] → locked)

1. **WASM bundling pattern** (C): server packages touching native/WASM stay out of webpack — esbuild dist + explicit externals; `serverExternalPackages` alone is insufficient for workspace-linked packages (Next 15.5.27). M2's `/api/extract` inherits this.
2. **Local-path serving model** (D): gpt-oss:120b via Ollama, `keep_alive` + preload ping to kill the 55 s cold TTFT; hardware floor 64 GB Apple Silicon.
3. **Gap-listing discipline** (C): unresolvable constructs (computed prefixes, `${VAR}`, `@ManyToMany`, inverse relations) become explicit gap strings — never guesses. Provenance stays honest.

## M2 plan adjustments

- `/api/extract` route: allow-list repo paths (probe-c pattern), nodejs runtime + externals.
- Metering (§15): `TaskUsage` from both client.ts and local.ts feeds the credit ledger; local generations cost 0 credits but still meter latency.
- UI: streaming progress states are mandatory (D showed 30–170 s totals are normal for large outputs).
- M3 stress queue: multi-module monorepo + `@ManyToMany` extraction + inverse-side labels (petclinic gap list).

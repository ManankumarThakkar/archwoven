# Provider evaluation

Representative real-provider results for the hosted path: first-pass validity, repair success, latency, cost and cache savings across every diagram type, refinements and repository imports, plus diagram-level accuracy against hand-checked ground truth.

```bash
# against a running server (hosted mode, real provider) and its database
node benchmarks/provider-eval/run.mjs http://127.0.0.1:<port> <server.db> <outDir> --budget 7.5
node benchmarks/provider-eval/score.selftest.mjs   # diagram-scoring rules (also part of pnpm bench:selftest)
```

- `cases.json`: 20 descriptions (10 architecture, including the three Suite A prompts and one deliberately vague prompt; 4 sequence; 3 ER; 3 component), 6 refinements and 4 repository imports pinned to a commit. Cases run in the listed order, so a budget stop skips the least important ones.
- Each description or import runs in its own session and simulated network address, so credit pools and burst limits do not shape results. Refinements reuse the session of the diagram they change.
- Per-call outcome (`ok` = valid on the first attempt, `repaired`, `failed`), repairs, tokens and cost come from the server's own metering (`call_log`). Latency is end to end: request accepted to job finished, polled every 200 ms.
- Suite A cases also run the Suite A semantic and validation gates; their receipts are in `../ordinary-model-floor/results/`.
- Imports with ground truth (`probes/ground-truth/*.json`) are scored at diagram level by `score.mjs`. An assembled node stands for a truth node when its evidence cites the truth line, or when its whole name matches (case, punctuation, camel case and plurals ignored). Precision counts only nodes and edges the diagram claims are `source-supported`; inferred and proposed additions are reported separately, not as errors.

## Results: 2026-10-17, hosted `claude-opus-5-5`

Run against an isolated production build on one machine, cases one at a time, with no other load. Spend: $4.37 metered (cap $8). Raw results and all 30 saved diagrams: `results/2026-10-17-hosted/`.

| | ran | succeeded | valid on first attempt | latency p50 / p90 / max | cost |
|---|---|---|---|---|---|
| Descriptions | 20 | 20 | **0 / 20** | 52.3 / 71.3 / 78.1 s | $3.18 ($0.16 each) |
| · architecture | 10 | 10 | 0 / 10 | 52.4 / 77.9 s | $1.67 |
| · sequence | 4 | 4 | 0 / 4 | 36.0 / 55.0 s | $0.51 |
| · ER | 3 | 3 | 0 / 3 | 52.3 / 68.0 s | $0.48 |
| · component detail | 3 | 3 | 0 / 3 | 53.0 / 71.3 s | $0.52 |
| Refinements | 6 | 6 | 5 / 6 | 4.3 / 9.2 / 9.2 s | $0.10 |
| Repository imports | 4 | 4 | **0 / 4** | 74.6 / 98.6 / 98.6 s | $1.09 |

- **Validity after repair:** 30 of 30 saved diagrams pass `validateModel`; no case failed. Suite A semantic and validation gates passed 3 of 3.
- **Cache:** descriptions read 178,350 cached prompt tokens against 111,304 uncached input tokens. That saved an estimated $0.67 at the app's price table after the cache-write premium, which is 21 % of description spend ($3.18). Imports saved an estimated $0.08 and refinements $0.02. These are estimates from `PRICES` in `packages/jobs/src/quota.ts`, not provider invoices.
- **Clarification:** none of the 20 descriptions asked a clarification question. The vague prompt "A blog." produced a minimal diagram in which only "Blog App" is marked user-specified; readers, authors and the posts database are inferred, a CDN and media storage are proposed, and three open questions are listed.
- **With only 20 descriptions, p90 is a rough tail estimate,** not a service-level figure.

### Diagram-level accuracy against ground truth

| import | truth nodes found | truth edges found | source-supported node precision | source-supported edge precision | inferred/proposed additions |
|---|---|---|---|---|---|
| FastAPI full-stack template | 10 / 12 | 12 / 16 | 10 / 10 | 12 / 12 | 0 |
| spring-petclinic | 19 / 19 | 10 / 10 | 19 / 19 | 10 / 10 | 0 |

The assembled diagrams kept everything the extractor found and claimed nothing extra as source-supported. The template misses are the extractor's known SMTP and Sentry gaps (`docs/EXTRACTION-GROUND-TRUTH.md`). This covers two repositories whose extractor output was tuned against the same truth, so it measures assembly faithfulness, not extraction on unseen code.

### Why first attempts failed (fixed in task 19b)

A follow-up diagnostic replayed four descriptions (one per diagram type, about $0.7, outside the metered run) and recorded the validator feedback for every repair. In all four, the first schema-valid attempt failed for one reason: every `evidence` entry was free text, for example `"evidenceJson": "[\"User: an HTTP controller\"]"`, where the schema requires evidence objects. One attempt also returned output that was not valid JSON.

The cause was the hosted prompt contract. It carried the API-grammar workaround that sends evidence as an opaque JSON-encoded string, so the element shape never reached the model. Hosted generation does not use the grammar, so every description and import paid at least one repair round.

## After the fix: 2026-10-17, task 19b

Hosted descriptions and imports now receive the same native-values contract as the local model, so evidence objects, ER fields and sequence values are all visible in the schema. The prompt is slightly smaller (8,345 against 8,475 characters). A second diagnostic then found the remaining repairs: complete models wrapped in one Markdown ```` ```json ```` fence. Exactly that wrapper is now removed before parsing; any other surrounding text still goes through repair.

Both steps were measured on a subset of the same cases (approved cap $1.50; $0.97 metered plus about $0.21 estimated for the diagnostic). Results are in `results/2026-10-17-hosted-19b-*`.

| same 7 descriptions | valid on first attempt | latency median / max | cost |
|---|---|---|---|
| task 19 baseline | 0 / 7 | 33.8 / 59.2 s | $0.76 |
| evidence contract only | 3 / 7 | 19.4 / 50.4 s | $0.48 |
| evidence contract and fence unwrap | **7 / 7** | **14.2 / 29.1 s** | **$0.27** |

- **The 7 cases:** the three Suite A prompts, one more architecture case, and one sequence, one ER and one component case. All 7 diagrams validate and the Suite A gates passed 3/3 in both subset runs.
- **The import and the refinement** ran only in the evidence-only subset. The FastAPI template import kept its baseline accuracy (10/12 nodes, 12/16 edges, 100 % source-supported precision) but still needed one repair; that run predates the fence fix, so import first-pass validity after both fixes is unmeasured. The refinement needed one repair (baseline 5/6 first-pass); refinements use the API grammar and are unaffected by either change.
- **Sample size:** seven cases show the failure mode is gone; they do not give a first-pass rate for every prompt.

### Imports after the fix: 2026-10-17

The four pinned imports from the task 19 baseline were re-run on `main` at `43dbc19` (hosted `claude-opus-5-5`, approved cap $1, $0.67 metered). Results are in `results/2026-10-17-hosted-imports-after-19b/`.

| import | task 19 baseline | after the task 19b fixes |
|---|---|---|
| FastAPI full-stack template | repaired · 68.7 s · $0.25 | first attempt · 28.2 s · $0.10 |
| spring-petclinic | repaired · 98.6 s · $0.34 | first attempt · 46.3 s · $0.14 |
| fastapi-realworld | repaired · 74.6 s · $0.26 | first attempt · 35.1 s · $0.10 |
| spring-realworld | repaired · 83.8 s · $0.25 | repaired · 92.8 s · $0.32 |
| total | 0 / 4 first attempt · $1.09 | 3 / 4 first attempt · $0.67 |

- **Validity and accuracy:** all four diagrams validate. Diagram-level accuracy is unchanged: the template has 10/12 nodes and 12/16 edges, petclinic 19/19 and 10/10, both at 100 % source-supported precision with nothing extra claimed.
- **The remaining repair:** spring-realworld still needed one repair round. Its cause was not diagnosed, because a diagnostic run would have exceeded the approved cap.
- **Follow-up diagnosis (approved cap $0.50, $0.27 spent):** spring-realworld was re-run twice on `main` at `ddd4b8a`, with `capture-repairs.mjs` recording any repair feedback. Both runs were valid on the first attempt (43.3 s · $0.15 and 38.9 s · $0.12), so no repair was captured. Since the fix, imports have been valid on the first attempt in 5 of 6 runs, and spring-realworld in 2 of 3. The one repair is intermittent model variance that the repair loop absorbs, not a reproducible defect. Results: `results/2026-10-17-hosted-import-diagnosis/`.
- **Diagnosing future repairs:** start the evaluation server with `capture-repairs.mjs` preloaded (usage in its header). Any repair in that run then records the rejected output and the validator feedback, with no extra provider calls.

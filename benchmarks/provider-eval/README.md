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

### Why first attempts fail

A follow-up diagnostic replayed four descriptions (one per diagram type, about $0.7, outside the metered run) and recorded the validator feedback for every repair. In all four, the first schema-valid attempt failed for one reason: every `evidence` entry was free text, for example `"evidenceJson": "[\"User: an HTTP controller\"]"`, where the schema requires evidence objects. One attempt also returned output that was not valid JSON.

The cause is the hosted prompt contract. It carries the API-grammar workaround that sends evidence as an opaque JSON-encoded string, so the element shape never reaches the model. Hosted generation does not use the grammar. Every description and import therefore pays at least one repair round. This is recorded in `docs/OPEN-GAPS.md` and is the next fix, to be measured against this baseline.

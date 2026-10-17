# Suite A visual review

Suite A is evidence-eligible only when a named person reviews each rendered diagram. Software cannot record this gate for you, and `skipped` never counts as a pass.

The three diagrams below came from the real-provider run on 2026-10-17 (`benchmarks/provider-eval/results/2026-10-17-hosted/`). They already passed the semantic and validation gates. Each screenshot shows revision 1, exactly as generated and before the run's refinement step changed it, in the hosted workspace at 1440 × 900. The matching model is next to it. The header's "Last task" chip reflects that later refinement and is not part of the review.

| case | prompt | screenshot | model |
|---|---|---|---|
| todo-api | `../prompts/todo-api.txt` | `todo-api.png` | `todo-api.model.json` |
| checkout | `../prompts/checkout.txt` | `checkout.png` | `checkout.model.json` |
| boring-crud | `../prompts/boring-crud.txt` | `boring-crud.png` | `boring-crud.model.json` |

## What to check

For each diagram, record a failure for any defect you see (tags from `../manifest.json`):

- `clipping`: a label or node cut off
- `node-overlap` / `label-overlap`: shapes or text drawn over each other
- `hidden-route`: a connection running under a node or impossible to follow
- `stacked-edge`: two connections drawn on top of each other
- `weak-hierarchy`: the flow from user to data store is not readable at a glance
- `unbalanced-whitespace`: large empty areas or crowded clusters
- `theme-contrast`: text or lines hard to read against the background

To review interactively instead of from the screenshot, describe the prompt in a running workspace with the same diagram type. The diagram will differ in detail, so record verdicts against these screenshots.

## Recording a verdict

From the repository root, with your own name:

```bash
node benchmarks/ordinary-model-floor/harness.mjs record-visual todo-api pass "Your Name"
node benchmarks/ordinary-model-floor/harness.mjs record-failure checkout hidden-route   # one line per defect
node benchmarks/ordinary-model-floor/harness.mjs record-visual checkout fail "Your Name"
node benchmarks/ordinary-model-floor/harness.mjs report   # 0 = eligible, 1 = a failure, 2 = incomplete
```

Commit the resulting `results/<date>-<runner>.jsonl` receipt. A recorded defect keeps the case failing until a later visual pass by a reviewer.

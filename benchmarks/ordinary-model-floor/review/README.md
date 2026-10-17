# Suite A visual review

Suite A is evidence-eligible only when a named person reviews each rendered diagram. Software cannot record this gate for you, and `skipped` never counts as a pass.

The three diagrams below came from the [real-provider run on 2026-10-17](../../provider-eval/results/2026-10-17-hosted/). They already passed the semantic and validation gates. Each screenshot shows revision 1, exactly as generated and before the run's refinement step changed it. The captured workspace image is 1440 × 813 pixels. The matching model is next to it and matches the provider run's saved model. The header's "Last task" chip reflects that later refinement and is not part of the review.

These are historical captures from task 19, before the PR #37 workspace fixes. They support review of those generated diagrams; they do not establish current cross-browser or accessibility acceptance. No human verdict has been recorded for them.

| case | prompt | screenshot | model |
|---|---|---|---|
| todo-api | [prompt](../prompts/todo-api.txt) | [screenshot](todo-api.png) | [model](todo-api.model.json) |
| checkout | [prompt](../prompts/checkout.txt) | [screenshot](checkout.png) | [model](checkout.model.json) |
| boring-crud | [prompt](../prompts/boring-crud.txt) | [screenshot](boring-crud.png) | [model](boring-crud.model.json) |

## Opening the evidence

All three images and models are included in a fresh checkout. From the repository root, check their integrity:

```bash
cd benchmarks/ordinary-model-floor/review
shasum -a 256 -c SHA256SUMS
```

On Linux, `sha256sum --check SHA256SUMS` is equivalent and runs in CI. A missing or changed file fails the check. If deliberately replacing evidence, capture the matching model and screenshot together, update the provenance above and the checksums, and obtain a new visual review. Checksums verify the files, not diagram quality.

Open the screenshot links above, or serve the saved files locally (from the repository root):

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory benchmarks/ordinary-model-floor/review
```

Then open `http://127.0.0.1:8765/`. This requires no API key, model call or application database. Stop the server with Ctrl+C.

## What to check

For each diagram, record a failure for any defect you see (tags from `../manifest.json`):

- `clipping`: a label or node cut off
- `node-overlap` / `label-overlap`: shapes or text drawn over each other
- `hidden-route`: a connection running under a node or impossible to follow
- `stacked-edge`: two connections drawn on top of each other
- `weak-hierarchy`: the flow from user to data store is not readable at a glance
- `unbalanced-whitespace`: large empty areas or crowded clusters
- `theme-contrast`: text or lines hard to read against the background

Record verdicts against these screenshots. Generating the prompt again creates a different sample and can incur provider charges; its appearance cannot establish a verdict for the saved evidence.

## Recording a verdict

After installing dependencies and running `pnpm build:packages`, run these commands from the repository root with your own name. These are examples: choose pass or fail only after reviewing each screenshot.

```bash
node benchmarks/ordinary-model-floor/harness.mjs record-visual todo-api pass "Your Name"
node benchmarks/ordinary-model-floor/harness.mjs record-failure checkout hidden-route   # one line per defect
node benchmarks/ordinary-model-floor/harness.mjs record-visual checkout fail "Your Name"
node benchmarks/ordinary-model-floor/harness.mjs report   # 0 = eligible, 1 = a failure, 2 = incomplete
```

Commit the resulting `results/<date>-<runner>.jsonl` receipt. A recorded defect keeps the case failing until a later visual pass by a reviewer.

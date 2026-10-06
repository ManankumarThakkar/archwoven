# Probe A — Rendering & Export — **GO** (2026-10-06)

**Question:** Can we render architecture/ER (React Flow + ELK) and sequence (custom SVG) from our typed model, and export sharp PNGs, with zero node overlaps?

## Measured results
| Check | Result |
|---|---|
| Golden architecture view (7 nodes, 7 edges) | laid out **626×480**, **0 overlaps** (pad 8px) |
| Stress fixture — 39 nodes / 55 edges, bidirectional chain + 2 self-loops | laid out **1231×3548**, **0 overlaps**, all coords finite |
| ER custom nodes (header + fields + PK badges, height ∝ field count) | renders; entity sizing verified |
| Sequence SVG (4 participants, 5 messages, `alt` fragment) | pure model→SVG, no `foreignObject`, no remote refs (xmlns only), all labels XML-escaped |
| PNG export (resvg-wasm @2×) | valid PNG, IHDR dims ≥ source, >10 KB, fonts embedded |
| CI | 23/23 tests green (layout 4, sequence 4, export 2, model 13) |

## Gotchas found (pinned, so nobody re-learns them)
1. **resvg-wasm `fontBuffers` must be `Uint8Array[]`** — passing `ArrayBuffer` throws an opaque wasm error. Browser path wraps `fetch().arrayBuffer()` in `new Uint8Array(...)`.
2. **resvg-wasm has no system fonts** — Inter 400/600 WOFF2 vendored to `public/fonts/`; export without them renders blank text.
3. **`elkjs/lib/elk.bundled.js`** runs main-thread in browser *and* Node — one code path, no worker plumbing for the probe. ELK handled self-loops and bidirectional pairs with zero manual tweaks (`selfloopDistribution: NEAREST_SECTOR`).
4. **JSON imports widen literals** — fixtures are exported pre-parsed (`SystemModelSchema.parse`) from `@archwoven/model` so consumers get the real `SystemModel` type.

## Verdict & follow-ups for M2
- **GO** on the full rendering stack. `layoutModel`/`sequenceSvg`/`renderPng` promote verbatim.
- Stress canvas is tall (3548px) — layered DOWN on a wide graph; M2 should auto-pick `elk.direction` by graph aspect ratio.
- Probe page ships 623 kB first-load (React Flow + ELK + resvg-wasm) — M2 code-splits: dynamic-import the sequence renderer + lazy wasm init.
- ELK edge sections captured but unused — M2 maps them to exact bezier paths instead of React Flow defaults.

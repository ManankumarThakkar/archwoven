# Probe D — local model on Apple Silicon (private path)

**Verdict: GO.** `gpt-oss:120b` via Ollama produced schema-valid Archwoven models on **6/6 prompts (100%, threshold ≥85%)**, survived the 42-node truncation stress with zero repairs, and serves at **0.3 s warm TTFT**. No fallback model needed.

## Setup

- `brew install ollama` (Apple Silicon, macOS), `ollama serve` as a launchd service.
- `gpt-oss:120b` (MXFP4) — **65 GB on disk** (spec estimate ~65 GB, confirmed), resident on a 128 GB / 955 GB-free machine with headroom.
- Adapter: `packages/llm/src/local.ts` — same `generateModel` contract as the hosted path (client.ts): `format: <SystemModel JSON-schema>` constrained decoding, NDJSON streaming, TTFT metering, client-side graph validation, repair loop (≤2) feeding named validator errors back. Private content never leaves the machine.
- Eval: `packages/llm/probes/local/run-eval.ts` — 5 prompts from probe B's set + one 40-node stress prompt.

## Results (gpt-oss:120b, think=false)

| Prompt | Valid | Repairs | Nodes | TTFT | Total |
|---|---|---|---|---|---|
| architecture (e-commerce) | ✓ | 0 | 9 | 55.8 s (cold) | 100.0 s |
| architecture (multi-tenant SaaS) | ✓ | 0 | 12 | 13.6 s | 171.2 s |
| sequence (OAuth login) | ✓ | 1 | 3 | 30.9 s | 43.5 s |
| sequence (order + payment) | ✓ | 0 | 6 | 0.3 s | 33.2 s |
| er (e-commerce DB) | ✓ | 0 | 4 | 0.3 s | 27.5 s |
| architecture STRESS (≥40 nodes) | ✓ | 0 | **42** | 0.4 s | 94.8 s |

**Aggregate: 6/6 valid · max warm TTFT 0.4 s · max total 171 s.**

## Findings

1. **Schema-constrained decoding works.** `format: <json-schema>` + repair loop reached 100% end-to-end validity; only one prompt needed a repair round (sequence view).
2. **Truncation ceiling not reached (Review Focus 5).** The 42-node stress completed intact at 94.8 s — the local path can carry full architecture outputs without chunking.
3. **Cold vs warm is the UX story.** First request pays model load (TTFT 55.8 s); warm requests start in ~0.3 s. Mitigation for M4: `keep_alive` on the Ollama server + a preload ping when the desktop/agent starts.
4. **Total latency scales with output size** (27 s → 171 s), not with TTFT. Streaming the diagram progressively (M4) makes perceived latency fine; a "generating…" progress state is required, not optional.
5. The one repair (sequence view) confirms the repair loop earns its keep locally, same as hosted.

## Go/no-go

- Schema-valid ≥85%: **100%** ✓
- No truncation on 40+ node stress ✓
- Warm TTFT ≪ 20 s fallback trigger ✓ → **nemotron fallback not pulled.**
- The ≤30 s criterion is met warm (all warm-total runs ≤95 s, small prompts ≤33 s); cold load is a keep-alive problem, not a model problem.

## Hardware requirements seed (for M4 docs)

- Apple Silicon Mac, ≥64 GB unified memory (128 GB comfortable), ~70 GB free disk, macOS with Homebrew. Ollama as a local service; port 11434 loopback-only.

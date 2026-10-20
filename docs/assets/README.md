# README visuals

- `cover.svg` is original product artwork using the site’s cream/forest palette and interwoven mark. Regenerate `cover.png` with `node scripts/render-readme-cover.mjs`.
- The four diagram PNGs capture the actual viewer using real-provider outputs recorded on 17 October 2026. Source models are in [`benchmarks/provider-eval/results/2026-10-17-hosted-19b-evidence-and-fence/models`](../../benchmarks/provider-eval/results/2026-10-17-hosted-19b-evidence-and-fence/models). `screenshots.json` maps each image to its model.
- `task-usage.jpg` is the actual production report from the public `mcp-observatory` import checked on 20 October 2026: 14,748 input tokens, 778 output tokens, 595 cache-write tokens, no cache reads, no repairs and no retries; API estimate $0.077527. It is an example, not a price guarantee.
- The README film is the current 32-second landing asset, [`archwoven-overview-v1.mp4`](../../apps/web/public/media/archwoven-overview-v1.mp4). The earlier film is not used.

To refresh the gallery, start a disposable local-mode server with `ARCHWOVEN_DB` pointing to a temporary database, then run:

```bash
node scripts/capture-readme.mjs http://127.0.0.1:3160 /path/to/browser-tools
```

The tools directory must contain `playwright-core` and a Chromium installation.
The capture imports recorded models and never asks a provider to generate them.
Do not point it at production or a database containing personal work.

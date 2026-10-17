# M2 demo walkthrough (recruiter, ~10 min)

> Historical milestone transcript. The setup commands, credential status and feature
> limits below describe that earlier run. Use the current [README](../README.md)
> for installation and the [release acceptance record](RELEASE-ACCEPTANCE.md) for
> current verification. The demo evidence below does not establish real-provider behavior.

A scripted end-to-end run of the plain-English vertical slice with §15 fair-use enforcement. Honest note up front: the **live hosted-model** step requires a valid direct `sk-ant-…` key (the current `.env.local` key 401s against `api.anthropic.com`, and Claude Code's local proxy drops structured-output config — see `docs/probes/B-claude-structured.md`). The flow below is **verified end-to-end in `ARCHWOVEN_FAKE=1` mode** (canned model, zero spend); swapping in a working key changes only the model's output, not the plumbing.

## Setup
```bash
echo 'ANTHROPIC_API_KEY=sk-ant-…' > .env.local   # valid DIRECT key (see blocker note above)
pnpm install
pnpm --filter web build
# FAKE mode in production requires an explicit demo ack (assertSafeRuntime guard):
ARCHWOVEN_FAKE=1 ARCHWOVEN_DEMO_ACK=1 pnpm --filter web start   # or drop FAKE for real model
# open http://localhost:3000
```

## Script
1. **Home → workspace.** Root redirects to `/workspace`. App bar shows the privacy chip (`🔒 private · external-allowed`) and the credit meter (`◐ 6/6 today`) — both visible before any submit.
2. **Pick an example (scenario 1).** Click "E-commerce platform" → prompt prefills. No model call, credits unchanged. Type your own and the overwrite guard confirms first.
3. **Switch view (scenario 2).** Tabs (architecture / sequence / er / component-detail) swap the example chips; your typed prompt is preserved.
4. **Generate.** Watch the honest stage names stream from job polling: *Validating → Designing → Checking the model → Arranging the diagram*. The canvas renders the model; proposed nodes carry a distinct border/badge from source-supported (scenario 6).
5. **Inspect (scenarios 4, 5).** Click a node → provenance badge, role blurb, evidence links pinned to the analyzed commit (`…/blob/<sha>/…#L<line>`), and any open questions blocking it.
6. **Refine (scenarios 7, 8).** Type "add a redis cache" → the change-summary strip shows `+Cache service`, revision bumps, unrelated nodes/layout untouched. A refine that produces an invalid patch returns 502 and leaves the prior diagram intact.
7. **Undo.** `↶ Undo` restores the previous revision.
8. **Export (scenario 13).** SVG downloads the current view, readable and matching the selection. (PNG text needs bundled fonts — M4.)
9. **Quota ladder (scenario 12).** Generate past the daily free limit → the friendly 429 copy: *"You've used today's free generations — resets in Xh Ym. Sign in with GitHub for 30/day."*

## Verified evidence (fake mode, zero spend)

End-to-end HTTP flow against `next start`:
```
generate: 202 → succeeded rev 1
loaded:   rev 1  nodes 10  views 3
refine:   200  rev 1 → 2  nodes 10 → 11  summary ["+Cache service"]
stale:    409  (rebase payload carries latest; canvas now stays visible)
```

Quota ladder (`apps/web/e2e/quota-smoke.mjs`):
```
generate #1..#6 accepted (202) · #7 blocked (429)
reset copy + GitHub upsell present → ALL PASS
```

Guardrails verified live (post-review):
```
/api/quota:        {"remaining":6→5,"pool":6,"tier":"anonymous","fake":true}
cross-session:     GET /api/models|jobs/<id>, refine, undo → 404 for other session
undo:              POST /api/models/<id>/undo {prevRevision} → forward rev 2, durable
boot guard:        production + ARCHWOVEN_FAKE without ARCHWOVEN_DEMO_ACK → refuses to start
header chips:      live credit meter (6→5), privacy from model.privacy, DEMO DATA banner in fake mode
```

## Real-key run (pending)
When a valid direct key is in place, run steps 2–9 against the live model with `ARCHWOVEN_FAKE` unset; each call logs to `call_log` (tier, view, tokens, cost, retries, outcome) and the demo spend stays ≤ $0.30 (a few generates + refines at effort low). First-pass-validity numbers land in `docs/probes/B-claude-structured.md`.

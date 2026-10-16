# M5 private-mode matrix — eligibility, honestly

Historical snapshot. Current merged-source verification, superseded blockers and remaining work: [post-merge audit](POST-MERGE-AUDIT.md).

Scenarios from the master spec's private vertical (§8/§9). A row is **live** only
when a real run on this machine produced the artifact; **stub** = canned fixture in
tests; **CI** = runs in GitHub Actions; **PENDING** = not yet done (never claimed).

| scenario | gate | unit/stub | CI | live (this machine) | evidenceEligible |
|---|---|---|---|---|---|
| 9 · local generate, server-stamped privacy, egress guard | privacy=private·local-only + zero blocked + guard refuses hosted | ✓ (mode/quota/stamp suites) | ✓ (parity job) | ✓ M5-CHECKS §3 (gpt-oss:20b, job `21fb61a7`) | **yes** |
| 10 · localPath repo import, evidence pinned to clone HEAD | succeeded + commit==clone HEAD + private stamp | ✓ (`repo/route.test.ts` localPath block) | ✓ (parity job) | ✓ M5-CHECKS §4 (`500158f…` exact) | **yes** |
| 11 · exports cannot carry executable markup | no `<script>`, no evidence paths in PNG/SVG | ✓ (task-4 suites) | ✓ | ✓ M5-CHECKS §6 (PNG opened, SVG parsed) | **yes** |
| 14 · parity: same suite, both modes | full `pnpm test` green hosted **and** local | ✓ 312/312 · 297+15-skip | ✓ parity job | ✓ M5-CHECKS §7 | **yes** |
| refine on private path (part of 9's flow) | EditOps apply + stamp preserved | ✓ | ✓ | ⚠ first attempt failed honestly (M5-CHECKS §5), explicit-id attempt passed | yes, with caveat |
| GitHub OAuth private repos (hosted) | — | — | — | — | **no — M6** (ledgered deferred) |

## Honest caveats

- Live model is **gpt-oss:20b** (plan said 120b; 65 GB resident crashed the box).
  Probe D re-run 7/7 valid, but repairs 4/7 vs 120b's 1/7 — weaker first-pass
  precision, carried by the ≤2 repair loop (`OLLAMA_MODEL` override documented).
- `pnpm dev` cannot host live jobs (hot-reload store reopen kills in-flight jobs —
  M5-CHECKS §1); live evidence uses `next start`, the same server compose ships.
- Hosted-key-dependent rows from M4 (bench visual review, live extraction) stay
  PENDING; M5 claims none of them.

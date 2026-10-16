# M4 scenario checks — live fake-mode transcripts (2026-10-10)

Historical snapshot. Current merged-source verification, superseded blockers and remaining work: [post-merge audit](POST-MERGE-AUDIT.md).

Fake server: `ARCHWOVEN_FAKE=1 ARCHWOVEN_DEMO_ACK=1 ARCHWOVEN_DB=/tmp/aw-m4.db PORT=3111 pnpm start` (apps/web).

## 1. Semantic fields flow end-to-end (describe → store → serve)

```
POST /api/generate {"prompt":"fake shop","view":"architecture","idempotencyKey":"m4-sem-1"} → 202
job → succeeded, modelId ba6d886b-…
GET /api/models/ba6d886b-…:
  semanticChecks: {"allowedRoots":["actor.user","entity.user"],
                   "allowedTerminals":["external.stripe","datastore.postgres","datastore.redis","entity.user","entity.product"],
                   "requiredEdges":[{"from":"actor.user","to":"gateway.api","type":"sync"}],
                   "requiredPaths":[{"from":"actor.user","to":"datastore.postgres"}]}
  mainPath: ["actor.user","gateway.api","svc.orders"]
  guidedViews: ["Request path"]   boundaries: ["Core platform"]   edge roles: ["main"]
```

## 2. Share-card endpoint (§15 burst, weight 0)

```
POST /api/share-card {modelId, kind:"route", from:"actor.user", to:"datastore.postgres"}
  → 200 image/png 22249B, magic bytes 89 50 4e 47
POST … cookie aw_sid=mallory → 404 (ownership)
burst ladder (same session, same minute): generate consumed 1, route card 2,
reach 3, 4 → 200; call 5 → 429 {"reason":"burst","message":"Slow down a touch …"}
credits table after all card calls: [] — zero credits spent (weight 0, pools untouched)
```

## 3. Backward compatibility — pre-M4 stored revision

A revision written in the pre-M4 shape (no `semanticChecks`/`boundaries`/`guidedViews` keys) stored directly to the live SQLite:

```
GET /api/models/pre-m4-model → 200, title "E-commerce Platform", has semanticChecks key: false
POST /api/share-card on the same pre-M4 model → 200 PNG
```

Unit-level: `schema.test.ts` "pre-M4 fixture validates unchanged"; the full pre-M4
suite stayed green across all M4 tasks.

## 4. Viewer interaction (click-level — human browser pass pending)

Automated evidence: workspace bundle `page-455f8bb65a788de6.js` contains the M4
viewer markers (`archwoven-motion`, `aw-route-current`, `aw-chapter-focus`).
The pure layer (reachability/journey/motionMode) is pinned by 13 unit tests
including cycle termination and 700-node scale. **Click-through — focus click,
probe playback stepping, chapter camera reveal, Still toggle, permalink deep
links — needs a human browser pass before merge** (no browser automation in this
harness; recorded as a ledger ruling).

## 5. Benchmark harness in CI

```
node benchmarks/ordinary-model-floor/harness.selftest.mjs → 13 checks, exit 0
node benchmarks/ordinary-model-floor/harness.mjs report (empty matrix) → exit 2,
  "evidenceEligible: false (full matrix incomplete)" — honest incompleteness, never a fake pass
```

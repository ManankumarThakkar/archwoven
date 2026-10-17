# Extraction ground truth

How well the Spring Boot and FastAPI extractors recover structure from real repositories, measured against hand-checked ground truth. Numbers are published verbatim, misses included (SPEC §13).

Run: 2026-10-17 with `pnpm build:packages && node apps/web/e2e/ground-truth.mjs`. Each repository goes through the product ingest pipeline (pin → codeload → safe unpack → detect → extract) at a pinned commit. No model is called, so these numbers measure the deterministic extraction that the model is later told to assemble from, not the final diagram.

## Protocol

- **Ground truth** lives in `probes/ground-truth/*.json`, one file per repository, pinned to a full commit SHA. Every expected node, edge and endpoint cites the file and line that proves it, so a reviewer can check each one. Each file also lists what was deliberately excluded (for example static mounts, Pydantic request models, GraphQL resolvers).
- **Matching** is exact: nodes by kind and label, edges by source and target label, endpoints by method and full path. Recall is matched/expected; precision is matched/extracted. Labels follow the extractor's naming conventions (`items-router`, SQLModel default table names, Java class names); that is naming, not a judgement about structure.
- **Development repositories** (petclinic, the FastAPI full-stack template) had full node, edge and endpoint truth written after one look at the unmodified extractor's output and before any extractor change in this task; the changes were then made with that truth visible. Their final numbers show what was fixed, not how the extractor generalises.
- **Held-out repositories** (two RealWorld implementations) had truth written from source before the extractor was run on them even once. Their first-run numbers are the generalisation measurement. They cover endpoints only, because complete node and edge truth for ~100-file repositories was not hand-authored; the file's `scope` field limits scoring to endpoints.
- Fixture tests (`probes/fixtures/repos/*`) now require an exact match to `expected.json`. The earlier precision ≥ 0.9 / recall ≥ 0.8 thresholds let real misses pass (probe C recorded one such masked miss).

## Development repositories

### fastapi/full-stack-fastapi-template @ `b1125d8` (`backend/`)

| construct | before | after |
|---|---|---|
| nodes | 7/12 · recall 58% · precision 100% | 10/12 · recall 83% · precision 100% |
| edges | 0/16 · recall 0% · precision 0% | 12/16 · recall 75% · precision 100% |
| endpoints | 0/23 · recall 0% · precision 0% | 23/23 · recall 100% · precision 100% |
| gaps surfaced | 0/1 | 1/1 |

Before, every route lost its prefix (`GET /{id}` instead of `GET /api/v1/items/{id}`), each router was wired straight to `app` instead of through `api_router`, and SQLModel tables, the `PostgresDsn` datastore and the `yield`-based session dependency were not found.

Still missed: the SMTP server (reached through `send_email` in `app/utils.py` and the `emails` library) and Sentry (`sentry_sdk.init`, optional), with their four edges. Both are third-party SDK calls behind helper functions, which needs call-graph inference that neither extractor does. They are listed in `OPEN-GAPS.md`.

### spring-projects/spring-petclinic @ `500158f`

| construct | before | after |
|---|---|---|
| nodes | 18/19 · recall 95% · precision 100% | 19/19 · recall 100% · precision 100% |
| edges | 7/10 · recall 70% · precision 100% | 10/10 · recall 100% · precision 100% |
| endpoints | 17/17 · recall 100% · precision 100% | 17/17 · recall 100% · precision 100% |
| gaps surfaced | 1/1 | 1/1 |

Before, the default embedded H2 database (a runtime dependency used when the default profile names no datasource URL) and three JPA relations (`Owner → Pet` and `Pet → Visit` via `@OneToMany` with `@JoinColumn`, `Vet → Specialty` via `@ManyToMany`) were missed. Repository-to-datastore edges are correctly withheld because three datastores are configured by profile; the extractor reports that as a gap.

## Held-out repositories (endpoints)

| repository | first run | after the two fixes below |
|---|---|---|
| nsidnev/fastapi-realworld-example-app @ `029eb77` | 0/19 · precision 0% | 19/19 · precision 100% |
| gothinkster/spring-boot-realworld-example-app @ `ee17e31` | 13/19 · precision 68% | 19/19 · precision 100% |

The first run found two general defects that the development repositories and fixtures had not exercised:

1. **FastAPI settings inherited indirectly.** All 19 routes were found with the right structure, but the `/api` prefix stayed an explicit `{settings.api_prefix}` placeholder (with a gap) because `AppSettings` inherits `BaseSettings` through `BaseAppSettings`. Settings classes are now recognised through their whole base chain, across modules. If two settings classes declare different defaults for one field, the prefix stays unresolved.
2. **Spring paths without a leading slash.** `@RequestMapping(path = "tags")` produced `tags` instead of `/tags`. Spring adds the missing slash; the extractor now applies the same rule to class and method paths. This defect predates this task.

After those fixes the held-out repositories are no longer held out. Further generalisation claims need new held-out repositories.

## What the extractors now cover

FastAPI:
- applications and routers bound to any name, including routers built inside factory functions
- `include_router` resolved through module attributes (`items.router`), aliases, re-exports and relative imports; nested routers; routers included more than once
- full paths composed from include prefixes, constructor prefixes (`APIRouter(prefix=…)`) and route paths, with `path=` keywords and `api_route(methods=[…])`
- prefixes from module constants; settings defaults used with a gap saying an environment override would change the paths; anything else shown as a `{expression}` placeholder with a gap
- `Depends` chains: factories that return or `yield` (directly, through a variable, or a `with … as` block), `Annotated` aliases, decorator `dependencies=[…]`, class dependencies (`Depends()`), transitively; database sessions become edges to the configured datastore
- SQLAlchemy and SQLModel (`table=True`) tables with foreign keys; datastores from settings URLs or DSN types (`PostgresDsn`, `MySQLDsn`, `MongoDsn`)
- route-shaped decorators on objects that are not applications or routers are ignored

Spring Boot:
- `@RequestMapping` on methods (one, several or no HTTP methods; no method is reported as `ANY`), multiple paths at class and method level, `value`/`path` elements, and `produces`/`consumes` ignored as paths
- path constants shown as `{Constant}` placeholders with a gap
- `@ManyToMany` (N:M) and unidirectional `@OneToMany` (1:N) relations; inverse sides (`mappedBy`) skipped because the owning side already states them
- embedded H2, HSQLDB or Derby from a non-test Maven or Gradle dependency when the default profile configures no datasource URL; `jdbc:h2:`/`jdbc:hsqldb:` URLs

## Limits of this measurement

- Four repositories, two per framework, with truth written by one reviewer. This is evidence, not a population estimate.
- Held-out truth covers endpoints only. Node and edge precision on unseen repositories is unmeasured.
- The measurement stops at the extracted fragment. The assembled diagram's precision and recall against human truth is part of the evaluation task (task 19).
- Exact label matching would score a correct node with a different naming convention as both a miss and an extra; none occurred in this run.

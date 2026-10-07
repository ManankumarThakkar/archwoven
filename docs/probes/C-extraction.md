# Probe C — tree-sitter extraction (repo path)

**Verdict: GO.** Both grammars extract the SPEC §3 constructs at ≥0.9 precision / ≥0.8 recall on hand-built fixtures, run inside a Next.js API route, and scale to a real repo (spring-petclinic, 50 Java files) in <50 ms with ~100% precision on a manual pass.

## Setup

- `web-tree-sitter` 0.27 (WASM) + `tree-sitter-java` 0.23.5 / `tree-sitter-python` 0.25 (npm-shipped `.wasm`, no native toolchain at runtime).
- `packages/extract` exposes `extractSpringBoot(dir)` / `extractFastApi(dir)` → `Fragment { nodes, edges, endpoints, gaps }`, every node carrying `Evidence { path, lines }`.
- Fixtures with hand-authored ground truth: `probes/fixtures/repos/spring-mini`, `probes/fixtures/repos/fastapi-mini` (`expected.json` per fixture).
- API-route smoke: `apps/web/app/api/probe-c/route.ts` (allow-listed fixture names — never an arbitrary-path reader).

## Precision / recall per construct

### Spring Boot (spring-mini + spring-petclinic)

| Construct | Result |
|---|---|
| `@RestController`/`@Controller`/`@Service`/`@Repository` → service nodes | ✓ all |
| `@Entity` + `__tablename__`-style naming → entity nodes | ✓ all |
| DI edges (`@Autowired` fields + constructor params) | ✓ all |
| Spring Data **interface** repositories (`extends JpaRepository`) | ✓ — injection site is the provenance (interfaces aren't `class_declaration`; extractor synthesizes the node on first injection) |
| `@ManyToOne`/`@OneToOne` owning-side → relation N:1 | ✓ (`Pet→PetType`) |
| `@OneToMany` inverse side | skipped by design — owning side only (M3 candidate for inverse labeling) |
| `@ManyToMany` (`Vet→Specialties`) | **missed** — gap-listed, M3 |
| `@KafkaListener` → queue + async edge | ✓ |
| `@*Mapping` + class `@RequestMapping` prefix, incl. root `"/"` | ✓ (root-path normalization bug found + fixed via test) |
| `yml`/`properties` jdbc → datastore + repo→datastore edges | ✓ MySQL + PostgreSQL (profile files) |
| `${VAR}` placeholders → explicit gaps | ✓ |

### FastAPI (fastapi-mini)

| Construct | Result |
|---|---|
| `FastAPI()` → gateway, `APIRouter()` → service | ✓ |
| `include_router(prefix="/x")` static prefix join | ✓ (`/orders/{order_id}`, `POST /orders`) |
| computed prefix (`settings.ROUTER_PREFIX`) | explicit gap ✓ |
| `Depends(factory)` → class via `return ClassName(` | ✓ `orders-router→OrderService` |
| SQLAlchemy `Base` + `__tablename__` → entity, `ForeignKey` → relation | ✓ `orders→users` N:1 |
| `BaseSettings` DATABASE_URL postgres → datastore; session-using services → datastore edge | ✓ (parse-order independent) |
| `httpx` URLs → external nodes | ✓ `payments.example.com` |
| `BackgroundTasks.add_task(fn)` → queue + async edge | ✓ `background:send_receipt` |

### spring-petclinic stress (real repo, no ground truth — manual pass)

18 nodes / 13 edges / 17 endpoints / 0 gaps in **46 ms**. Manual precision pass: every node, edge, and endpoint is real (~100% precision). Recall gaps found and labeled:

1. `@ManyToMany Vet→Specialty` missed (relation subset).
2. `@OneToMany` inverse sides (Owner→pets) not labeled — by design in M1.
3. DI heuristic resolves injected types by name suffix (`Repository|Service|Client`); domain-named components injected without a matching annotation would be dropped rather than guessed.
4. Datastore coverage matched what the repo actually declares (MySQL/PostgreSQL profile files; no jdbc URL in default `application.properties`).
5. Submodules/LFS: petclinic is single-module with no LFS — nothing to exercise here; multi-module monorepos remain an M3 stress case.

## WASM-in-route verdict

**Works — with one hard requirement.** Next.js webpack replaces `createRequire(import.meta.url)` with `undefined` when it bundles `web-tree-sitter` (whose ESM init needs real Node module resolution to locate its `.wasm` on disk). Symptom: `TypeError: createRequire is not a function` at runtime, 500s, while typecheck/build stay green — a pure runtime failure.

Fix (both required):
1. `@archwoven/extract` compiles to real JS (`dist/` via esbuild bundle + `tsc --emitDeclarationOnly`) — `main`/`types` point at `dist`.
2. `next.config.ts`: `serverExternalPackages: ['@archwoven/extract', 'web-tree-sitter']` **plus** explicit `webpack` externals (the `serverExternalPackages` entry alone did not externalize the workspace-linked package on Next 15.5.27).

Route timings after first compile: spring-mini 2 ms, fastapi-mini 8 ms. Path traversal (`?repo=../etc`) rejected with 400 + allow-list echo.

## Fallback

Not needed. `java-parser` (pure JS) stays as the documented fallback if a grammar WASM ever fails on a target platform; none observed.

## Go/no-go

**GO** — thresholds met on fixtures, petclinic gap list above is publishable, WASM-in-route pattern locked for M2's `/api/extract`.

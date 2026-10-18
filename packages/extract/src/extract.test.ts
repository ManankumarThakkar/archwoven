import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractSpringBoot, extractFastApi } from './index';

const FIXTURES = new URL('../../../probes/fixtures/repos/', import.meta.url).pathname;

interface Expected {
  nodes: { kind: string; label: string }[];
  edges: [string, string][];
  endpoints: [string, string][];
  gaps: string[];
}

function loadExpected(repo: string): Expected {
  return JSON.parse(readFileSync(`${FIXTURES}${repo}/expected.json`, 'utf8'));
}

/** Exact comparison against fixture ground truth: anything missing or extra is listed, never averaged away. */
function diff(fragment: Awaited<ReturnType<typeof extractSpringBoot>>, expected: Expected) {
  const labelOf = new Map(fragment.nodes.map((n) => [n.id, n.label]));
  const compare = (want: string[], got: string[]) => ({ missing: want.filter((k) => !got.includes(k)), extra: [...new Set(got)].filter((k) => !want.includes(k)) });
  return {
    nodes: compare(expected.nodes.map((n) => `${n.kind}:${n.label}`), fragment.nodes.map((n) => `${n.kind}:${n.label}`)),
    edges: compare(expected.edges.map(([a, b]) => `${a}->${b}`), fragment.edges.map((e) => `${labelOf.get(e.from) ?? e.from}->${labelOf.get(e.to) ?? e.to}`)),
    endpoints: compare(expected.endpoints.map(([m, p]) => `${m} ${p}`), fragment.endpoints.map((e) => `${e.method} ${e.path}`)),
    gaps: expected.gaps.filter((g) => !fragment.gaps.some((x) => x.includes(g))),
  };
}
const NONE = { missing: [], extra: [] };
const exact = { nodes: NONE, edges: NONE, endpoints: NONE, gaps: [] };

describe('extractSpringBoot (spring-mini)', () => {
  it('matches the fixture ground truth exactly: nodes, edges, endpoints and gaps', async () => {
    expect(diff(await extractSpringBoot(`${FIXTURES}spring-mini`), loadExpected('spring-mini'))).toEqual(exact);
  });

  it('extracts Spring Data interface repositories as nodes with DI + datastore edges', async () => {
    const fragment = await extractSpringBoot(`${FIXTURES}spring-mini`);
    const labelOf = new Map(fragment.nodes.map((n) => [n.id, n.label]));
    expect(fragment.nodes.some((n) => n.label === 'ProductRepository' && n.kind === 'service')).toBe(true);
    expect(fragment.edges.some((e) => labelOf.get(e.from) === 'ProductService' && labelOf.get(e.to) === 'ProductRepository')).toBe(true);
    expect(fragment.edges.some((e) => labelOf.get(e.from) === 'ProductRepository' && labelOf.get(e.to) === 'PostgreSQL')).toBe(true);
  });

  it('every edge references an existing node (no dangling targets)', async () => {
    const fragment = await extractSpringBoot(`${FIXTURES}spring-mini`);
    const ids = new Set(fragment.nodes.map((n) => n.id));
    const dangling = fragment.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
    expect(dangling).toEqual([]);
  });

  it('extracts method-level @KafkaListener as queue node + async edge on the enclosing class', async () => {
    const fragment = await extractSpringBoot(`${FIXTURES}spring-mini`);
    const labelOf = new Map(fragment.nodes.map((n) => [n.id, n.label]));
    expect(fragment.nodes.some((n) => n.kind === 'queue' && n.label === 'orders.events')).toBe(true);
    expect(fragment.edges.some((e) => labelOf.get(e.from) === 'OrderService' && labelOf.get(e.to) === 'orders.events' && e.type === 'async')).toBe(true);
  });

  it('extracts RestTemplate URL calls as external nodes with sync edges', async () => {
    const fragment = await extractSpringBoot(`${FIXTURES}spring-mini`);
    const labelOf = new Map(fragment.nodes.map((n) => [n.id, n.label]));
    expect(fragment.nodes.some((n) => n.kind === 'external' && n.label === 'pricing.example.com')).toBe(true);
    expect(fragment.edges.some((e) => labelOf.get(e.from) === 'ProductService' && labelOf.get(e.to) === 'pricing.example.com')).toBe(true);
  });

  it('resolves Lombok @RequiredArgsConstructor and setter @Autowired as DI edges', async () => {
    const fragment = await extractSpringBoot(`${FIXTURES}spring-mini`);
    const labelOf = new Map(fragment.nodes.map((n) => [n.id, n.label]));
    expect(fragment.edges.some((e) => labelOf.get(e.from) === 'NotificationService' && labelOf.get(e.to) === 'OrderRepository')).toBe(true);
    expect(fragment.edges.some((e) => labelOf.get(e.from) === 'NotificationService' && labelOf.get(e.to) === 'ProductRepository')).toBe(true);
    expect(fragment.edges.some((e) => labelOf.get(e.from) === 'ProductService' && labelOf.get(e.to) === 'OrderRepository')).toBe(true);
  });

  it('ignores commented-out jdbc URLs (no phantom datastore)', async () => {
    const fragment = await extractSpringBoot(`${FIXTURES}spring-mini`);
    expect(fragment.nodes.some((n) => n.kind === 'datastore' && n.label === 'MySQL')).toBe(false);
  });

  it('every source-supported edge carries at least one evidence link', async () => {
    const spring = await extractSpringBoot(`${FIXTURES}spring-mini`);
    const fastapi = await extractFastApi(`${FIXTURES}fastapi-mini`);
    for (const e of [...spring.edges, ...fastapi.edges]) {
      expect(e.evidence.length, `${e.id} has no evidence`).toBeGreaterThan(0);
    }
  });

  it('maps a bare root @GetMapping("/") to path "/"', async () => {
    const fragment = await extractSpringBoot(`${FIXTURES}spring-mini`);
    expect(fragment.endpoints.some((e) => e.method === 'GET' && e.path === '/')).toBe(true);
  });

  it('every extracted node carries file+line evidence', async () => {
    const fragment = await extractSpringBoot(`${FIXTURES}spring-mini`);
    for (const n of fragment.nodes) {
      expect(n.evidence.length).toBeGreaterThan(0);
      expect(n.evidence[0]!.path).toMatch(/\.java|\.yml/);
      expect(n.evidence[0]!.lines).toBeDefined();
    }
  });
});

describe('extractSpringBoot (spring-mappings: method-level and multi-path mappings, collection relations, embedded database)', () => {
  const mappings = () => extractSpringBoot(`${FIXTURES}spring-mappings`);

  it('matches the fixture ground truth exactly: nodes, edges, endpoints and gaps', async () => {
    expect(diff(await mappings(), loadExpected('spring-mappings'))).toEqual(exact);
  });

  it('labels collection relations by cardinality and skips inverse sides', async () => {
    const f = await mappings();
    const labelOf = new Map(f.nodes.map((n) => [n.id, n.label]));
    const relations = f.edges.filter((e) => e.type === 'relation').map((e) => `${labelOf.get(e.from)}->${labelOf.get(e.to)} ${e.label}`).sort();
    expect(relations).toEqual(['Catalog->Tag N:M', 'Item->Catalog N:1', 'Shelf->Item 1:N']);
  });

  it('cites the build dependency for an embedded database', async () => {
    const h2 = (await mappings()).nodes.find((n) => n.label === 'H2');
    expect(h2?.evidence).toEqual([{ path: 'pom.xml', lines: [3, 7] }]);
  });

  it('uses no embedded database when the default profile configures a URL, and shows constant paths as unresolved', async () => {
    const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(`${tmpdir()}/aw-spring-`);
    mkdirSync(`${dir}/src/main/resources`, { recursive: true });
    writeFileSync(`${dir}/build.gradle`, "dependencies {\n  runtimeOnly 'com.h2database:h2'\n  testRuntimeOnly 'org.hsqldb:hsqldb'\n}\n");
    writeFileSync(`${dir}/src/main/resources/application.properties`, 'spring.datasource.url=jdbc:postgresql://db/app\n');
    writeFileSync(`${dir}/Api.java`, '@RestController\n@RequestMapping(Paths.API)\nclass Api {\n  @GetMapping(Paths.STATUS)\n  public String status() { return "ok"; }\n}\n');
    const f = await extractSpringBoot(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(f.nodes.filter((n) => n.kind === 'datastore').map((n) => n.label)).toEqual(['PostgreSQL']);
    expect(f.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(['GET /{Paths.API}/{Paths.STATUS}']);
    expect(f.gaps).toEqual(['mapping path Paths.API in Api.java — not statically resolved', 'mapping path Paths.STATUS in Api.java — not statically resolved']);
  });
});

it.each([
  ['an unrelated URL setting', 'app.callback-url=https://example.com/hook\n', 'application.properties', ['H2']],
  ['a nested YAML datasource URL', 'spring:\n  datasource:\n    username: app\n    url: ${DB_URL}\n', 'application.yml', []],
  ['a profile-only datasource URL', 'spring.datasource.url=jdbc:mysql://db/app\n', 'application-prod.properties', ['H2', 'MySQL']],
])('embedded database with %s in configuration', async (_, config, file, want) => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(`${tmpdir()}/aw-spring-`);
  writeFileSync(`${dir}/pom.xml`, '<project><dependencies><dependency><groupId>com.h2database</groupId><artifactId>h2</artifactId></dependency></dependencies></project>\n');
  writeFileSync(`${dir}/${file}`, config);
  const f = await extractSpringBoot(dir);
  rmSync(dir, { recursive: true, force: true });
  expect(f.nodes.filter((n) => n.kind === 'datastore').map((n) => n.label).sort()).toEqual(want);
});

it('adds the leading slash Spring adds to class and method mapping paths', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(`${tmpdir()}/aw-spring-`);
  writeFileSync(`${dir}/TagsApi.java`, '@RestController\n@RequestMapping(path = "tags/")\nclass TagsApi {\n  @GetMapping\n  public String all() { return ""; }\n  @GetMapping("popular")\n  public String popular() { return ""; }\n}\n');
  const f = await extractSpringBoot(dir);
  rmSync(dir, { recursive: true, force: true });
  expect(f.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(['GET /tags', 'GET /tags/popular']);
});

describe('extractFastApi (fastapi-mini)', () => {
  it('matches the fixture ground truth exactly: nodes, edges, endpoints and gaps', async () => {
    expect(diff(await extractFastApi(`${FIXTURES}fastapi-mini`), loadExpected('fastapi-mini'))).toEqual(exact);
  });

  it('extracts BackgroundTasks.add_task as an async edge to a background queue node', async () => {
    const fragment = await extractFastApi(`${FIXTURES}fastapi-mini`);
    const labelOf = new Map(fragment.nodes.map((n) => [n.id, n.label]));
    const queue = fragment.nodes.find((n) => n.kind === 'queue' && n.label === 'background:send_receipt');
    expect(queue).toBeDefined();
    const asyncEdge = fragment.edges.some((e) => labelOf.get(e.from) === 'orders-router' && labelOf.get(e.to) === 'background:send_receipt' && e.type === 'async');
    expect(asyncEdge).toBe(true);
  });
});

describe('extractFastApi (fastapi-layered: nested routers, settings prefixes, yield and Annotated dependencies)', () => {
  const layered = () => extractFastApi(`${FIXTURES}fastapi-layered`);

  it('matches the fixture ground truth exactly: nodes, edges, endpoints and gaps', async () => {
    expect(diff(await layered(), loadExpected('fastapi-layered'))).toEqual(exact);
  });

  it('wires routers through the router that includes them, not straight to the application', async () => {
    const f = await layered();
    const labelOf = new Map(f.nodes.map((n) => [n.id, n.label]));
    const fromApp = f.edges.filter((e) => labelOf.get(e.from) === 'app').map((e) => labelOf.get(e.to)).sort();
    expect(fromApp).toEqual(['admin-router', 'api_router']);
  });

  it('cites the include call and the endpoint definition as evidence', async () => {
    const f = await layered();
    const labelOf = new Map(f.nodes.map((n) => [n.id, n.label]));
    const include = f.edges.find((e) => labelOf.get(e.from) === 'api_router' && labelOf.get(e.to) === 'users-router');
    expect(include?.evidence).toEqual([{ path: 'app/api/main.py', lines: [7, 7] }]);
    const me = f.endpoints.find((e) => e.path === '/api/v1/accounts/users/me');
    expect(me?.evidence).toEqual({ path: 'app/api/routes/users.py', lines: [8, 10] });
  });

  it('says when a settings prefix is a declared default, and shows an unresolved prefix instead of dropping it', async () => {
    const gaps = (await layered()).gaps.join('\n');
    expect(gaps).toContain('computed prefix settings.API_PREFIX resolved to its declared default "/api/v1" — an environment override would change these paths');
    expect(gaps).toContain('computed prefix settings.ADMIN_PREFIX — include_router prefix not statically resolved');
    expect(gaps).toContain('router legacy-router is not included by any application in the analyzed source; its endpoints are listed without a mount prefix');
  });

  it('every edge references an extracted node', async () => {
    const f = await layered();
    const ids = new Set(f.nodes.map((n) => n.id));
    expect(f.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to))).toEqual([]);
  });

  it('ignores route-shaped decorators on objects that are not FastAPI applications or routers', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(`${tmpdir()}/aw-fastapi-`);
    writeFileSync(`${dir}/main.py`, 'from fastapi import FastAPI\nfrom cache import cache\napp = FastAPI()\n\n@cache.get("/not-a-route")\ndef cached():\n    return 1\n\n@app.get("/real")\ndef real():\n    return 2\n');
    const f = await extractFastApi(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(f.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(['GET /real']);
  });
});

describe('extractFastApi edge cases', () => {
  async function extractFiles(files: Record<string, string>) {
    const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { dirname, join } = await import('node:path');
    const dir = mkdtempSync(`${tmpdir()}/aw-fastapi-`);
    for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); }
    try { return await extractFastApi(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const routes = (f: Awaited<ReturnType<typeof extractFastApi>>) => f.endpoints.map((e) => `${e.method} ${e.path}`).sort();

  it('builds an application inside a factory and resolves a module constant prefix without a gap', async () => {
    const f = await extractFiles({
      'api/constants.py': 'API_PREFIX = "/api"\n',
      'api/orders.py': 'from fastapi import APIRouter\nrouter = APIRouter(prefix="/orders")\n\n@router.get("")\ndef list_orders():\n    return []\n',
      'api/app.py': 'from fastapi import FastAPI\nfrom api import orders\nfrom api.constants import API_PREFIX\n\ndef create_app():\n    app = FastAPI()\n    app.include_router(orders.router, prefix=API_PREFIX)\n    return app\n',
    });
    expect(routes(f)).toEqual(['GET /api/orders']);
    expect(f.gaps).toEqual([]);
  });

  it('terminates on routers that include each other and on dependencies that depend on each other', async () => {
    const f = await extractFiles({
      'main.py': 'from fastapi import FastAPI, APIRouter, Depends\napp = FastAPI()\na = APIRouter(prefix="/a")\nb = APIRouter(prefix="/b")\napp.include_router(a)\na.include_router(b)\nb.include_router(a)\n\ndef one(x=Depends(two)):\n    return x\n\ndef two(y=Depends(one)):\n    return y\n\n@b.get("/x")\ndef x(v=Depends(one)):\n    return v\n',
    });
    expect(routes(f)).toEqual(['GET /a/b/x']);
  });

  it('resolves a settings default declared on a class that inherits BaseSettings indirectly', async () => {
    const f = await extractFiles({
      'settings/base.py': 'from pydantic_settings import BaseSettings\nclass BaseAppSettings(BaseSettings):\n    debug: bool = False\n',
      'settings/app.py': 'from settings.base import BaseAppSettings\nclass AppSettings(BaseAppSettings):\n    api_prefix: str = "/api"\n',
      'main.py': 'from fastapi import FastAPI, APIRouter\nfrom settings.app import AppSettings\nsettings = AppSettings()\napp = FastAPI()\nrouter = APIRouter()\n\n@router.get("/tags")\ndef tags():\n    return []\n\napp.include_router(router, prefix=settings.api_prefix)\n',
    });
    expect(routes(f)).toEqual(['GET /api/tags']);
    expect(f.gaps).toEqual(['computed prefix settings.api_prefix resolved to its declared default "/api" — an environment override would change these paths']);
  });

  it('leaves a settings field unresolved when two settings classes declare different defaults', async () => {
    const f = await extractFiles({
      'settings.py': 'from pydantic_settings import BaseSettings\nclass Dev(BaseSettings):\n    prefix: str = "/dev"\nclass Prod(BaseSettings):\n    prefix: str = "/v1"\n',
      'main.py': 'from fastapi import FastAPI, APIRouter\napp = FastAPI()\nr = APIRouter()\n\n@r.get("/x")\ndef x():\n    return 1\n\napp.include_router(r, prefix=settings.prefix)\n',
    });
    expect(routes(f)).toEqual(['GET {settings.prefix}/x']);
  });

  it('terminates on a dependency alias that refers to itself', async () => {
    const f = await extractFiles({
      'main.py': 'from typing import Annotated\nfrom fastapi import FastAPI, Depends\napp = FastAPI()\nLoop = Annotated["Loop", Depends(Loop)]\n\n@app.get("/x")\ndef x(v: Loop):\n    return v\n',
    });
    expect(routes(f)).toEqual(['GET /x']);
  });

  it('records an include whose router cannot be resolved instead of guessing', async () => {
    const f = await extractFiles({
      'main.py': 'from fastapi import FastAPI\nfrom plugins import load_router\napp = FastAPI()\napp.include_router(load_router())\n',
    });
    expect(f.gaps).toEqual(['include_router(load_router()) in main.py — router not statically resolved']);
    expect(f.edges).toEqual([]);
  });

  it('does not attach sessions to a database when two are configured, and says why', async () => {
    const f = await extractFiles({
      'settings.py': 'from pydantic_settings import BaseSettings\nclass Settings(BaseSettings):\n    DATABASE_URL: str = "postgresql://db/app"\n    ANALYTICS_DB_URL: str = "mysql://warehouse/events"\n',
      'main.py': 'from fastapi import FastAPI, Depends\nfrom sqlalchemy.orm import Session\napp = FastAPI()\n\ndef get_db():\n    with Session() as s:\n        yield s\n\n@app.get("/x")\ndef x(db=Depends(get_db)):\n    return 1\n',
    });
    expect(f.nodes.filter((n) => n.kind === 'datastore').map((n) => n.label).sort()).toEqual(['MySQL', 'PostgreSQL']);
    expect(f.edges.filter((e) => e.type === 'data')).toEqual([]);
    expect(f.gaps.join('\n')).toContain('multiple datasources (PostgreSQL, MySQL)');
  });

  it('reports a foreign key to a table outside the analyzed source instead of a dangling edge', async () => {
    const f = await extractFiles({
      'models.py': 'from sqlmodel import Field, SQLModel\nclass Item(SQLModel, table=True):\n    owner_id: int = Field(foreign_key="account.id")\n',
    });
    expect(f.edges).toEqual([]);
    expect(f.gaps).toEqual(['foreign key to table account in models.py — table not found in the analyzed source']);
  });
});

describe('semanticChecks emission', () => {
  it('spring-mini: requiredEdges carry controller→service DI pairs actually seen', async () => {
    const f = await extractSpringBoot(`${FIXTURES}spring-mini`);
    expect(f.semanticChecks).toBeDefined();
    const labelOf = new Map(f.nodes.map((n) => [n.id, n.label]));
    const pairs = f.semanticChecks!.requiredEdges.map((e) => `${labelOf.get(e.from)}->${labelOf.get(e.to)}`);
    expect(pairs).toContain('OrderController->OrderService');
    expect(pairs).toContain('ProductController->ProductService');
    for (const re of f.semanticChecks!.requiredEdges) {
      expect(f.edges.some((e) => e.from === re.from && e.to === re.to && e.type === re.type)).toBe(true);
    }
  });

  it('spring-mini: roots/terminals list every edge-less node; requiredPaths are fragment-provable', async () => {
    const f = await extractSpringBoot(`${FIXTURES}spring-mini`);
    const sc = f.semanticChecks!;
    const incoming = new Set(f.edges.map((e) => e.to));
    const outgoing = new Set(f.edges.map((e) => e.from));
    for (const n of f.nodes) if (!incoming.has(n.id)) expect(sc.allowedRoots).toContain(n.id);
    for (const n of f.nodes) if (!outgoing.has(n.id)) expect(sc.allowedTerminals).toContain(n.id);
    const adj = new Map<string, string[]>();
    for (const e of f.edges) (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
    const reach = (from: string) => { const s = new Set([from]); const q = [from]; while (q.length) for (const t of adj.get(q.shift()!) ?? []) if (!s.has(t)) { s.add(t); q.push(t); } return s; };
    for (const rp of sc.requiredPaths) expect(reach(rp.from).has(rp.to), `${rp.from}→${rp.to}`).toBe(true);
    const labelOf = new Map(f.nodes.map((n) => [n.id, n.label]));
    expect(sc.requiredPaths.some((p) => labelOf.get(p.from) === 'OrderController' && labelOf.get(p.to) === 'PostgreSQL')).toBe(true);
  });

  it('fastapi-mini: Depends/router bindings become requiredEdges, endpoints gate emission', async () => {
    const f = await extractFastApi(`${FIXTURES}fastapi-mini`);
    expect(f.endpoints.length).toBeGreaterThan(0);
    expect(f.semanticChecks).toBeDefined();
    for (const re of f.semanticChecks!.requiredEdges) {
      expect(f.edges.some((e) => e.from === re.from && e.to === re.to)).toBe(true);
    }
  });

  it('fragment with no endpoints emits no semanticChecks (never empty-object noise)', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(`${tmpdir()}/aw-extract-`);
    writeFileSync(`${dir}/Plain.java`, 'package a;\npublic class Plain { public void go() {} }\n');
    const f = await extractSpringBoot(dir);
    expect(f.semanticChecks).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });
});

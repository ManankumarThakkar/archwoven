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

function score(fragment: Awaited<ReturnType<typeof extractSpringBoot>>, expected: Expected) {
  const labelOf = new Map(fragment.nodes.map((n) => [n.id, n.label]));
  const expectedLabels = new Set(expected.nodes.map((n) => n.label));
  const extractedLabels = new Set(fragment.nodes.map((n) => n.label));

  const nodesMatched = expected.nodes.filter((n) =>
    fragment.nodes.some((x) => x.label === n.label && x.kind === n.kind),
  ).length;
  const nodeRecall = nodesMatched / expected.nodes.length;
  const nodePrecision =
    fragment.nodes.filter((n) => expectedLabels.has(n.label)).length /
    Math.max(1, fragment.nodes.length);

  const extractedEdges = new Set(fragment.edges.map((e) => `${labelOf.get(e.from)}->${labelOf.get(e.to)}`));
  const expectedEdgeKeys = expected.edges.map(([a, b]) => `${a}->${b}`);
  const edgesMatched = expectedEdgeKeys.filter((k) => extractedEdges.has(k)).length;
  const edgeRecall = edgesMatched / expectedEdgeKeys.length;
  const edgePrecision =
    [...extractedEdges].filter((k) => expectedEdgeKeys.includes(k)).length /
    Math.max(1, extractedEdges.size);

  const endpointKeys = new Set(fragment.endpoints.map((e) => `${e.method} ${e.path}`));
  const expectedEndpoints = expected.endpoints.map(([m, p]) => `${m} ${p}`);
  const endpointsMatched = expectedEndpoints.filter((k) => endpointKeys.has(k)).length;

  const gapsText = fragment.gaps.join('\n');
  const gapsFound = expected.gaps.filter((g) => gapsText.includes(g)).length;

  return { nodeRecall, nodePrecision, edgeRecall, edgePrecision, endpointsMatched, endpointsTotal: expectedEndpoints.length, gapsFound, gapsTotal: expected.gaps.length };
}

describe('extractSpringBoot (spring-mini)', () => {
  it('meets precision >= 0.9 and recall >= 0.8 on nodes and edges, finds endpoints + gap', async () => {
    const fragment = await extractSpringBoot(`${FIXTURES}spring-mini`);
    const s = score(fragment, loadExpected('spring-mini'));
    expect(s.nodeRecall).toBeGreaterThanOrEqual(0.8);
    expect(s.nodePrecision).toBeGreaterThanOrEqual(0.9);
    expect(s.edgeRecall).toBeGreaterThanOrEqual(0.8);
    expect(s.edgePrecision).toBeGreaterThanOrEqual(0.9);
    expect(s.endpointsMatched).toBe(s.endpointsTotal);
    expect(s.gapsFound).toBe(s.gapsTotal);
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

describe('extractFastApi (fastapi-mini)', () => {
  it('meets precision >= 0.9 and recall >= 0.8 on nodes and edges, finds endpoints + gaps', async () => {
    const fragment = await extractFastApi(`${FIXTURES}fastapi-mini`);
    const s = score(fragment, loadExpected('fastapi-mini'));
    expect(s.nodeRecall).toBeGreaterThanOrEqual(0.8);
    expect(s.nodePrecision).toBeGreaterThanOrEqual(0.9);
    expect(s.edgeRecall).toBeGreaterThanOrEqual(0.8);
    expect(s.edgePrecision).toBeGreaterThanOrEqual(0.9);
    expect(s.endpointsMatched).toBe(s.endpointsTotal);
    expect(s.gapsFound).toBe(s.gapsTotal);
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

describe('semanticChecks emission (M4)', () => {
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

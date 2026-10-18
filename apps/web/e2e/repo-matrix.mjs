#!/usr/bin/env node
/**
 * Extraction matrix — per-construct precision/recall against fixture ground
 * truth, run OFFLINE (no network, no model spend), plus an optional fake-mode
 * HTTP pass against a live `next start` (ARCHWOVEN_FAKE=1) for the repo route.
 *
 * Usage:
 *   node apps/web/e2e/repo-matrix.mjs                 # fixture matrix only
 *   node apps/web/e2e/repo-matrix.mjs http://localhost:3000   # + fake-mode HTTP
 *
 * Prints results verbatim, failures included.
 */
import { extractSpringBoot, extractFastApi } from '@archwoven/extract';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname;
const FIXTURES = [
  { name: 'spring-mini', dir: join(ROOT, 'probes/fixtures/repos/spring-mini'), extract: extractSpringBoot },
  { name: 'fastapi-mini', dir: join(ROOT, 'probes/fixtures/repos/fastapi-mini'), extract: extractFastApi },
];

const pct = (n, d) => (d === 0 ? '—' : `${Math.round((n / d) * 100)}%`);

function score(name, fragment, expected) {
  const labelOf = new Map(fragment.nodes.map((n) => [n.id, n.label]));
  const gotNodeLabels = new Set(fragment.nodes.map((n) => n.label));
  const gotEdges = new Set(fragment.edges.map((e) => `${labelOf.get(e.from) ?? e.from}→${labelOf.get(e.to) ?? e.to}`));
  const gotEndpoints = new Set(fragment.endpoints.map((e) => `${e.method} ${e.path}`));

  const tp = { nodes: 0, edges: 0, endpoints: 0, gaps: 0 };
  const miss = { nodes: [], edges: [], endpoints: [], gaps: [] };
  const kindMismatch = [];

  for (const n of expected.nodes) {
    const hit = fragment.nodes.find((x) => x.label === n.label);
    if (hit) {
      tp.nodes++;
      if (hit.kind !== n.kind) kindMismatch.push(`${n.label}: expected ${n.kind}, got ${hit.kind}`);
    } else miss.nodes.push(`${n.kind}:${n.label}`);
  }
  for (const [from, to] of expected.edges) {
    if (gotEdges.has(`${from}→${to}`)) tp.edges++;
    else miss.edges.push(`${from}→${to}`);
  }
  for (const [m, p] of expected.endpoints) {
    if (gotEndpoints.has(`${m} ${p}`)) tp.endpoints++;
    else miss.endpoints.push(`${m} ${p}`);
  }
  for (const g of expected.gaps ?? []) {
    if (fragment.gaps.some((x) => x.includes(g))) tp.gaps++;
    else miss.gaps.push(g);
  }

  const extraNodes = [...gotNodeLabels].filter((l) => !expected.nodes.some((n) => n.label === l));
  const extraEdges = [...gotEdges].filter((e) => !expected.edges.some(([f, t]) => `${f}→${t}` === e));
  const extraEndpoints = [...gotEndpoints].filter((e) => !expected.endpoints.some(([m, p]) => `${m} ${p}` === e));

  const row = (construct, t, exp, extras) => {
    const fp = extras.length;
    console.log(`| ${construct} | ${t}/${exp} | ${pct(t, exp)} | ${t + fp === 0 ? '—' : pct(t, t + fp)} | ${extras.length ? extras.join('; ') : '—'} |`);
  };

  console.log(`\n## ${name}\n`);
  console.log('| construct | found/expected | recall | precision | misses |');
  console.log('|---|---|---|---|---|');
  row('nodes', tp.nodes, expected.nodes.length, extraNodes);
  row('edges', tp.edges, expected.edges.length, extraEdges);
  row('endpoints', tp.endpoints, expected.endpoints.length, extraEndpoints);
  console.log(`| gaps surfaced | ${tp.gaps}/${(expected.gaps ?? []).length} | ${pct(tp.gaps, (expected.gaps ?? []).length)} | — | ${(expected.gaps ?? []).length && miss.gaps.length ? miss.gaps.join('; ') : '—'} |`);
  if (kindMismatch.length) console.log(`\nkind mismatches: ${kindMismatch.join('; ')}`);
  console.log(`\nmissed: ${JSON.stringify({ nodes: miss.nodes, edges: miss.edges, endpoints: miss.endpoints, gaps: miss.gaps })}`);
  return { tp, expected, miss };
}

console.log('# Archwoven extraction matrix');
console.log(`run: ${new Date().toISOString()} · fixtures offline · no model spend`);

for (const fx of FIXTURES) {
  const expected = JSON.parse(readFileSync(join(fx.dir, 'expected.json'), 'utf8'));
  const fragment = await fx.extract(fx.dir);
  score(fx.name, fragment, expected);
}

// ── real public repos through the full ingest pipeline (network fetch, zero model spend) ──
console.log('\n## real-repo ingest (codeload → unpack → detect → extract; no model spend)\n');
const { ingestRepo } = await import('@archwoven/ingest');
for (const { owner, repo, ref } of [
  { owner: 'spring-projects', repo: 'spring-petclinic', ref: 'main' },
  { owner: 'tiangolo', repo: 'fastapi', ref: undefined }, // default branch — pinCommit resolves it
]) {
  const t0 = Date.now();
  let r;
  try {
    r = await ingestRepo({ owner, repo, ref }, {
      fetcher: (url, init) => fetch(url, init),
      extractSpringBoot,
      extractFastApi,
    });
  } catch (e) {
    console.log(`- ${owner}/${repo}@${ref ?? 'default'}: FAILED ${e?.message ?? e}`);
    continue;
  }
  if (!r.ok) { console.log(`- ${owner}/${repo}@${ref ?? 'default'}: FAILED ${r.reason}: ${r.message}`); continue; }
  const ss = r.fragment.nodes.filter((n) => n.provenance === 'source-supported').length;
  console.log(`- ${owner}/${repo}@${r.sha.slice(0, 7)} framework=${r.framework} filesScanned=${r.filesScanned} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  nodes ${r.fragment.nodes.length} (${ss} source-supported) · edges ${r.fragment.edges.length} · endpoints ${r.fragment.endpoints.length} · gaps ${r.gaps.length}`);
  for (const g of r.gaps.slice(0, 12)) console.log(`  · gap: ${g}`);
}

const BASE = process.argv[2];
if (BASE) {
  console.log(`\n## fake-mode HTTP flow @ ${BASE}\n`);
  try {
    const jar = { cookie: '' };
    const post = await fetch(`${BASE}/api/repo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://github.com/spring-projects/spring-petclinic', idempotencyKey: `matrix-${Date.now()}` }),
    });
    jar.cookie = (post.headers.get('set-cookie') ?? '').split(';')[0];
    const { jobId } = await post.json();
    console.log(`POST /api/repo → ${post.status} jobId=${jobId}`);
    let job = null;
    for (let i = 0; i < 150; i++) {
      const r = await fetch(`${BASE}/api/jobs/${jobId}`, { headers: { cookie: jar.cookie } });
      job = await r.json();
      if (job.status !== 'queued' && job.status !== 'running') break;
      await new Promise((res) => setTimeout(res, 200));
    }
    console.log(`poll → status=${job.status} stage=${job.stage ?? '—'} gaps=${(job.gaps ?? []).length}`);
    if (job.status === 'succeeded') {
      const m = await (await fetch(`${BASE}/api/models/${job.modelId}`, { headers: { cookie: jar.cookie } })).json();
      const ev = [...m.model.nodes, ...m.model.edges].flatMap((x) => x.evidence ?? []);
      const pinned = ev.filter((e) => /^[0-9a-f]{40}$/.test(e.commit ?? '')).length;
      const ss = m.model.nodes.filter((n) => n.provenance === 'source-supported').length;
      console.log(`model: ${m.model.nodes.length} nodes · evidence ${pinned}/${ev.length} pinned to a 40-hex commit · source-supported nodes ${ss}/${m.model.nodes.length}`);
    }
  } catch (e) {
    console.log(`HTTP flow failed: ${e.message} (server not running? start with ARCHWOVEN_FAKE=1 ARCHWOVEN_DEMO_ACK=1 next start)`);
  }
}

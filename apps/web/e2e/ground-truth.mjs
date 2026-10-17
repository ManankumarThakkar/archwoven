#!/usr/bin/env node
/**
 * Extraction precision/recall against hand-checked ground truth on real public
 * repositories pinned to a commit (probes/ground-truth/*.json). Each repository
 * goes through the product ingest pipeline (pin → codeload → safe unpack →
 * detect → extract); no model is called.
 *
 * Usage: pnpm build:packages && node apps/web/e2e/ground-truth.mjs
 * Numbers are published verbatim in docs/EXTRACTION-GROUND-TRUTH.md.
 */
import { extractSpringBoot, extractFastApi } from '@archwoven/extract';
import { ingestRepo } from '@archwoven/ingest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('../../../probes/ground-truth/', import.meta.url).pathname;
const pct = (n, d) => (d === 0 ? '—' : `${Math.round((n / d) * 100)}%`);

/** Compares two key sets; recall over the truth, precision over what was extracted. */
function compare(truth, found) {
  const hit = truth.filter((k) => found.has(k));
  return { hit: hit.length, truth: truth.length, found: found.size, misses: truth.filter((k) => !found.has(k)), extras: [...found].filter((k) => !truth.includes(k)) };
}

export function score(truth, fragment) {
  const labelOf = new Map(fragment.nodes.map((n) => [n.id, n.label]));
  return {
    nodes: compare(truth.nodes.map((n) => `${n.kind}:${n.label}`), new Set(fragment.nodes.map((n) => `${n.kind}:${n.label}`))),
    edges: compare(truth.edges.map((e) => `${e.from} → ${e.to}`), new Set(fragment.edges.map((e) => `${labelOf.get(e.from) ?? e.from} → ${labelOf.get(e.to) ?? e.to}`))),
    endpoints: compare(truth.endpoints.map(([m, p]) => `${m} ${p}`), new Set(fragment.endpoints.map((e) => `${e.method} ${e.path}`))),
    gaps: { hit: truth.gaps.filter((g) => fragment.gaps.some((x) => x.includes(g))).length, truth: truth.gaps.length, misses: truth.gaps.filter((g) => !fragment.gaps.some((x) => x.includes(g))) },
  };
}

console.log('# Extraction ground truth');
console.log(`run: ${new Date().toISOString()} · pinned commits · no model spend`);
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
  const truth = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  const [owner, repo] = truth.repo.split('/');
  const r = await ingestRepo({ owner, repo, ref: truth.sha, subdir: truth.subdir }, { fetcher: (url, init) => fetch(url, init), extractSpringBoot, extractFastApi });
  if (!r.ok) { console.log(`\n## ${truth.repo}\n\nFAILED ${r.reason}: ${r.message}`); process.exitCode = 1; continue; }
  if (r.sha !== truth.sha) { console.log(`\n## ${truth.repo}\n\nFAILED pinned ${truth.sha}, got ${r.sha}`); process.exitCode = 1; continue; }
  const s = score(truth, r.fragment);
  // Held-out files cover only the constructs they list; others are not scored.
  const scoped = truth.scope ?? ['nodes', 'edges', 'endpoints', 'gaps'];
  console.log(`\n## ${truth.repo} @ ${truth.sha.slice(0, 7)}${truth.subdir ? ` (${truth.subdir}/)` : ''} — framework ${r.framework}${truth.heldOut ? ' — held out' : ''}\n`);
  console.log('| construct | found/expected | recall | precision |');
  console.log('|---|---|---|---|');
  for (const k of ['nodes', 'edges', 'endpoints'].filter((k) => scoped.includes(k))) console.log(`| ${k} | ${s[k].hit}/${s[k].truth} | ${pct(s[k].hit, s[k].truth)} | ${pct(s[k].hit, s[k].found)} |`);
  if (scoped.includes('gaps')) console.log(`| gaps surfaced | ${s.gaps.hit}/${s.gaps.truth} | ${pct(s.gaps.hit, s.gaps.truth)} | — |`);
  if (truth.heldOut) console.log(`\nextractor gaps: ${r.fragment.gaps.length ? r.fragment.gaps.join('; ') : 'none'}`);
  for (const k of ['nodes', 'edges', 'endpoints'].filter((k) => scoped.includes(k))) {
    if (s[k].misses.length) console.log(`\n- missed ${k}: ${s[k].misses.join('; ')}`);
    if (s[k].extras.length) console.log(`- extra ${k}: ${s[k].extras.join('; ')}`);
  }
  if (s.gaps.misses.length) console.log(`- gaps not surfaced: ${s.gaps.misses.join('; ')}`);
}

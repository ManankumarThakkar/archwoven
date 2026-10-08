import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { extractSpringBoot, extractFastApi } from '@archwoven/extract';

export const runtime = 'nodejs';

// Probe C smoke: tree-sitter WASM extraction runs inside a Next.js API route
// (Review Focus 3). Allow-listed fixture names only — never an arbitrary-path reader.
// Walk up from cwd so it resolves under `next dev` (cwd=apps/web) and vitest (cwd=repo root).
function fixturesRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'probes', 'fixtures', 'repos');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return join(process.cwd(), 'probes', 'fixtures', 'repos');
}

const FIXTURES: Record<string, { dir: string; extract: (dir: string) => ReturnType<typeof extractSpringBoot> }> = {
  'spring-mini': { dir: join(fixturesRoot(), 'spring-mini'), extract: extractSpringBoot },
  'fastapi-mini': { dir: join(fixturesRoot(), 'fastapi-mini'), extract: extractFastApi },
};

export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get('repo') ?? 'spring-mini';
  const fixture = Object.hasOwn(FIXTURES, name) ? FIXTURES[name] : undefined;
  if (!fixture) {
    return Response.json({ error: `unknown fixture: ${name}`, allowed: Object.keys(FIXTURES) }, { status: 400 });
  }
  const t0 = performance.now();
  const frag = await fixture.extract(fixture.dir);
  return Response.json({
    repo: name,
    elapsedMs: Math.round(performance.now() - t0),
    counts: { nodes: frag.nodes.length, edges: frag.edges.length, endpoints: frag.endpoints.length, gaps: frag.gaps.length },
    fragment: frag,
  });
}

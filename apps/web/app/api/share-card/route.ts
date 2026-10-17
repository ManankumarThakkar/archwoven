import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve a public/ asset in both vitest (repo-root cwd, ESM) and the Next
 *  server bundle (apps/web cwd, import.meta.url may be shimmed). */
function publicAsset(rel: string): string {
  const cands: string[] = [];
  try { cands.push(fileURLToPath(new URL(`../../../public/${rel}`, import.meta.url))); } catch { /* bundle shims import.meta.url */ }
  cands.push(join(process.cwd(), 'public', rel));
  for (const c of cands) if (existsSync(c)) return c;
  throw new Error(`asset not found: ${rel}`);
}
import { BURST, burstWindow, localMode } from '@archwoven/jobs';
import {
  serverDeps, readOrCreateSession, sessionCookie, BURST_COPY,
  clientIp,
} from '../../lib/server';
import { ensureResvg, renderPng } from '../../../probes/render/export';
import { buildCardSvg } from './card';

export const runtime = 'nodejs';

let fontsReady: Promise<void> | null = null;

/**
 * Quota-gated route/reach share card (§15: action 'view' — weight 0,
 * burst limiter still applies; pools untouched). Owner-checked; the PNG's
 * only text is titles + node labels — never evidence (§14 privacy).
 */
export async function POST(req: Request) {
  const { sessionId, minted } = readOrCreateSession(req);
  const headers: Record<string, string> = {};
  if (minted) headers['set-cookie'] = sessionCookie(sessionId);

  let body: { modelId?: string; kind?: string; from?: string; to?: string; viewId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400, headers });
  }

  const modelId = String(body.modelId ?? '');
  const kind = String(body.kind ?? '');
  const from = String(body.from ?? '');
  const to = body.to !== undefined && body.to !== null ? String(body.to) : undefined;
  if (!modelId || !from || (kind !== 'route' && kind !== 'reach'))
    return Response.json({ error: 'modelId, kind (route|reach) and from are required' }, { status: 400, headers });
  if (kind === 'route' && !to)
    return Response.json({ error: 'route cards need a `to` node' }, { status: 400, headers });

  const model = serverDeps.store.getRevision(modelId);
  if (!model || serverDeps.store.getRevisionOwner(modelId) !== sessionId)
    return Response.json({ error: 'model not found' }, { status: 404, headers });

  // §15 burst, applied directly: reserve() skips burst for weight-0 actions,
  // and cards must stay burst-limited (locked numbers, untouched reserve).
  // Card keys are SEPARATE from the model-call bucket (§15 burst guards
  // model-calling requests — a free card must never block a generate), and
  // local mode compiles quota out entirely.
  const burstWindowSec = Number(process.env.ARCHWOVEN_BURST_WINDOW_SEC ?? 60);
  const win = burstWindow(burstWindowSec);
  if (!localMode()) {
    const ip = clientIp(req.headers);
    const sessHits = serverDeps.store.bumpBurst(`sess-card:${sessionId}`, win);
    const ipHits = ip ? serverDeps.store.bumpBurst(`ip-card:${ip}`, win) : 0;
    if (sessHits > BURST.session || ipHits > BURST.ip) {
      return Response.json({ reason: 'burst', message: BURST_COPY, resetAt: Date.now() + win * 1000 }, { status: 429, headers });
    }
  }

  const view = model.views.find((v) => v.id === body.viewId) ?? model.views.find((v) => v.type === 'architecture') ?? model.views[0];
  if (!view) return Response.json({ error: 'model has no view to card' }, { status: 400, headers });

  const svg = buildCardSvg(model, view.id, kind, from, to);
  try {
    // the app already ships the wasm + fonts in public/ — read from disk,
    // never require.resolve (webpack would try to bundle the binary)
    fontsReady ??= ensureResvg(readFileSync(publicAsset('resvg/index_bg.wasm')));
    await fontsReady;
    const png = await renderPng(svg, [
      readFileSync(publicAsset('fonts/inter-400.woff2')),
      readFileSync(publicAsset('fonts/inter-600.woff2')),
    ], 1);
    return new Response(Buffer.from(png), { status: 200, headers: { ...headers, 'content-type': 'image/png', 'cache-control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: `card render failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500, headers });
  }
}

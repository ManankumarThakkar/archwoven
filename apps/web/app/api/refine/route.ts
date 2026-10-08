import { checkQuota, charge } from '@archwoven/jobs';
import { applyEditOps, type ViewType } from '@archwoven/model';
import {
  serverDeps, readOrCreateSession, sessionCookie, tierOf,
  creditsExhaustedCopy, STOP_LOSS_COPY, BURST_COPY,
} from '../../lib/server';

export const runtime = 'nodejs';

const VALID_VIEWS: ViewType[] = ['architecture', 'sequence', 'er', 'component-detail'];

export async function POST(req: Request) {
  const { sessionId, minted } = readOrCreateSession(req);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (minted) headers['set-cookie'] = sessionCookie(sessionId);

  let body: { modelId?: string; baseRevision?: number; instruction?: string; view?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400, headers });
  }

  const modelId = String(body.modelId ?? '');
  const baseRevision = Number(body.baseRevision);
  const instruction = String(body.instruction ?? '');
  if (!modelId || !Number.isInteger(baseRevision) || !instruction.trim())
    return Response.json({ error: 'modelId, baseRevision and instruction are required' }, { status: 400, headers });

  const latest = serverDeps.store.getRevision(modelId);
  if (!latest) return Response.json({ error: 'model not found' }, { status: 404, headers });

  // Optimistic concurrency: the client must refine the revision it is looking at.
  if (baseRevision !== latest.revision)
    return Response.json({ reason: 'stale-revision', message: 'The diagram changed since you loaded it — here is the latest.', model: latest, revision: latest.revision }, { status: 409, headers });

  const tier = tierOf(sessionId);
  const burstWindowSec = Number(process.env.ARCHWOVEN_BURST_WINDOW_SEC ?? 60);
  const quota = checkQuota(serverDeps.store, { sessionId, tier, action: 'refine', ip: req.headers.get('x-forwarded-for') ?? 'unknown', burstWindowSec });
  if (!quota.ok) {
    const message = quota.reason === 'credits-exhausted' ? creditsExhaustedCopy(quota.resetAt ?? 0) : quota.reason === 'stop-loss' ? STOP_LOSS_COPY : BURST_COPY;
    return Response.json({ reason: quota.reason, message, resetAt: quota.resetAt }, { status: 429, headers });
  }

  const view: ViewType = VALID_VIEWS.includes(body.view as ViewType) ? (body.view as ViewType) : 'architecture';
  const out = await serverDeps.generateRefinement(instruction, latest, view);
  if (!out.ok) return Response.json({ reason: 'refine-failed', errors: out.errors }, { status: 502, headers });

  const applied = applyEditOps(latest, out.ops);
  if (!applied.ok) return Response.json({ reason: 'refine-failed', errors: applied.errors }, { status: 502, headers });

  serverDeps.store.saveRevision(modelId, applied.model);
  const remaining = charge(serverDeps.store, { sessionId, tier, action: 'refine', usage: out.usage, retries: out.usage.repairs, outcome: out.usage.repairs > 0 ? 'repaired' : 'ok' });

  return Response.json({ ops: out.ops, model: applied.model, revision: applied.model.revision, remaining }, { status: 200, headers });
}

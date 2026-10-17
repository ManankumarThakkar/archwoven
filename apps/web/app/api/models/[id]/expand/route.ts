import { reserve, refundCredits, recordUsage } from '@archwoven/jobs';
import { expandBlocker } from '@archwoven/model';
import {
  serverDeps, readOrCreateSession, sessionCookie, tierOf,
  creditsExhaustedCopy, STOP_LOSS_COPY, BURST_COPY,
  llmNotConfigured, LLM_NOT_CONFIGURED_COPY,
} from '../../../../lib/server';
import { withSlot } from '../../../../lib/llm-limiter';
import { readDirectEdit } from '../../../../../lib/direct-edit';

export const runtime = 'nodejs';
const MAX_HINT_CHARS = 300;

/** Infer a component's internals: refinement-weighted, owner- and revision-checked, refunded on any failure. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { sessionId, minted } = readOrCreateSession(req);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (minted) headers['set-cookie'] = sessionCookie(sessionId);
  const { id } = await ctx.params;

  let body: unknown;
  try { body = await readDirectEdit(req); } catch { return Response.json({ error: 'Invalid request body.' }, { status: 400, headers }); }
  const b = body as Record<string, unknown> | null;
  const valid = !!b && typeof b === 'object' && !Array.isArray(b)
    && Object.keys(b).every(k => ['baseRevision', 'target', 'hint'].includes(k))
    && Number.isInteger(b.baseRevision) && Number(b.baseRevision) >= 1
    && typeof b.target === 'string' && b.target.length > 0
    && (b.hint === undefined || (typeof b.hint === 'string' && b.hint.length <= MAX_HINT_CHARS));
  if (!valid) return Response.json({ error: `Send baseRevision, a component id as target and an optional hint of up to ${MAX_HINT_CHARS} characters.` }, { status: 400, headers });
  const baseRevision = b!.baseRevision as number, target = b!.target as string, hint = (b!.hint as string | undefined) ?? '';

  if (serverDeps.store.getRevisionOwner(id) !== sessionId) return Response.json({ error: 'model not found' }, { status: 404, headers });
  const latest = serverDeps.store.getRevision(id);
  if (!latest) return Response.json({ error: 'model not found' }, { status: 404, headers });
  if (baseRevision !== latest.revision)
    return Response.json({ reason: 'stale-revision', message: 'The diagram changed elsewhere. Review the latest version and try again.', model: latest, revision: latest.revision }, { status: 409, headers });
  const blocked = expandBlocker(latest, target);
  if (blocked) return Response.json({ errors: [blocked] }, { status: 400, headers });
  if (llmNotConfigured()) return Response.json({ reason: 'llm-not-configured', message: LLM_NOT_CONFIGURED_COPY }, { status: 503, headers });

  const tier = tierOf(sessionId);
  const day = new Date().toISOString().slice(0, 10);
  const burstWindowSec = Number(process.env.ARCHWOVEN_BURST_WINDOW_SEC ?? 60);
  const quota = reserve(serverDeps.store, { sessionId, tier, action: 'refine', ip: req.headers.get('x-forwarded-for') ?? 'unknown', burstWindowSec });
  if (!quota.ok) {
    const message = quota.reason === 'credits-exhausted' ? creditsExhaustedCopy(quota.resetAt ?? 0) : quota.reason === 'stop-loss' ? STOP_LOSS_COPY : BURST_COPY;
    return Response.json({ reason: quota.reason, message, resetAt: quota.resetAt }, { status: 429, headers });
  }

  const out = await withSlot(`expand:${id}:${baseRevision}`, () => serverDeps.expandComponent(latest, target, hint, { signal: req.signal }));
  const fail = (status: number, payload: Record<string, unknown>) => {
    refundCredits(serverDeps.store, sessionId, day, 0.25);
    recordUsage(serverDeps.store, { sessionId, tier, action: 'refine', usage: out.usage, retries: out.usage.repairs, outcome: 'failed' });
    return Response.json(payload, { status, headers });
  };
  if (!out.ok || req.signal.aborted)
    return fail(502, { reason: 'expand-failed', errors: !out.ok ? out.errors : ['Expansion cancelled. Your diagram is unchanged.'] });
  // Inference yields the event loop: another tab may have saved a change meanwhile.
  const current = serverDeps.store.getRevision(id);
  if (!current || current.revision !== baseRevision)
    return fail(current ? 409 : 404, current ? { reason: 'stale-revision', message: 'The diagram changed while expanding. Review the latest version and try again.', model: current, revision: current.revision } : { error: 'model not found' });

  serverDeps.store.saveRevision(id, out.model, sessionId);
  recordUsage(serverDeps.store, { sessionId, tier, action: 'refine', usage: out.usage, retries: out.usage.repairs, outcome: out.usage.repairs > 0 ? 'repaired' : 'ok' });
  return Response.json({ model: out.model, revision: out.model.revision, remaining: quota.remaining }, { status: 200, headers });
}

import { randomUUID } from 'node:crypto';
import { checkQuota, charge } from '@archwoven/jobs';
import { validateModel, type ViewType } from '@archwoven/model';
import {
  serverDeps, estimateTokens, PROMPT_TOKEN_LIMIT, readOrCreateSession, sessionCookie, tierOf,
  creditsExhaustedCopy, STOP_LOSS_COPY, OVERSIZED_COPY, BURST_COPY,
} from '../../lib/server';

export const runtime = 'nodejs';

const VALID_VIEWS: ViewType[] = ['architecture', 'sequence', 'er', 'component-detail'];

export async function POST(req: Request) {
  const { sessionId, minted } = readOrCreateSession(req);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (minted) headers['set-cookie'] = sessionCookie(sessionId);

  let body: { prompt?: string; view?: string; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400, headers });
  }

  const prompt = String(body.prompt ?? '');
  const view = VALID_VIEWS.includes(body.view as ViewType) ? (body.view as ViewType) : null;
  if (!prompt.trim() || !view) return Response.json({ error: 'prompt and view are required' }, { status: 400, headers });
  if (estimateTokens(prompt) > PROMPT_TOKEN_LIMIT) return Response.json({ reason: 'oversized', message: OVERSIZED_COPY }, { status: 413, headers });

  const key = body.idempotencyKey ? String(body.idempotencyKey) : undefined;
  if (key) {
    const existing = serverDeps.store.findJobByIdempotencyKey(key);
    if (existing) return Response.json({ jobId: existing.id }, { status: 202, headers });
  }

  const tier = tierOf(sessionId);
  const burstWindowSec = Number(process.env.ARCHWOVEN_BURST_WINDOW_SEC ?? 60);
  const quota = checkQuota(serverDeps.store, { sessionId, tier, action: 'generate', ip: req.headers.get('x-forwarded-for') ?? 'unknown', burstWindowSec });
  if (!quota.ok) {
    const message = quota.reason === 'credits-exhausted' ? creditsExhaustedCopy(quota.resetAt ?? 0) : quota.reason === 'stop-loss' ? STOP_LOSS_COPY : BURST_COPY;
    return Response.json({ reason: quota.reason, message, resetAt: quota.resetAt }, { status: 429, headers });
  }

  const jobId = randomUUID();
  serverDeps.store.createJob({ id: jobId, modelId: jobId, kind: 'generate', idempotencyKey: key });

  // Fire-and-forget durable job; stages are real events surfaced by /api/jobs polling.
  void (async () => {
    try {
      serverDeps.store.updateJob(jobId, { status: 'running', stage: 'validating' });
      serverDeps.store.updateJob(jobId, { stage: 'generating' });
      const out = await serverDeps.generateModel(prompt, view);
      serverDeps.store.updateJob(jobId, { stage: 'validating-output' });
      if (!out.ok) {
        serverDeps.store.updateJob(jobId, { status: 'failed', error: out.errors.join('; ') });
        return; // provider errors never charge credits
      }
      const checked = validateModel(out.model);
      if (!checked.ok) {
        serverDeps.store.updateJob(jobId, { status: 'failed', error: checked.errors.join('; ') });
        return;
      }
      serverDeps.store.saveRevision(jobId, checked.model);
      serverDeps.store.updateJob(jobId, { stage: 'saving' });
      charge(serverDeps.store, { sessionId, tier, action: 'generate', usage: out.usage, retries: out.usage.repairs, outcome: out.usage.repairs > 0 ? 'repaired' : 'ok' });
      serverDeps.store.updateJob(jobId, { status: 'succeeded' });
    } catch (e) {
      serverDeps.store.updateJob(jobId, { status: 'failed', error: e instanceof Error ? e.message : 'unknown error' });
    }
  })();

  return Response.json({ jobId }, { status: 202, headers });
}

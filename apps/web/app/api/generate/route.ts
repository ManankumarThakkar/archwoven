import { randomUUID } from 'node:crypto';
import { reserve, refundCredits, recordUsage, TIERS } from '@archwoven/jobs';
import { validateModel, type ViewType } from '@archwoven/model';
import {
  serverDeps, estimateTokens, PROMPT_TOKEN_LIMIT, readOrCreateSession, sessionCookie, tierOf,
  creditsExhaustedCopy, STOP_LOSS_COPY, OVERSIZED_COPY, BURST_COPY,
  llmNotConfigured, LLM_NOT_CONFIGURED_COPY,
} from '../../lib/server';
import { withSlot, slotPosition } from '../../lib/llm-limiter';
import { deployMode, privacyForMode } from '../../lib/mode';
import { jobRegistry, startJobDeadline, JOB_TIMEOUT_COPY } from '../../lib/job-registry';

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
  if (llmNotConfigured()) return Response.json({ reason: 'llm-not-configured', message: LLM_NOT_CONFIGURED_COPY }, { status: 503, headers });

  const tier = tierOf(sessionId);
  const key = body.idempotencyKey ? String(body.idempotencyKey) : undefined;
  if (key) {
    const existing = serverDeps.store.findJobByIdempotencyKey(key, sessionId);
    if (existing) {
      const used = serverDeps.store.creditsUsed(sessionId, new Date().toISOString().slice(0, 10));
      return Response.json({ jobId: existing.id, remaining: Math.max(0, TIERS[tier].pool - used) }, { status: 202, headers });
    }
  }

  const burstWindowSec = Number(process.env.ARCHWOVEN_BURST_WINDOW_SEC ?? 60);
  // Atomic reservation at the gate — parallel requests cannot race past the pool.
  const quota = reserve(serverDeps.store, { sessionId, tier, action: 'generate', ip: req.headers.get('x-forwarded-for') ?? 'unknown', burstWindowSec });
  if (!quota.ok) {
    const message = quota.reason === 'credits-exhausted' ? creditsExhaustedCopy(quota.resetAt ?? 0) : quota.reason === 'stop-loss' ? STOP_LOSS_COPY : BURST_COPY;
    return Response.json({ reason: quota.reason, message, resetAt: quota.resetAt }, { status: 429, headers });
  }

  const jobId = randomUUID();
  try {
    serverDeps.store.createJob({ id: jobId, modelId: jobId, kind: 'generate', idempotencyKey: key, sessionId });
  } catch (e) {
    // concurrent POST with the same (session, key): dedupe to the winner's job
    if (key && e instanceof Error && /UNIQUE/i.test(e.message)) {
      const winner = serverDeps.store.findJobByIdempotencyKey(key, sessionId);
      if (winner) return Response.json({ jobId: winner.id, remaining: quota.remaining }, { status: 202, headers });
    }
    refundCredits(serverDeps.store, sessionId, new Date().toISOString().slice(0, 10), 1);
    throw e;
  }

  const entry = { controller: new AbortController(), settled: false };
  jobRegistry.set(jobId, entry);
  // Durable fire-and-forget job behind the §15 concurrency slot; stages and the
  // queue position are surfaced by /api/jobs polling.
  void withSlot(jobId, async () => {
    const day = new Date().toISOString().slice(0, 10);
    const claim = () => { if (entry.settled) return false; entry.settled = true; return true; };
    const fail = (error: string, usage?: { inputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; outputTokens: number }, retries = 0) => {
      if (usage) recordUsage(serverDeps.store, { sessionId, tier, action: 'generate', usage, retries, outcome: 'failed' });
      if (!claim()) return;
      serverDeps.store.updateJob(jobId, { status: 'failed', error });
      refundCredits(serverDeps.store, sessionId, day, 1);
    };
    if (entry.controller.signal.aborted) { jobRegistry.delete(jobId); return; }
    const stopDeadline = startJobDeadline(entry, () => fail(JOB_TIMEOUT_COPY));
    try {
      serverDeps.store.updateJob(jobId, { status: 'running', stage: 'validating' });
      serverDeps.store.updateJob(jobId, { stage: 'generating' });
      const out = await serverDeps.generateModel(prompt, view, { signal: entry.controller.signal });
      if (!entry.settled) serverDeps.store.updateJob(jobId, { stage: 'validating-output' });
      if (!out.ok) return fail(out.errors.join('; '), out.usage, out.usage.repairs);
      const checked = validateModel(out.model);
      if (!checked.ok) return fail(checked.errors.join('; '), out.usage, out.usage.repairs);
      if (entry.settled) {
        recordUsage(serverDeps.store, { sessionId, tier, action: 'generate', usage: out.usage, retries: out.usage.repairs, outcome: 'failed' });
        return;
      }
      // §9: privacy is server-stamped from deploy mode — model self-report never wins.
      const stamped = { ...checked.model, privacy: privacyForMode(deployMode()) };
      serverDeps.store.saveRevision(jobId, stamped, sessionId);
      serverDeps.store.updateJob(jobId, { stage: 'saving' });
      recordUsage(serverDeps.store, { sessionId, tier, action: 'generate', usage: out.usage, retries: out.usage.repairs, outcome: out.usage.repairs > 0 ? 'repaired' : 'ok' });
      serverDeps.store.updateJob(jobId, { status: 'succeeded' });
      // These persistence operations are synchronous: no cancel/deadline can interleave.
      // Claim only after they finish so a thrown write still follows failure/refund.
      claim();
    } catch (e) {
      fail(e instanceof Error ? e.message : 'unknown error');
    } finally {
      stopDeadline(); jobRegistry.delete(jobId);
    }
  });

  return Response.json({ jobId, remaining: quota.remaining }, { status: 202, headers });
}

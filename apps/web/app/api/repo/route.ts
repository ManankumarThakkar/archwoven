import { randomUUID } from 'node:crypto';
import { reserve, refundCredits, recordUsage, TIERS, WEIGHTS } from '@archwoven/jobs';
import { validateModel } from '@archwoven/model';
import { parseRepoUrl } from '@archwoven/ingest';
import {
  serverDeps, readOrCreateSession, sessionCookie, tierOf,
  creditsExhaustedCopy, STOP_LOSS_COPY, BURST_COPY,
} from '../../lib/server';
import { withSlot } from '../../lib/llm-limiter';
import { repoJobRegistry } from '../../lib/repo-registry';

export const runtime = 'nodejs';

const safeSubdir = (s: string): boolean =>
  /^[\w.-]+(\/[\w.-]+)*$/.test(s) && s.split('/').every((seg) => seg !== '.' && seg !== '..');

export async function POST(req: Request) {
  const { sessionId, minted } = readOrCreateSession(req);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (minted) headers['set-cookie'] = sessionCookie(sessionId);

  let body: { url?: string; subdir?: string; ref?: string; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400, headers });
  }

  // URL validation BEFORE quota — a malformed/SSRF-shaped URL must not spend credits.
  const parsed = parseRepoUrl(String(body.url ?? ''));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400, headers });

  const subdir = body.subdir !== undefined && body.subdir !== null && body.subdir !== ''
    ? (safeSubdir(String(body.subdir)) ? String(body.subdir) : null)
    : parsed.subdir ?? undefined;
  if (subdir === null) return Response.json({ error: 'subdir must be a simple relative path without ".."' }, { status: 400, headers });

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
  const quota = reserve(serverDeps.store, { sessionId, tier, action: 'repo', ip: req.headers.get('x-forwarded-for') ?? 'unknown', burstWindowSec });
  if (!quota.ok) {
    const message = quota.reason === 'credits-exhausted' ? creditsExhaustedCopy(quota.resetAt ?? 0) : quota.reason === 'stop-loss' ? STOP_LOSS_COPY : BURST_COPY;
    return Response.json({ reason: quota.reason, message, resetAt: quota.resetAt }, { status: 429, headers });
  }

  const jobId = randomUUID();
  try {
    serverDeps.store.createJob({ id: jobId, modelId: jobId, kind: 'repo', idempotencyKey: key, sessionId });
  } catch (e) {
    if (key && e instanceof Error && /UNIQUE/i.test(e.message)) {
      const winner = serverDeps.store.findJobByIdempotencyKey(key, sessionId);
      if (winner) return Response.json({ jobId: winner.id, remaining: quota.remaining }, { status: 202, headers });
    }
    refundCredits(serverDeps.store, sessionId, new Date().toISOString().slice(0, 10), WEIGHTS.repo);
    throw e;
  }

  const controller = new AbortController();
  repoJobRegistry.set(jobId, { controller, settled: false });

  // Durable fire-and-forget job behind the §15 concurrency slot.
  void withSlot(jobId, async () => {
    const day = new Date().toISOString().slice(0, 10);
    const claim = () => {
      const e = repoJobRegistry.get(jobId);
      if (!e || e.settled) return false;
      e.settled = true;
      return true;
    };
    const fail = (error: string, usage?: { inputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; outputTokens: number }, retries = 0) => {
      if (!claim()) return; // cancel already settled + refunded this job
      serverDeps.store.updateJob(jobId, { status: 'failed', error });
      refundCredits(serverDeps.store, sessionId, day, WEIGHTS.repo);
      if (usage) recordUsage(serverDeps.store, { sessionId, tier, action: 'repo', usage, retries, outcome: 'failed' });
    };
    try {
      // cancel may have landed while queued — a cancelled job must never restart
      if (controller.signal.aborted) return;
      serverDeps.store.updateJob(jobId, { status: 'running', stage: 'fetching' });
      // stage writes are skipped once cancelled, so the poll never shows a stage on a dead job
      const stage = (s: string) => { if (!repoJobRegistry.get(jobId)?.settled) serverDeps.store.updateJob(jobId, { stage: s }); };
      const ingest = await serverDeps.ingestRepo(
        { owner: parsed.owner, repo: parsed.repo, ref: parsed.ref ?? (body.ref ? String(body.ref) : undefined), subdir },
        { signal: controller.signal, onStage: stage },
      );
      if (!ingest.ok) return fail(ingest.message);
      if (controller.signal.aborted) return;

      stage('designing');
      const out = await serverDeps.assembleRepoModel(ingest.fragment, { owner: parsed.owner, repo: parsed.repo, sha: ingest.sha, framework: ingest.framework }, { signal: controller.signal });
      stage('validating-output');
      if (!out.ok) return fail(out.errors.join('; '), out.usage, out.usage.repairs);
      const checked = validateModel(out.model);
      if (!checked.ok) return fail(checked.errors.join('; '), out.usage, out.usage.repairs);
      if (!claim()) return; // cancelled during design — cancel owns the terminal write
      serverDeps.store.saveRevision(jobId, checked.model, sessionId);
      serverDeps.store.updateJob(jobId, { stage: 'laying-out' });
      recordUsage(serverDeps.store, { sessionId, tier, action: 'repo', usage: out.usage, retries: out.usage.repairs, outcome: out.usage.repairs > 0 ? 'repaired' : 'ok' });
      serverDeps.store.updateJob(jobId, { status: 'succeeded', gaps: ingest.gaps });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return; // cancelled — cancel route owns the settle
      fail(e instanceof Error ? e.message : 'unknown error');
    } finally {
      repoJobRegistry.delete(jobId);
    }
  });

  return Response.json({ jobId, remaining: quota.remaining }, { status: 202, headers });
}

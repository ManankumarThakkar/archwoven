import { randomUUID } from 'node:crypto';
import { reserve, refundCredits, recordUsage, TIERS, WEIGHTS } from '@archwoven/jobs';
import { validateModel, appendDisclosures } from '@archwoven/model';
import type { TaskUsage } from '@archwoven/model';
import { parseRepoUrl, type ParsedRepoUrl } from '@archwoven/ingest';
import {
  serverDeps, readOrCreateSession, sessionCookie, tierOf,
  creditsExhaustedCopy, STOP_LOSS_COPY, BURST_COPY,
  llmNotConfigured, LLM_NOT_CONFIGURED_COPY,
} from '../../lib/server';
import { withSlot } from '../../lib/llm-limiter';
import { deployMode, privacyForMode } from '../../lib/mode';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { LOCAL_PATH_HINT } from '../../../lib/local-path';
import { repoJobRegistry } from '../../lib/repo-registry';
import { startJobDeadline, JOB_TIMEOUT_COPY } from '../../lib/job-registry';

export const runtime = 'nodejs';

const safeSubdir = (s: string): boolean =>
  /^[\w.-]+(\/[\w.-]+)*$/.test(s) && s.split('/').every((seg) => seg !== '.' && seg !== '..');

export async function POST(req: Request) {
  const { sessionId, minted } = readOrCreateSession(req);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (minted) headers['set-cookie'] = sessionCookie(sessionId);

  let body: { url?: string; localPath?: string; subdir?: string; ref?: string; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400, headers });
  }

  // §8: localPath is the private-clone import — accepted ONLY in local mode,
  // and rejected before any filesystem touch on a hosted deploy.
  let localPath = body.localPath !== undefined && body.localPath !== null && body.localPath !== '' ? String(body.localPath) : null;
  let parsed: ParsedRepoUrl | null = null;
  if (localPath !== null) {
    if (deployMode() !== 'local') {
      return Response.json({ error: 'Private repo import from a local path is available in local deployments only.' }, { status: 400, headers });
    }
    // Relative paths would resolve against the server's working directory, which the user cannot see.
    const trimmed = localPath.trim();
    localPath = trimmed === '~' || trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(2)) : trimmed;
    if (!isAbsolute(localPath))
      return Response.json({ error: LOCAL_PATH_HINT }, { status: 400, headers });
  } else {
    // URL validation BEFORE quota — a malformed/SSRF-shaped URL must not spend credits.
    const p = parseRepoUrl(String(body.url ?? ''));
    if (!p.ok) return Response.json({ error: p.error }, { status: 400, headers });
    parsed = p;
  }

  const subdir = body.subdir !== undefined && body.subdir !== null && body.subdir !== ''
    ? (safeSubdir(String(body.subdir)) ? String(body.subdir) : null)
    : parsed?.subdir ?? undefined;
  if (subdir === null) return Response.json({ error: 'subdir must be a simple relative path without ".."' }, { status: 400, headers });
  if (llmNotConfigured()) return Response.json({ reason: 'llm-not-configured', message: LLM_NOT_CONFIGURED_COPY }, { status: 503, headers });

  const tier = tierOf(sessionId);
  const key = body.idempotencyKey ? String(body.idempotencyKey) : undefined;
  if (key) {
    const existing = serverDeps.store.findJobByIdempotencyKey(key, sessionId);
    if (existing) {
      const used = serverDeps.store.creditsUsed(sessionId, new Date().toISOString().slice(0, 10));
      return Response.json({ jobId: existing.id, remaining: deployMode() === 'local' ? null : Math.max(0, TIERS[tier].pool - used) }, { status: 202, headers });
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
    let pendingUsage: TaskUsage | undefined;
    let metered = false;
    const fail = (error: string, usage = pendingUsage, retries = usage?.repairs ?? 0) => {
      // metering is unconditional — every spent token must reach call_log (stop-loss),
      // even when cancel owns the settle and the credit refund
      if (usage && !metered) { recordUsage(serverDeps.store, { sessionId, tier, action: 'repo', view: 'architecture', taskId: jobId, modelId: jobId, usage, retries, outcome: 'failed' }); metered = true; }
      if (!claim()) return; // cancel already settled + refunded this job
      serverDeps.store.updateJob(jobId, { status: 'failed', error });
      refundCredits(serverDeps.store, sessionId, day, WEIGHTS.repo);
    };
    const entry = repoJobRegistry.get(jobId)!;
    const stopDeadline = entry.controller.signal.aborted ? () => undefined : startJobDeadline(entry, () => fail(JOB_TIMEOUT_COPY));
    try {
      // cancel may have landed while queued — a cancelled job must never restart
      controller.signal.throwIfAborted();
      serverDeps.store.updateJob(jobId, { status: 'running', stage: 'fetching' });
      // stage writes are skipped once cancelled, so the poll never shows a stage on a dead job
      const stage = (s: string) => { if (!repoJobRegistry.get(jobId)?.settled) serverDeps.store.updateJob(jobId, { stage: s }); };
      const cloneDir = localPath !== null ? resolve(localPath) : null;
      const ingest = cloneDir !== null
        ? await serverDeps.ingestLocal(cloneDir, { subdir, signal: controller.signal, onStage: stage })
        : await serverDeps.ingestRepo(
            { owner: parsed!.owner, repo: parsed!.repo, ref: parsed!.ref ?? (body.ref ? String(body.ref) : undefined), subdir },
            { signal: controller.signal, onStage: stage },
          );
      if (!ingest.ok) return fail(ingest.message);
      controller.signal.throwIfAborted();

      stage('designing');
      const evidenceRepo = cloneDir !== null ? { owner: 'local', repo: basename(cloneDir) } : { owner: parsed!.owner, repo: parsed!.repo };
      const out = await serverDeps.assembleRepoModel(ingest.fragment, { ...evidenceRepo, sha: ingest.sha, framework: ingest.framework }, { signal: controller.signal });
      pendingUsage = out.usage;
      stage('validating-output');
      if (!out.ok) return fail(out.errors.join('; '), out.usage, out.usage.repairs);
      const checked = validateModel(out.model);
      if (!checked.ok) return fail(checked.errors.join('; '), out.usage, out.usage.repairs);
      if (entry.settled) {
        // A provider can finish successfully despite cancellation. Cancel owns
        // settlement/refund, but spent tokens still belong in the stop-loss meter.
        recordUsage(serverDeps.store, { sessionId, tier, action: 'repo', view: 'architecture', taskId: jobId, modelId: jobId, usage: out.usage, retries: out.usage.repairs, outcome: 'failed' });
        metered = true;
        return;
      }
      // §9: privacy is server-stamped from deploy mode — model self-report never wins.
      // Ingest disclosures live with the model, so a reload shows exactly what the first load did.
      const stamped = { ...appendDisclosures(checked.model, ingest.gaps), privacy: privacyForMode(deployMode()) };
      serverDeps.store.saveRevision(jobId, stamped, sessionId);
      serverDeps.store.updateJob(jobId, { stage: 'laying-out' });
      recordUsage(serverDeps.store, { sessionId, tier, action: 'repo', view: 'architecture', taskId: jobId, modelId: jobId, usage: out.usage, retries: out.usage.repairs, outcome: out.usage.repairs > 0 ? 'repaired' : 'ok' });
      metered = true;
      serverDeps.store.updateJob(jobId, { status: 'succeeded', gaps: ingest.gaps });
      // These persistence operations are synchronous: no cancel/deadline can interleave.
      // Claim only after they finish so a thrown write still follows failure/refund.
      claim();
    } catch (e) {
      if (controller.signal.reason?.name === 'TimeoutError') { fail(JOB_TIMEOUT_COPY); return; }
      if ((e as Error)?.name === 'AbortError') return; // cancelled — cancel route owns the settle
      fail(e instanceof Error ? e.message : 'unknown error');
    } finally {
      stopDeadline();
      repoJobRegistry.delete(jobId);
    }
  });

  return Response.json({ jobId, remaining: quota.remaining }, { status: 202, headers });
}

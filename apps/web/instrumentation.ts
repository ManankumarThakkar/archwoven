import { assertSafeRuntime, deployMode } from './app/lib/mode';
import { assertHostingProbeRuntime, hostingProbeRequested } from './lib/hosting-probe';

/**
 * Next.js server boot hook — runs exactly once per process (dev and prod).
 * - fail fast on unsafe config
 * - orphan sweep: settle jobs whose process died mid-flight, refund credits.
 * - hosted retention: expire anonymous diagrams 30 days after their last change (local never expires).
 * - on Vercel: none of the above. Jobs and diagrams live in Redis; there is no writable local database.
 *   Must live here, not in openStore — dev re-evaluates openStore per route
 *   bundle and would sweep live jobs. Edge runtime never touches node:sqlite.
 */
export async function register(): Promise<void> {
  assertSafeRuntime();
  assertHostingProbeRuntime();
  // The isolated preview has no application APIs, local database or background sweep.
  if (hostingProbeRequested()) return;
  // NEXT_RUNTIME is compile-time replaced — the edge build DCEs this import;
  // node:sqlite must never reach the edge bundle (see 5ff0568).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.VERCEL === '1') {
      // Requests already refuse AI work without job storage; say why once, by variable name only.
      const { hostedJobs, HOSTED_STORAGE_VARIABLES } = await import('./app/lib/hosted-runner');
      if (hostedJobs() === 'misconfigured') console.error(`[archwoven] hosted job storage is not configured, so AI requests are refused. Set ${HOSTED_STORAGE_VARIABLES}.`);
      return;
    }
    const { openStore, openEvaluationBudget } = await import('@archwoven/jobs');
    const path = process.env.ARCHWOVEN_DB ?? 'data/archwoven.db';
    if (process.env.ARCHWOVEN_EVAL_BUDGET_DB !== undefined) {
      const { resolve } = await import('node:path');
      if (resolve(process.env.ARCHWOVEN_EVAL_BUDGET_DB) === resolve(path)) throw new Error('Use a separate evaluation budget database.');
      const budget = openEvaluationBudget(process.env.ARCHWOVEN_EVAL_BUDGET_DB);
      try { budget.snapshot(); } finally { budget.close(); }
    }
    const store = openStore(path);
    const swept = store.sweepOrphans();
    store.close();
    if (swept) console.log(`[archwoven] orphan sweep settled ${swept} job(s) from a previous process`);
    if (deployMode() === 'hosted') {
      const { startRetentionSweeper } = await import('./lib/retention');
      startRetentionSweeper(() => openStore(path));
    }
  }
}

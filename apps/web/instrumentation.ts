import { assertSafeRuntime, deployMode } from './app/lib/mode';
import { assertHostingProbeRuntime, hostingProbeRequested } from './lib/hosting-probe';

/**
 * Next.js server boot hook — runs exactly once per process (dev and prod).
 * - fail fast on unsafe config
 * - orphan sweep: settle jobs whose process died mid-flight, refund credits.
 * - hosted retention: expire anonymous diagrams 30 days after their last change (local never expires).
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
    const { openStore } = await import('@archwoven/jobs');
    const path = process.env.ARCHWOVEN_DB ?? 'data/archwoven.db';
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

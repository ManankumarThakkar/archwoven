import { assertSafeRuntime } from './app/lib/mode';

/**
 * Next.js server boot hook — runs exactly once per process (dev and prod).
 * - fail fast on unsafe config (§15 guard)
 * - orphan sweep: settle jobs whose process died mid-flight, refund credits.
 *   Must live here, not in openStore — dev re-evaluates openStore per route
 *   bundle and would sweep live jobs. Edge runtime never touches node:sqlite.
 */
export async function register(): Promise<void> {
  assertSafeRuntime();
  // NEXT_RUNTIME is compile-time replaced — the edge build DCEs this import;
  // node:sqlite must never reach the edge bundle (see 5ff0568).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { openStore } = await import('@archwoven/jobs');
    const store = openStore(process.env.ARCHWOVEN_DB ?? 'data/archwoven.db');
    const swept = store.sweepOrphans();
    store.close();
    if (swept) console.log(`[archwoven] orphan sweep settled ${swept} job(s) from a previous process`);
  }
}

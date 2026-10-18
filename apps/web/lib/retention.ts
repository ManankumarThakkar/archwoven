type SweepStore = { sweepExpired(): { models: number; jobs: number }; close(): void };

/** Hosted retention: sweep at boot, then every 24 hours, on its own short-lived connection.
 *  A failed run is logged and retried on the next tick; the timer never keeps the process alive. */
export function startRetentionSweeper(open: () => SweepStore, log: (line: string) => void = console.log, intervalMs = 86_400_000): () => void {
  const run = () => {
    let store: SweepStore | undefined;
    try {
      store = open();
      const removed = store.sweepExpired();
      if (removed.models || removed.jobs) log(`[archwoven] retention sweep removed ${removed.models} diagram(s) and ${removed.jobs} job(s)`);
    } catch (error) {
      log(`[archwoven] retention sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      store?.close();
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

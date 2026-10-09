/**
 * §15 concurrency cap: at most N model calls run in parallel; excess jobs wait
 * in a FIFO queue with a visible position (surfaced by /api/jobs polling).
 * In-process by design — M2 is single-node (SPEC: no queue infra until measured
 * need); a scale-out would move this to shared state.
 */
const defaultLimit = () => {
  const n = Number(process.env.ARCHWOVEN_MAX_PARALLEL ?? 2);
  return Number.isFinite(n) && n > 0 ? n : 2;
};

let limit = defaultLimit();
let running = 0;
const waiters: { id: string; run: () => void }[] = [];

export function withSlot<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const start = () => {
    running++;
    return fn().finally(() => {
      running--;
      const next = waiters.shift();
      if (next) next.run();
    });
  };
  if (running + waiters.length < limit) return start();
  return new Promise<void>((resolve) => waiters.push({ id, run: resolve })).then(start);
}

/** 1-based queue position for a waiting job, or null if it is not waiting. */
export function slotPosition(id: string): number | null {
  const i = waiters.findIndex((w) => w.id === id);
  return i < 0 ? null : i + 1;
}

/** Test seam: reset the singleton between tests. */
export function resetSlots(newLimit?: number): void {
  limit = newLimit ?? defaultLimit();
  running = 0;
  waiters.length = 0;
}

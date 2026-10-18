/**
 * Concurrency cap: at most N model calls run in parallel; excess jobs wait
 * in a FIFO queue with a visible position (surfaced by /api/jobs polling).
 * In-process by design for a single-node deployment; a scale-out would move this
 * to shared state.
 */
const defaultLimit = () => {
  const n = Number(process.env.ARCHWOVEN_MAX_PARALLEL ?? 2);
  return Number.isFinite(n) && n > 0 ? n : 2;
};

interface LimiterState { limit: number; running: number; waiters: { id: string; run: () => void }[] }
// One process-wide queue across independently bundled API routes.
const processState = globalThis as typeof globalThis & { __archwovenLimiter?: LimiterState };
const state = processState.__archwovenLimiter ??= { limit: defaultLimit(), running: 0, waiters: [] };

export function withSlot<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const start = () => {
    state.running++;
    return fn().finally(() => {
      state.running--;
      const next = state.waiters.shift();
      if (next) next.run();
    });
  };
  if (state.running + state.waiters.length < state.limit) return start();
  return new Promise<void>((resolve) => state.waiters.push({ id, run: resolve })).then(start);
}

/** 1-based queue position for a waiting job, or null if it is not waiting. */
export function slotPosition(id: string): number | null {
  const i = state.waiters.findIndex((w) => w.id === id);
  return i < 0 ? null : i + 1;
}

/** Test seam: reset the singleton between tests. */
export function resetSlots(newLimit?: number): void {
  state.limit = newLimit ?? defaultLimit();
  state.running = 0;
  state.waiters.length = 0;
}

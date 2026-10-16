export interface InFlightJob {
  controller: AbortController;
  settled: boolean;
  deadlineAt?: number;
}

/** Shared across generation/repository/cancel/poll routes in this process. */
// Next bundles routes independently, and dev compilation reloads modules. A
// module-local Map gives cancel/poll a different registry from the worker.
const processState = globalThis as typeof globalThis & { __archwovenJobs?: Map<string, InFlightJob> };
export const jobRegistry = processState.__archwovenJobs ??= new Map<string, InFlightJob>();
export const JOB_TIMEOUT_COPY = 'Generation timed out. Try a smaller description or repository scope; you can retry the same input.';

/** Start only after obtaining a concurrency slot, never while queued. */
export function startJobDeadline(entry: InFlightJob, onTimeout: () => void): () => void {
  const raw = Number(process.env.ARCHWOVEN_JOB_TIMEOUT_MS ?? 180000);
  const ms = Number.isFinite(raw) && raw > 0 ? Math.min(600000, Math.ceil(raw)) : 180000;
  entry.deadlineAt = Date.now() + ms;
  const timer = setTimeout(() => {
    if (entry.settled) return;
    entry.controller.abort(new DOMException('Generation timed out', 'TimeoutError'));
    onTimeout();
  }, ms);
  return () => clearTimeout(timer);
}

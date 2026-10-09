/**
 * In-flight repo jobs: cancel flips status + aborts the controller; `settled`
 * is the atomic (same-event-loop) claim so cancel and job-failure refund once.
 * Lives in lib/ because Next.js route files reject non-handler exports.
 */
export const repoJobRegistry = new Map<string, { controller: AbortController; settled: boolean }>();

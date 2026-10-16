/**
 * In-flight repo jobs: cancel flips status + aborts the controller; `settled`
 * is the atomic (same-event-loop) claim so cancel and job-failure refund once.
 * Lives in lib/ because Next.js route files reject non-handler exports.
 */
// Compatibility name for existing route/test callers; description jobs now use
// the same controller and one-time settlement boundary.
export { jobRegistry as repoJobRegistry } from './job-registry';

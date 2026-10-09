import { assertSafeRuntime } from './app/lib/server';

/** Next.js server boot hook — fail fast on unsafe config (§15 guard). */
export function register(): void {
  assertSafeRuntime();
}

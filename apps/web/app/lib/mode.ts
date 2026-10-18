import type { Privacy } from '@archwoven/model';
import { resolveHostedModelId } from '@archwoven/model';

/** Single source of deployment truth: ARCHWOVEN_MODE=local is the private vertical. */
export const deployMode = (): 'hosted' | 'local' =>
  process.env.ARCHWOVEN_MODE === 'local' ? 'local' : 'hosted';

/**
 * Server-side privacy stamp. The model's self-reported privacy is never
 * security input — the deployment mode decides what left the machine.
 */
export const privacyForMode = (mode: 'hosted' | 'local'): Privacy =>
  mode === 'local'
    ? { classification: 'private', boundary: 'local-only' }
    : { classification: 'public', boundary: 'external-allowed' };

/** Demo-data mode flag — surfaced to the UI so fake output is never silent. */
export const fakeMode = () => process.env.ARCHWOVEN_FAKE === '1';

/**
 * Fake/local modes are test-and-demo affordances — they must never ship.
 * Production with ARCHWOVEN_FAKE serves every user the same canned diagram
 * (while still exercising the credit ladder), and ARCHWOVEN_MODE=local compiles
 * all quotas out. Boot fails loudly unless a second explicit ack opts in.
 *
 * Lives here (not server.ts) because instrumentation.ts calls it at boot: Next
 * compiles instrumentation for the edge runtime too, and server.ts drags in the
 * node-only ingest chain (node:child_process) that edge cannot bundle.
 */
export function assertSafeRuntime(): void {
  if (deployMode() === 'hosted' && !fakeMode()) resolveHostedModelId(process.env.ARCHWOVEN_HOSTED_MODEL);
  const prod = process.env.NODE_ENV === 'production';
  if (!prod) return;
  const acked = process.env.ARCHWOVEN_DEMO_ACK === '1';
  if (acked) return;
  if (process.env.ARCHWOVEN_FAKE === '1') {
    throw new Error('refusing to boot production with ARCHWOVEN_FAKE=1 (fake model data). Set ARCHWOVEN_DEMO_ACK=1 to run an explicit production demo.');
  }
  if (process.env.ARCHWOVEN_MODE === 'local') {
    throw new Error('refusing to boot production in ARCHWOVEN_MODE=local (quotas disabled). Set ARCHWOVEN_DEMO_ACK=1 to opt in explicitly.');
  }
}

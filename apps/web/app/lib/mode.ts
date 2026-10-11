import type { Privacy } from '@archwoven/model';

/** Single source of deployment truth: ARCHWOVEN_MODE=local is the private vertical. */
export const deployMode = (): 'hosted' | 'local' =>
  process.env.ARCHWOVEN_MODE === 'local' ? 'local' : 'hosted';

/**
 * Server-side privacy stamp (§9). The model's self-reported privacy is never
 * security input — the deployment mode decides what left the machine.
 */
export const privacyForMode = (mode: 'hosted' | 'local'): Privacy =>
  mode === 'local'
    ? { classification: 'private', boundary: 'local-only' }
    : { classification: 'public', boundary: 'external-allowed' };

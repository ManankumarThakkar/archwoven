import type { Provenance } from '@archwoven/model';

// proposed/inferred are visually distinct from user-specified/source-supported (scenario 6).
export const PROVENANCE_STYLE: Record<Provenance, { border: string; bg: string; badge: string }> = {
  'user-specified': { border: '#5eead4', bg: '#0f2e2b', badge: 'described' },
  'source-supported': { border: '#93c5fd', bg: '#10233f', badge: 'from source' },
  inferred: { border: '#fbbf24', bg: '#3a2e10', badge: 'inferred' },
  proposed: { border: '#c4b5fd', bg: '#2a2440', badge: 'proposed' },
};


/** Motion governor (§6 reduced-motion): localStorage `archwoven-motion` is written
 *  ONLY on explicit toggle click, so any stored value is a deliberate user choice
 *  that wins over the OS preference; OS reduced-motion applies only when unset. */
export function motionMode(stored: string | null, osReduced: boolean): 'still' | 'motion' {
  if (stored === 'still' || stored === 'motion') return stored;
  return osReduced ? 'still' : 'motion';
}

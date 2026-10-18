/** Explicit, isolated diagnostics; never a substitute for the hosted backend. */
export const hostingProbeRequested = () => process.env.ARCHWOVEN_HOSTING_PROBE === '1';

export function assertHostingProbeRuntime(): void {
  if (!hostingProbeRequested()) return;
  if (process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'preview') {
    throw new Error('Hosting diagnostics require a Vercel preview deployment.');
  }
  const token = process.env.ARCHWOVEN_HOSTING_PROBE_TOKEN ?? '';
  if (!/^[\x21-\x7e]{32,256}$/.test(token)) {
    throw new Error('Hosting diagnostics require a 32–256 character secret token without spaces.');
  }
  if (process.env.ARCHWOVEN_MODE === 'local' || process.env.ARCHWOVEN_FAKE === '1') {
    throw new Error('Hosting diagnostics require hosted mode with demo data disabled.');
  }
}

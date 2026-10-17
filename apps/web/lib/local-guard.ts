const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

const hostnameOf = (host: string): string => (host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!).toLowerCase();

/**
 * Local deployments read folders on this machine, so the API answers only requests addressed to
 * localhost (defeats DNS rebinding) from the same origin (defeats cross-site requests, including
 * "simple" POSTs that skip CORS preflight). Hosted deployments are unaffected.
 */
export function localRequestRefusal(headers: Headers, mode: string | undefined): string | null {
  if (mode !== 'local') return null;
  const host = headers.get('host') ?? '';
  if (!LOOPBACK.has(hostnameOf(host))) return 'Archwoven local mode only accepts requests addressed to localhost or 127.0.0.1.';
  const origin = headers.get('origin');
  let sameOrigin = true;
  if (origin !== null) {
    try { sameOrigin = new URL(origin).host.toLowerCase() === host.toLowerCase(); } catch { sameOrigin = false; }
  }
  if (!sameOrigin || headers.get('sec-fetch-site') === 'cross-site') return 'Cross-site requests are refused in local mode.';
  return null;
}

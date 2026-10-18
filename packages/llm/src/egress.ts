/**
 * Egress guard: in local/private deployments every outbound call goes
 * through this wrapper. A host outside the allowlist is refused BEFORE the
 * request is built — no DNS, no socket, nothing half-sent. Model download
 * happens via `ollama pull` (outside this process), so the fetch allowlist is
 * exactly local inference + GitHub repo fetch.
 */
// `ollama:11434` is the inference service on the shipped Compose network.
export const LOCAL_EGRESS_ALLOW = ['localhost:11434', '127.0.0.1:11434', 'ollama:11434', 'api.github.com', 'codeload.github.com'];

export class EgressBlockedError extends Error {
  constructor(public readonly host: string) {
    super(`egress blocked: ${host} is not in the local allowlist`);
    this.name = 'EgressBlockedError';
  }
}

export function makeEgressGuard(allow: string[], inner: typeof fetch = fetch): typeof fetch {
  const allowed = new Set(allow);
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const { host } = new URL(url);
    if (!allowed.has(host)) return Promise.reject(new EgressBlockedError(host));
    return inner(input as RequestInfo, init);
  }) as typeof fetch;
}

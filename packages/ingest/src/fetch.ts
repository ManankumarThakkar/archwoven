/**
 * Commit pinning + size-capped tarball fetch. All network flows through the
 * injected fetcher — production wires global fetch; tests inject canned
 * responses (zero network). The SHA resolved here is used for the tarball,
 * extraction, and every evidence link, so a branch advancing mid-analysis can
 * never mix commits into one model.
 */
export type GithubApiFetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export const NOT_FOUND_OR_PRIVATE_COPY = 'Repository not found or private — sign in with GitHub for private repos.';
export const RATE_LIMITED_COPY = 'GitHub is rate-limiting anonymous requests right now — try again in a few minutes, or sign in.';

export type PinResult =
  | { ok: true; sha: string; defaultBranch: string }
  | { ok: false; reason: 'not-found-or-private' | 'rate-limited' | 'network'; message: string };

const API = 'https://api.github.com';
const UA = { 'User-Agent': 'archwoven', Accept: 'application/vnd.github+json' };

export async function pinCommit(
  fetcher: GithubApiFetch,
  repo: { owner: string; repo: string },
  ref?: string,
  signal?: AbortSignal,
): Promise<PinResult> {
  const fail = (status: number, body: unknown): PinResult => {
    // 404 and anonymous-403 are indistinguishable — never claim the repo doesn't exist.
    if ((status === 404 || status === 403) && !/rate limit/i.test(String((body as { message?: string })?.message ?? ''))) {
      return { ok: false, reason: 'not-found-or-private', message: NOT_FOUND_OR_PRIVATE_COPY };
    }
    if (status === 403 || status === 429) return { ok: false, reason: 'rate-limited', message: RATE_LIMITED_COPY };
    return { ok: false, reason: 'network', message: `GitHub API returned ${status}` };
  };

  try {
    if (ref) {
      const res = await fetcher(`${API}/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(ref)}`, { headers: UA, signal });
      if (!res.ok) return fail(res.status, await res.json().catch(() => ({})));
      const sha = String((await res.json() as { sha?: string }).sha ?? '');
      if (!sha) return { ok: false, reason: 'network', message: 'no sha in response' };
      return { ok: true, sha, defaultBranch: ref };
    }
    const res = await fetcher(`${API}/repos/${repo.owner}/${repo.repo}`, { headers: UA, signal });
    if (!res.ok) return fail(res.status, await res.json().catch(() => ({})));
    const branch = String((await res.json() as { default_branch?: string }).default_branch ?? '');
    if (!branch) return { ok: false, reason: 'network', message: 'no default_branch in response' };
    const commit = await fetcher(`${API}/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(branch)}`, { headers: UA, signal });
    if (!commit.ok) return fail(commit.status, await commit.json().catch(() => ({})));
    const sha = String((await commit.json() as { sha?: string }).sha ?? '');
    if (!sha) return { ok: false, reason: 'network', message: 'no sha in response' };
    return { ok: true, sha, defaultBranch: branch };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    return { ok: false, reason: 'network', message: `network failure: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Download a codeload tarball with a hard byte cap (Content-Length pre-check + streaming counter). */
export async function fetchTarball(
  fetcher: GithubApiFetch,
  repo: { owner: string; repo: string },
  sha: string,
  opts: { maxBytes: number; signal?: AbortSignal },
): Promise<ArrayBuffer> {
  const url = `https://codeload.github.com/${repo.owner}/${repo.repo}/tar.gz/${sha}`;
  const res = await fetcher(url, { headers: UA, signal: opts.signal });
  if (!res.ok) throw new Error(`codeload fetch failed: ${res.status}`);
  const declared = Number(res.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > opts.maxBytes) throw new Error(`oversized: ${declared} bytes exceeds cap ${opts.maxBytes}`);

  if (!res.body) return new ArrayBuffer(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > opts.maxBytes) {
      await reader.cancel();
      throw new Error(`oversized: stream exceeded cap ${opts.maxBytes}`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out.buffer;
}

import { describe, expect, it } from 'vitest';
import { pinCommit, fetchTarball, NOT_FOUND_OR_PRIVATE_COPY } from './fetch';
import type { GithubApiFetch } from './fetch';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('pinCommit (commit pinning)', () => {
  it('no ref → default branch SHA via two API hops', async () => {
    const seen: string[] = [];
    const fetcher: GithubApiFetch = async (url) => {
      seen.push(url);
      if (url.endsWith('/repos/foo/bar')) return json({ default_branch: 'main' });
      if (url.includes('/commits/main')) return json({ sha: SHA });
      throw new Error(`unexpected url ${url}`);
    };
    const r = await pinCommit(fetcher, { owner: 'foo', repo: 'bar' });
    expect(r).toEqual({ ok: true, sha: SHA, defaultBranch: 'main' });
    expect(seen[0]).toBe('https://api.github.com/repos/foo/bar');
  });

  it('explicit ref → existence check on that exact ref', async () => {
    const seen: string[] = [];
    const fetcher: GithubApiFetch = async (url) => {
      seen.push(url);
      return json({ sha: SHA });
    };
    const r = await pinCommit(fetcher, { owner: 'foo', repo: 'bar' }, 'v1.2.3');
    expect(r.ok).toBe(true);
    expect(seen[0]).toBe('https://api.github.com/repos/foo/bar/commits/v1.2.3');
  });

  it('404 → not-found-or-private copy that never claims non-existence', async () => {
    const fetcher: GithubApiFetch = async () => json({ message: 'Not Found' }, 404);
    const r = await pinCommit(fetcher, { owner: 'foo', repo: 'bar' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('not-found-or-private');
      expect(r.message).toMatch(/not found or private/i);
      expect(r.message).toMatch(/private repos/i);
      expect(r.message).not.toMatch(/does not exist/i);
    }
  });

  it('anonymous 403 (private repo) → same non-inferring copy', async () => {
    const fetcher: GithubApiFetch = async () => json({ message: 'Forbidden' }, 403);
    const r = await pinCommit(fetcher, { owner: 'foo', repo: 'bar' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not-found-or-private');
  });

  it('rate-limited 403 → rate-limited with actionable copy', async () => {
    const fetcher: GithubApiFetch = async () => json({ message: "API rate limit exceeded for 1.2.3.4" }, 403);
    const r = await pinCommit(fetcher, { owner: 'foo', repo: 'bar' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('rate-limited');
      expect(r.message).toMatch(/try again/i);
    }
  });

  it('network failure → network reason', async () => {
    const fetcher: GithubApiFetch = async () => { throw new TypeError('fetch failed'); };
    const r = await pinCommit(fetcher, { owner: 'foo', repo: 'bar' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('network');
  });

  it('pins the export copy constant used by the UI', () => {
    expect(NOT_FOUND_OR_PRIVATE_COPY).toMatch(/not found or private/i);
  });
});

describe('fetchTarball (size caps)', () => {
  it('rejects by Content-Length before downloading', async () => {
    const fetcher: GithubApiFetch = async () =>
      new Response(null, { status: 200, headers: { 'content-length': String(10 * 1024 * 1024) } });
    await expect(fetchTarball(fetcher, { owner: 'foo', repo: 'bar' }, SHA, { maxBytes: 1024 }))
      .rejects.toThrow(/oversized/i);
  });

  it('aborts mid-stream when the body exceeds the cap', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 50; i++) c.enqueue(new Uint8Array(1024)); // 50 KiB
        c.close();
      },
    });
    const fetcher: GithubApiFetch = async () => new Response(stream);
    await expect(fetchTarball(fetcher, { owner: 'foo', repo: 'bar' }, SHA, { maxBytes: 10 * 1024 }))
      .rejects.toThrow(/oversized/i);
  });

  it('honours an external AbortSignal', async () => {
    const ac = new AbortController();
    ac.abort();
    // real fetch() rejects immediately on an aborted signal — the fake must too
    const fetcher: GithubApiFetch = async (_u, init) => {
      if (init?.signal?.aborted) throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
      return new Response(null);
    };
    await expect(fetchTarball(fetcher, { owner: 'foo', repo: 'bar' }, SHA, { maxBytes: 1024 * 1024, signal: ac.signal }))
      .rejects.toThrow(/abort/i);
  });

  it('non-200 → error', async () => {
    const fetcher: GithubApiFetch = async () => new Response('nope', { status: 404 });
    await expect(fetchTarball(fetcher, { owner: 'foo', repo: 'bar' }, SHA, { maxBytes: 1024 * 1024 }))
      .rejects.toThrow(/codeload|fetch|404/i);
  });

  it('small tarball returns its bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetcher: GithubApiFetch = async () => new Response(bytes);
    const buf = await fetchTarball(fetcher, { owner: 'foo', repo: 'bar' }, SHA, { maxBytes: 1024 });
    expect(new Uint8Array(buf)).toEqual(bytes);
  });
});

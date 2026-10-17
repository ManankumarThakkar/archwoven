import { describe, expect, it } from 'vitest';
import { parseRepoUrl } from './url';

describe('parseRepoUrl (§14 URL validation + SSRF block)', () => {
  it('accepts a plain repo URL', () => {
    expect(parseRepoUrl('https://github.com/spring-projects/spring-petclinic')).toEqual({
      ok: true, owner: 'spring-projects', repo: 'spring-petclinic',
    });
  });

  it('accepts www.github.com', () => {
    const r = parseRepoUrl('https://www.github.com/foo/bar');
    expect(r.ok).toBe(true);
  });

  it('accepts a ref and a subdir after /tree/', () => {
    expect(parseRepoUrl('https://github.com/foo/bar/tree/main')).toEqual({
      ok: true, owner: 'foo', repo: 'bar', ref: 'main',
    });
    expect(parseRepoUrl('https://github.com/foo/bar/tree/v1.2.3/src/main/java')).toEqual({
      ok: true, owner: 'foo', repo: 'bar', ref: 'v1.2.3', subdir: 'src/main/java',
    });
  });

  it('accepts a full SHA ref', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    expect(parseRepoUrl(`https://github.com/foo/bar/tree/${sha}`)).toEqual({
      ok: true, owner: 'foo', repo: 'bar', ref: sha,
    });
  });

  it('strips query strings and trailing slashes', () => {
    expect(parseRepoUrl('https://github.com/foo/bar/?utm=1')).toEqual({
      ok: true, owner: 'foo', repo: 'bar',
    });
    expect(parseRepoUrl('https://github.com/foo/bar/')).toEqual({
      ok: true, owner: 'foo', repo: 'bar',
    });
  });

  it('rejects missing or non-https schemes', () => {
    expect(parseRepoUrl('github.com/foo/bar').ok).toBe(false);
    expect(parseRepoUrl('http://github.com/foo/bar').ok).toBe(false);
    expect(parseRepoUrl('git@github.com:foo/bar.git').ok).toBe(false);
  });

  it('rejects non-github hosts, including suffix tricks', () => {
    expect(parseRepoUrl('https://gitlab.com/foo/bar').ok).toBe(false);
    expect(parseRepoUrl('https://github.com.evil.com/foo/bar').ok).toBe(false);
    expect(parseRepoUrl('https://evil.com/github.com/foo/bar').ok).toBe(false);
    expect(parseRepoUrl('https://api.github.com/foo/bar').ok).toBe(false);
  });

  it('rejects internal addresses in every IP encoding (SSRF)', () => {
    for (const u of [
      'http://127.0.0.1/foo/bar',
      'https://127.0.0.1/foo/bar',
      'https://10.0.0.1/foo/bar',
      'https://192.168.1.1/foo/bar',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/foo/bar',
      'https://0.0.0.0/foo/bar',
      'https://localhost/foo/bar',
      'https://metadata.google.internal/foo/bar',
      'https://2130706433/foo/bar', // decimal 127.0.0.1
      'https://0x7f000001/foo/bar', // hex 127.0.0.1
      'https://0177.0.0.1/foo/bar', // octal 127.0.0.1
    ]) {
      const r = parseRepoUrl(u);
      expect(r.ok, u).toBe(false);
    }
  });

  it('rejects malformed owner/repo shapes', () => {
    expect(parseRepoUrl('https://github.com/foo').ok).toBe(false);
    expect(parseRepoUrl('https://github.com/').ok).toBe(false);
    expect(parseRepoUrl('https://github.com/foo/bar/baz/qux/tree/x/y/z').ok).toBe(false); // blob-style deep path without /tree/
    expect(parseRepoUrl('https://github.com/foo bar/baz').ok).toBe(false);
    expect(parseRepoUrl('https://github.com/foo/bar/tree/').ok).toBe(false); // empty ref
  });

  it('accepts scoped-package folders written with @ or its percent-encoding', () => {
    const want = { ok: true, owner: 'secretlint', repo: 'secretlint', ref: 'master', subdir: 'packages/@secretlint/core' };
    expect(parseRepoUrl('https://github.com/secretlint/secretlint/tree/master/packages/@secretlint/core')).toEqual(want);
    expect(parseRepoUrl('https://github.com/secretlint/secretlint/tree/master/packages/%40secretlint/core')).toEqual(want);
  });

  it('rejects encoded separators and traversal hidden in a subdir segment', () => {
    expect(parseRepoUrl('https://github.com/foo/bar/tree/main/a%2F..%2Fetc').ok).toBe(false);
    expect(parseRepoUrl('https://github.com/foo/bar/tree/main/%2E%2E/etc').ok).toBe(false);
    expect(parseRepoUrl('https://github.com/foo/bar/tree/main/%E0%A4%A').ok).toBe(false);
  });

  it('rejects traversal in the subdir', () => {
    expect(parseRepoUrl('https://github.com/foo/bar/tree/main/../etc').ok).toBe(false);
  });
});

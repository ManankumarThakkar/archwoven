/**
 * Repo URL validation (§14): exact host allowlist, https-only, and SSRF blocking
 * of every IP-literal encoding before any fetch is attempted. DNS names that
 * resolve internally are a known gap (api.github.com/codeload are pinned hosts;
 * resolution-level blocking is M4 hardening).
 */
export type ParsedRepoUrl =
  | { ok: true; owner: string; repo: string; ref?: string; subdir?: string }
  | { ok: false; error: string };

const ALLOWED_HOSTS = new Set(['github.com', 'www.github.com']);
const NAME = /^[A-Za-z0-9._-]+$/;
const SHA = /^[0-9a-fA-F]{7,40}$/;

/** Reject IP literals in decimal/hex/octal/dotted forms and known internal names. */
const isInternalHost = (host: string): boolean => {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  // pure numeric literal (decimal)
  if (/^\d+$/.test(h)) {
    const n = Number(h);
    if (Number.isFinite(n)) return true; // any bare IP literal is refused — we only ever want github.com
  }
  if (/^0x[0-9a-f]+$/i.test(h)) return true;
  // dotted quad / dotted hex / dotted octal
  const parts = h.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p) || /^0x[0-9a-f]+$/i.test(p))) return true;
  // IPv6 (contains ':')
  if (h.includes(':')) return true;
  return false;
};

export function parseRepoUrl(raw: string): ParsedRepoUrl {
  const s = String(raw);
  // Reject traversal in the RAW string — URL() normalizes dot-segments away,
  // which would silently rewrite the user's intent instead of refusing it.
  if (/(^|\/)\.\.?(\/|$)/.test(s.split('?')[0]!)) return { ok: false, error: 'traversal in path' };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: 'not a valid URL' };
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'https:// required' };
  if (!ALLOWED_HOSTS.has(u.hostname)) return { ok: false, error: 'host not allowed' };
  if (isInternalHost(u.hostname)) return { ok: false, error: 'internal address blocked' };

  const segments = u.pathname.split('/').filter((s) => s.length > 0);
  if (segments.length < 2) return { ok: false, error: 'URL must be github.com/owner/repo' };
  const [owner, repo, ...rest] = segments;
  if (!owner || !NAME.test(owner)) return { ok: false, error: 'invalid owner' };
  if (!repo || !NAME.test(repo.replace(/\.git$/, ''))) return { ok: false, error: 'invalid repo name' };
  const cleanRepo = repo.replace(/\.git$/, '');

  if (rest.length === 0) return { ok: true, owner, repo: cleanRepo };

  if (rest[0] !== 'tree') return { ok: false, error: 'only /tree/<ref> paths are accepted' };
  const ref = rest[1];
  if (!ref) return { ok: false, error: 'empty ref' };
  // Branch names containing '/' are ambiguous with subdirs — use a SHA or default branch.
  if (!SHA.test(ref) && !NAME.test(ref)) return { ok: false, error: 'invalid ref' };

  const subdirParts = rest.slice(2);
  if (subdirParts.some((p) => p === '..' || p === '.')) return { ok: false, error: 'traversal in subdir' };
  const subdir = subdirParts.join('/');
  if (subdirParts.length > 0 && !subdirParts.every((p) => NAME.test(p))) return { ok: false, error: 'invalid subdir segment' };

  return { ok: true, owner, repo: cleanRepo, ref, ...(subdir ? { subdir } : {}) };
}

// subpath import: url.ts is dependency-free — the barrel would drag node:fs into the client bundle
import { parseRepoUrl } from '@archwoven/ingest/url';

/**
 * Client-side URL gate for the repo form — same parser the server uses
 * (single source of truth), so the submit button never enables a URL that
 * would 400. Returns the parse error string, or null when valid.
 */
export function validateRepoUrlInput(raw: string): string | null {
  const t = raw.trim();
  if (!t) return 'Repository URL is required';
  const r = parseRepoUrl(t);
  return r.ok ? null : r.error;
}

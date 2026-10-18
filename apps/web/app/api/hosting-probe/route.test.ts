import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const token = 'preview-diagnostic-'.repeat(3);
const request = (bearer = token) => new Request('https://preview.example/api/hosting-probe', {
  headers: { authorization: `Bearer ${bearer}` },
});

afterEach(() => vi.unstubAllEnvs());

function enable() {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('ARCHWOVEN_HOSTING_PROBE', '1');
  vi.stubEnv('ARCHWOVEN_HOSTING_PROBE_TOKEN', token);
}

describe('hosting dependency probe', () => {
  it('is unavailable unless explicitly enabled', async () => {
    enable();
    vi.stubEnv('ARCHWOVEN_HOSTING_PROBE', '');
    expect((await GET(request())).status).toBe(404);
  });

  it.each(['production', 'development', ''])('is unavailable in %s deployments', async (environment) => {
    enable();
    vi.stubEnv('VERCEL_ENV', environment);
    expect((await GET(request())).status).toBe(404);
  });

  it.each(['', 'short'])('fails closed with an inadequate configured token', async (configured) => {
    enable();
    vi.stubEnv('ARCHWOVEN_HOSTING_PROBE_TOKEN', configured);
    expect((await GET(request(configured))).status).toBe(404);
  });

  it('refuses invalid authorization without exposing diagnostics', async () => {
    enable();
    for (const candidate of ['', 'wrong', 'x'.repeat(token.length)]) {
      const response = await GET(request(candidate));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Not found' });
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
  });

  it('runs real Java/Python parsing and precise secret detection without network access', async () => {
    enable();
    // Any accidental provider call, token count or repository download must fail this check.
    vi.stubGlobal('fetch', () => { throw new Error('network access is forbidden in this probe'); });
    try {
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        checks: { spring: true, fastapi: true, secretScanner: true },
      });
      expect(response.headers.get('cache-control')).toContain('no-store');
    } finally { vi.unstubAllGlobals(); }
  });
});

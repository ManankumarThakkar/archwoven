import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { config, middleware } from './middleware';

afterEach(() => vi.unstubAllEnvs());

describe('local-mode API guard', () => {
  it('guards every API route and nothing else', () => {
    expect(config.matcher).toBe('/api/:path*');
  });

  it('refuses a rebinding-style request with 403 in local mode', async () => {
    vi.stubEnv('ARCHWOVEN_MODE', 'local');
    const res = middleware(new NextRequest('http://evil.example:3000/api/repo', { method: 'POST', headers: { host: 'evil.example:3000' } }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/addressed to localhost/);
  });

  it('lets a same-origin local request through', () => {
    vi.stubEnv('ARCHWOVEN_MODE', 'local');
    const res = middleware(new NextRequest('http://127.0.0.1:3031/api/repo', { method: 'POST', headers: { host: '127.0.0.1:3031', origin: 'http://127.0.0.1:3031' } }));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});

describe('isolated hosting diagnostics', () => {
  it.each(['/api/generate', '/api/repo', '/api/refine', '/api/config', '/api/jobs/any', '/api/models/any/expand'])('blocks %s before application code', async (path) => {
    vi.stubEnv('ARCHWOVEN_HOSTING_PROBE', '1');
    const response = middleware(new NextRequest(`https://preview.example${path}`));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({ error: 'hosting-probe-only' });
  });

  it('allows only the diagnostic endpoint to handle its own authentication', () => {
    vi.stubEnv('ARCHWOVEN_HOSTING_PROBE', '1');
    const response = middleware(new NextRequest('https://preview.example/api/hosting-probe'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});

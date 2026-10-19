import { afterEach, expect, it, vi } from 'vitest';
import robots from './robots';
import sitemap from './sitemap';
import { metadata as workspaceMetadata } from './workspace/layout';

afterEach(() => vi.unstubAllEnvs());
function production() {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL', '1'); vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('ARCHWOVEN_MODE', 'hosted'); vi.stubEnv('ARCHWOVEN_FAKE', '0'); vi.stubEnv('ARCHWOVEN_SITE_URL', 'https://archwoven.example');
}
it('lists only the public landing URL and lets crawlers see workspace noindex', () => {
  production();
  expect(sitemap()).toEqual([{ url: 'https://archwoven.example/' }]);
  expect(robots()).toEqual({ rules: { userAgent: '*', allow: '/', disallow: '/api/' }, sitemap: 'https://archwoven.example/sitemap.xml' });
  expect(workspaceMetadata.robots).toEqual({ index: false, follow: false });
  expect(workspaceMetadata.alternates).toBeUndefined();
});
it('publishes no URLs from a preview, even when a canonical origin is configured', () => {
  production(); vi.stubEnv('VERCEL_ENV', 'preview');
  expect(sitemap()).toEqual([]);
  expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
});
it('publishes no URLs if production has no explicit origin', () => {
  production(); vi.stubEnv('ARCHWOVEN_SITE_URL', '');
  expect(sitemap()).toEqual([]);
  expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
});

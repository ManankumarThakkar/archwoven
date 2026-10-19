import { describe, expect, it } from 'vitest';
import { publication, siteMetadata, landingMetadata, structuredData } from './seo';
const prod = { NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production', ARCHWOVEN_MODE: 'hosted', ARCHWOVEN_FAKE: '0', ARCHWOVEN_SITE_URL: 'https://archwoven.example/' };

describe('search publication boundary', () => {
  it('uses the explicitly configured origin for a real production deployment', () => {
    expect(publication(prod).indexable).toBe(true);
    expect(publication(prod).origin?.href).toBe('https://archwoven.example/');
  });
  it.each(['', 'not a URL', 'http://archwoven.example', 'https://user:pass@archwoven.example', 'https://archwoven.example/workspace', 'https://archwoven.example/?token=x', 'https://archwoven.example/#model=x', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://demo.vercel.app:8443'])('does not publish an unsafe or missing origin: %s', raw => {
    expect(publication({ ...prod, ARCHWOVEN_SITE_URL: raw }).indexable).toBe(false);
    expect(landingMetadata({ ...prod, ARCHWOVEN_SITE_URL: raw }).alternates).toBeUndefined();
  });
  it.each([{ VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'development' }, { VERCEL_ENV: '' }, { NODE_ENV: 'development' }, { ARCHWOVEN_MODE: 'local' }, { ARCHWOVEN_FAKE: '1' }])('keeps non-public environments out of search: %j', override => {
    const env = { ...prod, ...override };
    expect(publication(env).indexable).toBe(false);
    expect(siteMetadata(env).robots).toEqual({ index: false, follow: false });
    expect(landingMetadata(env).alternates).toBeUndefined();
    expect(structuredData(env)).toBeNull();
  });
  it('also supports an explicitly configured self-hosted production site', () => {
    const { VERCEL, VERCEL_ENV, ...env } = prod;
    expect(publication(env).indexable).toBe(true);
  });
  it('uses absolute configured URLs for canonical and social images', () => {
    expect(landingMetadata(prod).alternates).toEqual({ canonical: 'https://archwoven.example/' });
    expect(siteMetadata(prod).openGraph).toMatchObject({ images: [{ url: 'https://archwoven.example/og.png', width: 1200, height: 630 }] });
    expect(siteMetadata(prod).title).toMatchObject({ default: expect.stringContaining('Architecture Diagram Generator') });
  });
  it('describes the real creator and app without invented reviews or ratings', () => {
    const json = JSON.stringify(structuredData(prod));
    expect(json).toContain('Manan Thakkar');
    expect(json).toContain('https://www.linkedin.com/in/mananthakkar20/');
    expect(json).toContain('WebApplication');
    expect(json).not.toContain('aggregateRating');
    expect(json).not.toContain('reviewCount');
  });
  it('only emits verification tokens when configured', () => {
    const metadata = siteMetadata({ ...prod, ARCHWOVEN_GOOGLE_SITE_VERIFICATION: 'google-owner-token', ARCHWOVEN_BING_SITE_VERIFICATION: 'bing-owner-token' });
    expect(metadata.verification).toMatchObject({ google: 'google-owner-token', other: { 'msvalidate.01': 'bing-owner-token' } });
    expect(siteMetadata(prod).verification).toBeUndefined();
  });
});

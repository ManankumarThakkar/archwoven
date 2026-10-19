import type { Metadata } from 'next';
import { site } from './site';

type Environment = Record<string, string | undefined>;
const title = 'Archwoven — AI Architecture Diagram Generator';
const description = 'Turn system descriptions and public GitHub repositories into interactive architecture diagrams. Inspect source evidence, refine connections and export SVG, PNG or JSON.';

/** An explicit canonical origin prevents request headers or preview hostnames from becoming publication URLs. */
export function publication(env: Environment = process.env): { origin: URL | null; indexable: boolean } {
  let origin: URL | null = null;
  try {
    const url = new URL(env.ARCHWOVEN_SITE_URL?.trim() ?? '');
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash
      && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.hostname.endsWith('.localhost') && !url.hostname.endsWith('.local')) origin = url;
  } catch { /* An unpublished site stays noindex until a valid origin is configured. */ }
  const production = env.NODE_ENV === 'production' && (!env.VERCEL_ENV || env.VERCEL_ENV === 'production')
    && (env.VERCEL !== '1' || env.VERCEL_ENV === 'production');
  return { origin, indexable: !!origin && production && env.ARCHWOVEN_MODE !== 'local' && env.ARCHWOVEN_FAKE !== '1' };
}

export function siteMetadata(env: Environment = process.env): Metadata {
  const { origin, indexable } = publication(env);
  const images = indexable && origin ? [{ url: new URL('/og.png', origin).href, width: 1200, height: 630, alt: 'Archwoven — Architecture diagrams from ideas and code' }] : undefined;
  const google = env.ARCHWOVEN_GOOGLE_SITE_VERIFICATION?.trim();
  const bing = env.ARCHWOVEN_BING_SITE_VERIFICATION?.trim();
  return {
    metadataBase: origin ?? undefined,
    title: { default: title, template: '%s | Archwoven' },
    description,
    applicationName: site.name,
    creator: site.creator,
    authors: [{ name: site.creator, url: site.linkedin }],
    robots: { index: indexable, follow: indexable },
    openGraph: { type: 'website', locale: 'en_US', siteName: site.name, title, description, images },
    twitter: { card: 'summary_large_image', title, description, images },
    ...(google || bing ? { verification: { ...(google ? { google } : {}), ...(bing ? { other: { 'msvalidate.01': bing } } : {}) } } : {}),
  };
}

/** Canonical and the public graph belong only to the landing page, never session URLs. */
export function landingMetadata(env: Environment = process.env): Metadata {
  const { origin, indexable } = publication(env);
  return indexable && origin ? { alternates: { canonical: origin.href }, openGraph: { ...siteMetadata(env).openGraph, url: origin.href } } : {};
}

export function structuredData(env: Environment = process.env): Record<string, unknown> | null {
  const { origin, indexable } = publication(env);
  if (!origin || !indexable) return null;
  const creatorId = new URL('/#creator', origin).href;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Person', '@id': creatorId, name: site.creator, url: site.linkedin, sameAs: [site.linkedin, site.github] },
      { '@type': 'WebSite', '@id': new URL('/#website', origin).href, name: site.name, url: origin.href, creator: { '@id': creatorId } },
      { '@type': 'WebApplication', '@id': new URL('/#application', origin).href, name: site.name, url: origin.href, description, applicationCategory: 'DeveloperApplication', operatingSystem: 'Any', browserRequirements: 'JavaScript is required for the interactive workspace.', isAccessibleForFree: true, creator: { '@id': creatorId }, license: 'https://opensource.org/license/mit', softwareHelp: site.repository + '#readme', featureList: ['Architecture diagrams', 'Sequence diagrams', 'ER diagrams', 'Component detail', 'SVG, PNG and JSON exports'] },
    ],
  };
}

import type { MetadataRoute } from 'next';
import { publication } from './lib/seo';

export default function robots(): MetadataRoute.Robots {
  const { origin, indexable } = publication();
  if (!indexable || !origin) return { rules: { userAgent: '*', disallow: '/' } };
  // Let crawlers read /workspace's noindex metadata; robots exclusions are not access control.
  return { rules: { userAgent: '*', allow: '/', disallow: '/api/' }, sitemap: new URL('/sitemap.xml', origin).href };
}

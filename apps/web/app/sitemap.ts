import type { MetadataRoute } from 'next';
import { publication } from './lib/seo';

export default function sitemap(): MetadataRoute.Sitemap {
  const { origin, indexable } = publication();
  return indexable && origin ? [{ url: origin.href }] : [];
}

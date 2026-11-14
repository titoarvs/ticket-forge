import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return ['', '/pricing', '/terms', '/privacy', '/cookies', '/signup'].map((p) => ({ url: `${base}${p}`, changeFrequency: 'monthly' as const }));
}

import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: ['/', '/pricing', '/terms', '/privacy', '/cookies', '/signup', '/login'], disallow: ['/api/', '/p/', '/projects', '/admin', '/new', '/invite/', '/reset/'] }] };
}

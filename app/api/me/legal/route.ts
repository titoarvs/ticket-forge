import { headers } from 'next/headers';
import { api, authed, body, clientIp } from '@/lib/server/http';
import * as auth from '@/lib/auth';

// Accept the current Terms of Use and Privacy Policy (after a change, or for accounts created
// before consent existed).
export const GET = api(async () => auth.legalStatus(await authed()));
export const POST = api(async (req) => {
  const u = await authed();
  const b = await body(req);
  const h = await headers();
  const next = await auth.recordAcceptance(u, {
    accept: b.accept,
    ip: await clientIp(),
    userAgent: h.get('user-agent') || '',
  });
  return { legal: auth.legalStatus(next) };
});

import { headers } from 'next/headers';
import { api, body, startSession, clientIp } from '@/lib/server/http';
import * as auth from '@/lib/auth';

// Public sign-up. What it does depends on SIGNUP_MODE (see lib/auth.ts signup).
export const POST = api(async (req) => {
  const b = await body(req);
  const ip = await clientIp();
  auth.throttle(`signup:${ip}`, 5, 60 * 60000);
  const h = await headers();
  const r = await auth.signup(b, { ip, userAgent: h.get('user-agent') || '' });
  if (r.user) {
    await startSession(r.user.id, r.user.workspace_id);
    return { user: auth.publicUser(r.user) };
  }
  return { requested: true };
});

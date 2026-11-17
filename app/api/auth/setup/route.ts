import { headers } from 'next/headers';
import { api, body, startSession, clientIp } from '@/lib/server/http';
import * as auth from '@/lib/auth';

export const POST = api(async (req) => {
  const h = await headers();
  const u = await auth.createOwner(await body(req), { ip: await clientIp(), userAgent: h.get('user-agent') || '' });
  await startSession(u.id, u.workspace_id);
  return { user: auth.publicUser(u) };
});

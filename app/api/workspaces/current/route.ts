import { cookies } from 'next/headers';
import { api, authed, body, HttpError } from '@/lib/server/http';
import * as auth from '@/lib/auth.js';

// Switch this sign-in to another of your workspaces, or rename the current one (its owner).
export const PUT = api(async (req) => {
  const u: any = await authed();
  const b = await body(req);
  const jar = await cookies();
  await auth.switchWorkspace(jar.get(auth.SESSION_COOKIE)?.value, u, String(b.id || ''));
  return { ok: true };
});
export const PATCH = api(async (req) => {
  const u: any = await authed();
  const b = await body(req);
  if (typeof b.name !== 'string') throw new HttpError(400, 'Nothing to change.');
  await auth.renameWorkspace(u, b.name);
  return { ok: true };
});

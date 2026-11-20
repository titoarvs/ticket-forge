import { api, ownerOnly, body } from '@/lib/server/http';
import * as auth from '@/lib/auth';

export const PATCH = api(async (req, p) => {
  const u = await ownerOnly();
  return auth.updateUser(u, p.id, await body(req));
});
export const DELETE = api(async (_req, p) => {
  const u = await ownerOnly();
  await auth.deleteUser(u, p.id);
  return { ok: true };
});

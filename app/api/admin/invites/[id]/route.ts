import { api, ownerOnly } from '@/lib/server/http';
import * as auth from '@/lib/auth';

export const DELETE = api(async (_req, p) => {
  await ownerOnly();
  await auth.revokeInvite(p.id);
  return { ok: true };
});

import { api, authed } from '@/lib/server/http';
import * as auth from '@/lib/auth';

// Revokes one of your API tokens: programs using it are refused from then on.
export const DELETE = api(async (_req, p) => {
  const user = await authed();
  await auth.revokeApiToken(user, p.id);
  return { ok: true };
});

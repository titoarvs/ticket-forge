import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as auth from '@/lib/auth';

export const PUT = api(async (req, p) => { await perm('users.manage'); return { id: await auth.saveRole({ ...(await body(req)), id: p.id }) }; });
export const DELETE = api(async (req, p) => {
  await perm('users.manage');
  await auth.deleteRole(p.id, new URL(req.url).searchParams.get('replacement') || undefined);
  return { ok: true };
});

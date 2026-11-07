import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as auth from '@/lib/auth.js';

export const POST = api(async (req, p) => {
  const u = await auth.acceptInvite(p.token, await body(req));
  await startSession(u.id);
  return { user: auth.publicUser(u) };
});

import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as auth from '@/lib/auth.js';

export const POST = api(async (req) => {
  const b = await body(req);
  const u = await auth.resetPassword(b.token, b.password);
  await startSession(u.id);
  return { user: auth.publicUser(u) };
});

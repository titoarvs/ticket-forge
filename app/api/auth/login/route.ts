import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as auth from '@/lib/auth.js';

export const POST = api(async (req) => {
  const b = await body(req);
  auth.throttle(`login:${await clientIp()}:${auth.normEmail(b.email)}`);
  const u = await auth.login(b.email, b.password);
  await startSession(u.id, u.workspace_id);
  return { user: auth.publicUser(u) };
});

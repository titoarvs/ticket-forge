import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as auth from '@/lib/auth.js';

export const POST = api(async (req) => {
  const b = await body(req);
  await auth.changePassword(await authed(), b.current, b.next);
  return { ok: true };
});

import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as auth from '@/lib/auth.js';
import { dbInfo } from '@/lib/db.js';

export const GET = api(async (req) => {
  await perm('users.manage');
  return { ...auth.emailConfig(), appUrl: appUrl(req), appUrlSet: Boolean(process.env.APP_URL), database: dbInfo.label };
});

import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as auth from '@/lib/auth.js';
import { dbInfo } from '@/lib/db.js';
import { PERMISSIONS } from '@/lib/permissions.js';
import { currentUser } from '@/lib/server/http';

export const GET = api(async () => ({
  user: auth.publicUser(await currentUser()),
  setupRequired: (await auth.userCount()) === 0,
  permissions: PERMISSIONS,
  emailConfigured: auth.emailConfig().configured,
  database: dbInfo.label,
}));

import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as auth from '@/lib/auth.js';

export const DELETE = api(async (_req, p) => { await perm('users.manage'); await auth.revokeInvite(p.id); return { ok: true }; });

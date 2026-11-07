import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as auth from '@/lib/auth.js';

export const PATCH = api(async (req, p) => { const u = await perm('users.manage'); return auth.updateUser(u, p.id, await body(req)); });
export const DELETE = api(async (_req, p) => { const u = await perm('users.manage'); await auth.deleteUser(u, p.id); return { ok: true }; });

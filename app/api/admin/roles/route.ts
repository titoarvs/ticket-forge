import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as auth from '@/lib/auth';

export const GET = api(async () => { await authed(); return auth.listRoles(); });
export const POST = api(async (req) => { await perm('users.manage'); return { id: await auth.saveRole({ ...(await body(req)), id: undefined }) }; });

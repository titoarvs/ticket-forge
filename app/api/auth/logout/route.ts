import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
export const POST = api(async () => { await endSession(); return { ok: true }; });

import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import { prInfo } from '@/lib/github.js';

export const GET = api(async (req) => { await perm('issue.edit'); return prInfo(new URL(req.url).searchParams.get('url')); });

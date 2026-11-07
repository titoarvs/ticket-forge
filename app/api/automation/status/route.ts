import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import { engineStatus } from '@/lib/automation.js';

export const GET = api(async () => { await authed(); return engineStatus(); });

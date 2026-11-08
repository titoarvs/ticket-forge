import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import { providerStatus } from '@/lib/claude.js';
import { SUPPORTED } from '@/lib/parse.js';
import { dbInfo } from '@/lib/db.js';
import { getRules } from '@/lib/genrules.js';

export const GET = api(async () => { await authed(); const rules = await getRules();
  return { ...(await providerStatus()), supported: SUPPORTED, database: dbInfo.label, generation: { testsPerTicket: rules.tests.perTicket, reasoning: rules.reasoning } }; });

import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import { providerStatus, accountStatus, aiMode } from '@/lib/claude';
import { getAiSettings } from '@/lib/settings';
import { SUPPORTED } from '@/lib/parse';
import { dbInfo } from '@/lib/db';
import { getRules } from '@/lib/genrules';

// ?fresh=1 (the Refresh button): skip the caches, so the Claude sign-in and the AI settings are checked again now.
export const GET = api(async (req: Request) => {
  await authed();
  const fresh = Boolean(new URL(req.url).searchParams.get('fresh'));
  if (fresh) { await getAiSettings({ fresh: true }).catch(() => {}); if (aiMode() === 'account') await accountStatus({ fresh: true }).catch(() => {}); }
  const rules = await getRules();
  return { ...(await providerStatus({ planFresh: fresh })), supported: SUPPORTED, database: dbInfo.label, generation: { testsPerTicket: rules.tests.perTicket, reasoning: rules.reasoning } }; });

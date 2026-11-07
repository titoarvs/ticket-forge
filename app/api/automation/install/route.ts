import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import { installBrowser } from '@/lib/automation.js';

export const POST = api(async (req) => {
  await perm('users.manage');
  return ndjson(req, async (send) => {
    await installBrowser((line: string) => send({ type: 'log', line }));
    send({ type: 'done' });
  });
});

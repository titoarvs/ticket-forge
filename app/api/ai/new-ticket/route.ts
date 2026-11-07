import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import { newTicket } from '@/lib/generate.js';
import * as store from '@/lib/store.js';

export const POST = api(async (req) => {
  const u = await perm('ai.use');
  const b = await body(req);
  if (b.project?.id) store.requireAccess(u, b.project.id);
  return newTicket({ epicId: b.epicId, project: b.project, idea: b.idea, ai: aiOpts(b) });
});

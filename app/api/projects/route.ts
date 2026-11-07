import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as auth from '@/lib/auth.js';
import * as store from '@/lib/store.js';

export const GET = api(async () => store.listProjects(await authed()));
export const POST = api(async (req) => {
  const user = await perm('project.create');
  const p = await body(req);
  if (!p || !Array.isArray(p.tickets) || !Array.isArray(p.epics)) throw new HttpError(400, 'Not a TicketForge project');
  p.id = p.id && /^[\w-]{1,64}$/.test(p.id) ? p.id : auth.newId().slice(0, 8);
  return store.createProject(p, user);
});

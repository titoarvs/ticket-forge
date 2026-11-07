import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store.js';

export const GET = api(async (_req, p) => { store.requireAccess(await authed(), p.id); return store.getProject(p.id); });
export const PATCH = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  return store.patchProject(p.id, await body(req), user);
});
export const DELETE = api(async (_req, p) => {
  const user = await perm('project.delete');
  store.requireAccess(user, p.id);
  await store.deleteProject(p.id);
  return { ok: true };
});

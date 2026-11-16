import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import * as auth from '@/lib/auth.js';

// The whole project, shared between everyone opening the same version (see store.projectJson).
// ?gz=1: the same JSON gzipped, as a file the browser unpacks (a big project is ~30× smaller on the wire).
export const GET = api(async (req, p) => {
  store.requireAccess(await authed(), p.id);
  const gz = new URL(req.url).searchParams.get('gz') === '1';
  const e = await store.projectJson(p.id, { gzip: gz });
  const headers = { 'Cache-Control': 'private, no-cache', 'X-Project-Version': String(e.version) };
  if (gz) return new Response(new Uint8Array(e.gz), { headers: { ...headers, 'Content-Type': 'application/octet-stream' } });
  return new Response(e.body, { headers: { ...headers, 'Content-Type': 'application/json' } });
});
export const PATCH = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  return store.patchProject(p.id, await body(req), user);
});
// Soft delete (archive): only the creator and owners, and only with their password ({ password } in the body).
export const DELETE = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  auth.throttle(`project-delete:${user.id}`); // the password is checked here, so guessing it is slowed down
  const b = await body(req);
  await store.deleteProject(p.id, user, b.password);
  return { ok: true };
});

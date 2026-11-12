import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store.js';

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
export const DELETE = api(async (_req, p) => {
  const user = await perm('project.delete');
  store.requireAccess(user, p.id);
  await store.deleteProject(p.id);
  return { ok: true };
});

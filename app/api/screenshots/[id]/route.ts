import { api, authed, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { getShot } from '@/lib/shots';

// A failed test's screenshot, stored in the database. Only people with access to its project can open it.
export const GET = api(async (_req, p) => {
  const user = await authed();
  if (!/^[a-f0-9]{8,32}$/.test(p.id)) throw new HttpError(404, 'Not found');
  const shot = await getShot(p.id);
  if (!shot) throw new HttpError(404, 'Screenshot not found');
  await store.requireProject(user, shot.project_id);
  return new Response(shot.data, { headers: { 'Content-Type': shot.mime, 'Cache-Control': 'private, max-age=86400, immutable' } });
});

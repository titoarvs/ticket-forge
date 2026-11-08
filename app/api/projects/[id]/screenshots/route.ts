import { api, authed } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { listShots } from '@/lib/shots.js';

// Earlier failure screenshots for a project (optionally one test case: ?tc=<id>), newest first.
export const GET = api(async (req, p) => {
  store.requireAccess(await authed(), p.id);
  return listShots(p.id, new URL(req.url).searchParams.get('tc'));
});

import { api, authed } from '@/lib/server/http';
import * as store from '@/lib/store';

// The project timeline's server-side entries (sprints, epics, releases, settings, test management,
// deleted issues). ?before=<ISO time> pages back. Issue changes come from each issue's own history
// in the browser.
export const GET = api(async (req, p) => {
  store.requireAccess(await authed(), p.id);
  const sp = new URL(req.url).searchParams;
  return {
    items: await store.listActivity(p.id, {
      before: sp.get('before'),
      limit: Number(sp.get('limit')) || 300,
    }),
  };
});

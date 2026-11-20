import { api, authed } from '@/lib/server/http';
import * as store from '@/lib/store';

// What changed since ?since=<version>: the issues and sections saved after it, deleted issue ids
// and (when it changed) the issue order. Browsers poll /version and then ask for this instead of
// downloading the whole project.
export const GET = api(async (req, p) => {
  store.requireAccess(await authed(), p.id);
  return store.projectChanges(p.id, new URL(req.url).searchParams.get('since'));
});

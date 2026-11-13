import { api, authed } from '@/lib/server/http';
import * as store from '@/lib/store.js';

// Restore an issue to one of its versions. Admins and managers only (issue.restore): anyone else gets 403 and
// the issue is left as it is.
export const POST = api(async (_req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  store.requirePerm(user, 'issue.restore');
  return store.restoreVersion(p.id, p.issueId, p.number, user);
});

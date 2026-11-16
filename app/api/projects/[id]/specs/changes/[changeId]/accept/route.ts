import { api, authed } from '@/lib/server/http';
import * as store from '@/lib/store.js';

// Mark AI-produced changes accepted. Refused (409) until a required reviewer has approved them.
export const POST = api(async (_req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  store.requirePerm(user, 'issue.edit');
  return store.acceptSpecChange(p.id, p.changeId, user);
});

import { api, authed, body } from '@/lib/server/http';
import * as store from '@/lib/store';

// Link AI-produced changes (a branch, pull request or commit) to a ready spec. They stay pending until a required
// reviewer approves them.
export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  store.requirePerm(user, 'issue.edit');
  const b = await body(req);
  return store.linkSpecChange(p.id, b.ticketId, { ref: b.ref, summary: b.summary }, user);
});

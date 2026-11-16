import { api, authed, body } from '@/lib/server/http';
import * as store from '@/lib/store.js';

// Mark specs ready for coding. With an overlap (same file or module as another spec) the project's setting decides:
// blocking answers 409 naming the tickets and files; warning marks them ready and returns the overlaps as `warnings`.
export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  store.requirePerm(user, 'issue.edit');
  const b = await body(req);
  return store.markSpecsReady(p.id, b.ticketIds, user);
});

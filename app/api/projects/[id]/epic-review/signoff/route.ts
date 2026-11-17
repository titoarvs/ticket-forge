import { api, authed, body } from '@/lib/server/http';
import * as store from '@/lib/store';
import * as review from '@/lib/epic-review';

// The epic owner (epic.manage) records the final sign-off ({ epicId }). Refused (409) until all three documents are approved.
export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  const b = await body(req);
  return review.signOff(p.id, String(b.epicId || ''), user);
});

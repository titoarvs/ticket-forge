import { api, authed, body } from '@/lib/server/http';
import * as store from '@/lib/store';
import * as review from '@/lib/epic-review';

// A reviewer listed on the epic approves the current version of a document or requests changes ({ epicId, kind, decision }).
// Anyone else gets 403. The document is approved when every listed reviewer has approved it.
export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  const b = await body(req);
  return review.decide(p.id, String(b.epicId || ''), b.kind, b.decision, user);
});

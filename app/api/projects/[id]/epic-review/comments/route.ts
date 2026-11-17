import { api, authed, body } from '@/lib/server/http';
import * as store from '@/lib/store';
import * as review from '@/lib/epic-review';

// Add a comment to a document of the epic ({ epicId, kind, body }). Reviewers listed on the epic and the epic owner can comment.
export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  const b = await body(req);
  return review.addComment(p.id, String(b.epicId || ''), b.kind, b.body, user);
});

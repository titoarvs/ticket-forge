import { api, perm, body } from '@/lib/server/http';
import * as store from '@/lib/store';
import { notifyDraft } from '@/lib/epic-drafts';

// Tells the creator and the project owner that an AI epic draft was saved or published (body: epicId and event, "saved"
// or "published"). The draft itself is saved with the project like any epic change; this checks it was saved and
// sends the in-app notification.
export const POST = api(async (req, p) => {
  const user = await perm('epic.manage');
  store.requireAccess(user, p.id);
  const b = await body(req);
  return notifyDraft(p.id, String(b.epicId || ''), String(b.event || ''), user);
});

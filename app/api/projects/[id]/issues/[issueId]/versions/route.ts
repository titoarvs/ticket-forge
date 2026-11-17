import { api, authed } from '@/lib/server/http';
import * as store from '@/lib/store';

// An issue's versions (saved on every status change and every restore), newest first. Everyone with access to
// the project can see them; `canRestore` tells the browser whether to offer Restore.
export const GET = api(async (_req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  return { versions: await store.listVersions(p.id, p.issueId), canRestore: store.has(user, 'issue.restore') };
});

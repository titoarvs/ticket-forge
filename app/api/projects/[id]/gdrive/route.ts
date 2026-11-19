import { api, authed } from '@/lib/server/http';
import * as store from '@/lib/store';
import { documentStates } from '@/lib/gdrive';

// The Google Drive save state (saved, queued, failed) of each document of an epic (?epicId=).
// Everyone with access to the project sees it.
export const GET = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  const epicId = new URL(req.url).searchParams.get('epicId') || '';
  return { documents: await documentStates(p.id, epicId, user) };
});

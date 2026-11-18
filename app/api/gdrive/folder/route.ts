import { api, authed, body, HttpError } from '@/lib/server/http';
import { selectFolder } from '@/lib/gdrive';

// Selects the one folder documents are saved to: PUT { folder: <Drive folder link or id> }. Refused (409) until Google
// Drive is connected. Only that folder is stored; nothing else in Drive is browsed.
export const PUT = api(async (req) => {
  const user: any = await authed();
  if (!user.is_owner) throw new HttpError(403, 'Only the Super Admin can select the Google Drive folder.');
  const b = await body(req);
  return selectFolder(user, b.folder);
});

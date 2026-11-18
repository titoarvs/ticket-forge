import { api, authed, HttpError } from '@/lib/server/http';
import { listFolder } from '@/lib/gdrive';

// The latest files in the selected Drive folder (Super Admin only). It never lists anything outside that folder.
export const GET = api(async () => {
  const user: any = await authed();
  if (!user.is_owner) throw new HttpError(403, 'Only the Super Admin can see the Google Drive folder.');
  return { files: await listFolder() };
});

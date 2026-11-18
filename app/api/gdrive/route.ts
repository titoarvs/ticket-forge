import { api, authed, HttpError } from '@/lib/server/http';
import * as drive from '@/lib/gdrive';

// The workspace's shared Google Drive (Administration → Google Drive, behind the "gdrive" feature flag).
// GET: the connection status and the selected folder (everyone signed in; the connected account is shown to the owner only).
// DELETE: disconnect (owner only). The tokens never leave the server.
export const GET = api(async () => {
  const user: any = await authed();
  const s = await drive.status();
  return user.is_owner ? s : { ...s, account: null, connectedBy: null };
});

export const DELETE = api(async () => {
  const user: any = await authed();
  if (!user.is_owner) throw new HttpError(403, 'Only the Super Admin can disconnect Google Drive.');
  return drive.disconnect();
});

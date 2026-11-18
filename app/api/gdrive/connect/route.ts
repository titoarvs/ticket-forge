import { api, authed, appUrl, HttpError } from '@/lib/server/http';
import { authorizeUrl } from '@/lib/gdrive';

// Starts connecting Google Drive: returns the Google sign-in address to send the Super Admin to. Google sends them back
// to /api/gdrive/callback.
export const POST = api(async (req) => {
  const user: any = await authed();
  if (!user.is_owner) throw new HttpError(403, 'Only the Super Admin can connect Google Drive.');
  return { url: authorizeUrl(user, `${appUrl(req)}/api/gdrive/callback`) };
});

import { api, authed, appUrl, HttpError } from '@/lib/server/http';
import { completeConnect } from '@/lib/gdrive';

// Google sends the Super Admin back here after they approve (or refuse) access. The tokens are kept on the server; the
// browser only goes back to the admin setting with the result.
export const GET = api(async (req) => {
  const user: any = await authed();
  if (!user.is_owner) throw new HttpError(403, 'Only the Super Admin can connect Google Drive.');
  const u = new URL(req.url);
  const back = (q: string) => Response.redirect(`${appUrl(req)}/admin/gdrive?${q}`, 303);
  if (u.searchParams.get('error'))
    return back(`gdrive=${encodeURIComponent(u.searchParams.get('error') === 'access_denied' ? 'denied' : 'failed')}`);
  try {
    await completeConnect(
      user,
      { code: u.searchParams.get('code') || '', state: u.searchParams.get('state') || '' },
      `${appUrl(req)}/api/gdrive/callback`,
    );
    return back('gdrive=connected');
  } catch (e: any) {
    return back(`gdrive=failed&message=${encodeURIComponent(String(e.message || '').slice(0, 200))}`);
  }
});

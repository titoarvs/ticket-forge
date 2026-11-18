import { api, ownerOnly, body, HttpError } from '@/lib/server/http';
import * as auth from '@/lib/auth';
import { DEFAULT_WS } from '@/lib/db';
import { platformAdminEmails } from '@/lib/platform';

// People who asked for an account while sign-up is a waitlist. Only whoever runs this TicketForge sees them: the owner
// of the default workspace, or a platform admin (PLATFORM_ADMIN_EMAILS). Owners of other workspaces don't.
async function runsThePlatform() {
  const u: any = await ownerOnly();
  if (u.workspace_id !== DEFAULT_WS && !platformAdminEmails().includes(String(u.email).toLowerCase()))
    throw new HttpError(403, 'Only the people who run this TicketForge can see sign-up requests.');
  return u;
}
export const GET = api(async () => {
  await runsThePlatform();
  return { requests: await auth.listSignupRequests() };
});
export const PUT = api(async (req) => {
  await runsThePlatform();
  const b = await body(req);
  await auth.setSignupRequest(String(b.id || ''), String(b.status || ''));
  return { ok: true };
});

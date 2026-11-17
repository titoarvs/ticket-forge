import { api, authed, ownerOnly, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as auth from '@/lib/auth';
import { sendInviteEmail } from '@/lib/server/invite-mail';

export const GET = api(async () => { await ownerOnly(); return auth.listInvites(); });
export const POST = api(async (req) => {
  const actor = await ownerOnly();
  const b = await body(req);
  const created = await auth.createInvites(actor, b);
  const results = [];
  for (const inv of created) results.push(inv.error ? { email: inv.email, error: inv.error } : await sendInviteEmail(req, actor, inv, b.message));
  return { results, emailConfigured: auth.emailConfig().configured };
});

import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as auth from '@/lib/auth';

export const POST = api(async (req) => {
  const u = await perm('users.manage');
  const mail = auth.emailLayout({ heading: 'Email is working', intro: `Hi ${u.name},\n\nThis is a test email from TicketForge. Invites and password resets will be delivered like this.`, button: 'Open TicketForge', url: appUrl(req), note: 'Sent from Administration → Email.' });
  const r = await auth.sendMail({ to: u.email, subject: 'TicketForge test email', ...mail });
  if (!r.sent) throw new HttpError(400, `Could not send: ${r.reason}`);
  return { ok: true, to: u.email };
});

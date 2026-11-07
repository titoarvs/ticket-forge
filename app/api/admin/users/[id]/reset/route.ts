import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as auth from '@/lib/auth.js';

export const POST = api(async (req, p) => {
  const actor = await perm('users.manage');
  const u = await auth.getUser(p.id);
  if (!u) throw new HttpError(404, 'User not found');
  const t = await auth.createReset(u.id);
  const link = `${appUrl(req)}/reset/${t}`;
  const mail = auth.emailLayout({ heading: 'Set a new password', intro: `Hi ${u.name},\n\n${actor.name} sent you a link to set a new TicketForge password.`, button: 'Choose a new password', url: link, note: 'This link works once and expires in 2 hours.' });
  const sent = await auth.sendMail({ to: u.email, subject: 'Set a new TicketForge password', ...mail });
  return { link, emailed: sent.sent, emailError: sent.sent ? undefined : sent.reason };
});

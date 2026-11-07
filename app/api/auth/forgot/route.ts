import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as auth from '@/lib/auth.js';

export const POST = api(async (req) => {
  const b = await body(req);
  auth.throttle(`forgot:${await clientIp()}`, 5);
  const u = await auth.userByEmail(b.email);
  if (u && u.status === 'active') {
    const t = await auth.createReset(u.id);
    const url = `${appUrl(req)}/reset/${t}`;
    const mail = auth.emailLayout({ heading: 'Reset your password', intro: `Hi ${u.name},\n\nSomeone asked to reset the password for your TicketForge account (${u.email}).`, button: 'Choose a new password', url, note: 'This link works once and expires in 2 hours. If you did not ask for this, you can ignore this email.' });
    await auth.sendMail({ to: u.email, subject: 'Reset your TicketForge password', ...mail });
  }
  return { ok: true, emailConfigured: auth.emailConfig().configured };
});

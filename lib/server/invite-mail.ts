import * as auth from '@/lib/auth.js';
import { appUrl } from '@/lib/server/http';

export async function sendInviteEmail(req: Request, actor: any, inv: any, message = '') {
  const link = `${appUrl(req)}/invite/${inv.token}`;
  const note = message ? `\n\n“${String(message).slice(0, 1000)}”` : '';
  const mail = auth.emailLayout({
    heading: `${actor.name} invited you to TicketForge`,
    intro: `You've been invited to join TicketForge, where your team plans epics, issues, sprints and tests.${note}`,
    button: 'Accept invite', url: link, note: 'This invite link works once and expires in 7 days.',
  });
  const sent = await auth.sendMail({ to: inv.email, subject: `${actor.name} invited you to TicketForge`, ...mail });
  await auth.markEmailed(inv.id, sent.sent);
  return { email: inv.email, link, emailed: sent.sent, emailError: sent.sent ? undefined : sent.reason };
}

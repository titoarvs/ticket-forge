import { api, ownerOnly } from '@/lib/server/http';
import * as auth from '@/lib/auth';
import { sendInviteEmail } from '@/lib/server/invite-mail';

export const POST = api(async (req, p) => {
  const actor = await ownerOnly();
  return sendInviteEmail(req, actor, await auth.reissueInvite(p.id));
});

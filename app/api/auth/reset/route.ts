import { api, body, HttpError, startSession } from '@/lib/server/http';
import * as auth from '@/lib/auth.js';

export const POST = api(async (req) => {
  const b = await body(req);
  const u = await auth.resetPassword(b.token, b.password);
  if (!u) throw new HttpError(403, 'Your password is changed, but your account isn’t part of any workspace right now. Ask a workspace owner to invite you again.');
  await startSession(u.id, u.workspace_id);
  return { user: auth.publicUser(u) };
});

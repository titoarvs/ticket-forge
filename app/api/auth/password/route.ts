import { api, authed, body } from '@/lib/server/http';
import * as auth from '@/lib/auth';

export const POST = api(async (req) => {
  const b = await body(req);
  await auth.changePassword(await authed(), b.current, b.next);
  return { ok: true };
});

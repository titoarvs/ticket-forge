import { api, authed, body } from '@/lib/server/http';
import { markRead } from '@/lib/notify';

export const POST = api(async (req) => {
  const u = await authed();
  await markRead(u.id, (await body(req)).ids);
  return { ok: true };
});

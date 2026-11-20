import { api, authed, body } from '@/lib/server/http';
import { getPrefs, savePrefs } from '@/lib/prefs';

// Your own preferences (guided tours finished or skipped).
export const GET = api(async () => {
  await authed();
  return getPrefs();
});
export const PUT = api(async (req) => {
  await authed();
  return savePrefs(await body(req));
});

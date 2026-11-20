import { api, authed } from '@/lib/server/http';
import * as store from '@/lib/store';

export const GET = api(async (_req, p) => {
  store.requireAccess(await authed(), p.id);
  return { version: await store.projectVersion(p.id) };
});

import { api, authed, perm, body, HttpError, startSession, endSession, clientIp, appUrl, aiOpts, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store.js';

export const GET = api(async () => {
  await perm('users.manage');
  return (await store.listProjects({ is_owner: true })).map(({ id, name, key }: any) => ({ id, name, key }));
});

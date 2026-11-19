import { api, perm } from '@/lib/server/http';
import * as store from '@/lib/store';

export const GET = api(async () => {
  const u: any = await perm('users.manage');
  return (await store.listProjects({ ...u, is_owner: true })).map(({ id, name, key }: any) => ({
    id,
    name,
    key,
  }));
});

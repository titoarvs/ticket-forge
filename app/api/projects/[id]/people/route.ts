import { api, authed } from '@/lib/server/http';
import * as auth from '@/lib/auth';
import * as store from '@/lib/store';

export const GET = api(async (_req, p) => {
  store.requireAccess(await authed(), p.id);
  const users = (await auth.listUsers()).filter(
    (u: any) =>
      u.status === 'active' &&
      store.canAccess({ is_owner: u.isOwner, project_access: u.projectAccess }, p.id),
  );
  return users.map((u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.roleName }));
});

import { api, authed, perm, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { credentialStatus, setRolePassword } from '@/lib/secrets.js';

// Passwords for the roles in this project's App setup. They're never sent back: only whether one is saved.
export const GET = api(async (_req, p) => {
  store.requireAccess(await authed(), p.id);
  return credentialStatus(p.id);
});

// { roleId, password } saves (or replaces) a role's password; an empty password removes it.
export const PUT = api(async (req, p) => {
  const user = await perm('project.settings');
  store.requireAccess(user, p.id);
  const b = await body(req);
  const roleId = String(b.roleId || '');
  if (!/^[\w-]{1,64}$/.test(roleId)) throw new HttpError(400, 'Which role?');
  const password = String(b.password ?? '');
  if (password.length > 500) throw new HttpError(400, 'That password is too long.');
  await setRolePassword(p.id, roleId, password, user);
  return credentialStatus(p.id);
});

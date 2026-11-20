import { api, authed, perm, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { credentialStatus, setRoleSecret, clearRoleSecrets } from '@/lib/secrets';
import { checkTotp } from '@/lib/totp.mjs';

// Secrets for the roles in this project's App setup: passwords, authenticator (MFA) secrets and
// saved sessions.
// They're never sent back: only whether one is saved.
export const GET = api(async (_req, p) => {
  store.requireAccess(await authed(), p.id);
  return credentialStatus(p.id);
});

// { roleId, password } · { roleId, totp } · { roleId, session: '' } (forget the session) · {
// roleId, clearAll: true } An empty value removes that secret.
export const PUT = api(async (req, p) => {
  const user = await perm('project.settings');
  store.requireAccess(user, p.id);
  const b = await body(req);
  const roleId = String(b.roleId || '');
  if (!/^[\w-]{1,64}$/.test(roleId)) throw new HttpError(400, 'Which role?');
  if (b.clearAll) {
    await clearRoleSecrets(p.id, roleId);
    return credentialStatus(p.id);
  }
  if ('totp' in b) {
    const t = String(b.totp ?? '').trim();
    if (t.length > 600) throw new HttpError(400, 'That secret is too long.');
    if (t) {
      try {
        checkTotp(t);
      } catch (e: any) {
        throw new HttpError(400, e.message);
      }
    }
    await setRoleSecret(p.id, roleId, 'totp', t, user);
    return credentialStatus(p.id);
  }
  if ('session' in b) {
    await setRoleSecret(p.id, roleId, 'session', '', user);
    return credentialStatus(p.id);
  }
  const password = String(b.password ?? '');
  if (password.length > 500) throw new HttpError(400, 'That password is too long.');
  await setRoleSecret(p.id, roleId, 'password', password, user);
  return credentialStatus(p.id);
});

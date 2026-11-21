import { api, authed, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store';
import { setProjectSecret } from '@/lib/secrets';
import {
  getClientId,
  saveClientId,
  startDeviceLogin,
  pollDeviceLogin,
  whoAmI,
} from '@/lib/github-connect';
import {
  NEEDS_REPO_PERM,
  githubSettings,
  accessibleRepos,
  saveRepoLink,
  recordConnection,
  forgetConnection,
} from '@/lib/github-link';

// Project settings → Code & GitHub → GitHub connection and repository (TF-142). GET: the connection
// status (checked with GitHub now) and the linked repository. POST actions: ghClientId,
// ghConnectStart, ghConnectPoll (Connect GitHub), saveToken, disconnect, repos (the repositories the
// connection can access) and saveRepo ({ repo } or { repo: '' } to clear). All of it needs the Code &
// GitHub permission (project.repo); the token is never sent back.
export const GET = api(async (_req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  const s = await githubSettings(user, p.id);
  const client = await getClientId();
  return { ...s, githubConnect: { configured: Boolean(client.clientId) } };
});

export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  if (!store.has(user, 'project.repo')) throw new HttpError(403, NEEDS_REPO_PERM);
  const b = await body(req);
  if (b.action === 'ghClientId') {
    if (!store.has(user, 'users.manage'))
      throw new HttpError(403, 'Only an administrator can set the GitHub OAuth App.');
    const r = await saveClientId(String(b.clientId || ''));
    return { configured: Boolean(r.clientId), source: r.source };
  }
  if (b.action === 'ghConnectStart') return startDeviceLogin(p.id);
  if (b.action === 'ghConnectPoll') {
    const r: any = await pollDeviceLogin(String(b.id || ''), p.id);
    if (r.state !== 'done') return r;
    await setProjectSecret(p.id, 'githubToken', r.token, user);
    await recordConnection(p.id, user, { account: r.account, scopes: r.scopes });
    return { state: 'done', account: r.account, scopes: r.scopes };
  }
  if (b.action === 'saveToken') {
    const token = String(b.token || '').trim();
    if (!/^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(token))
      throw new HttpError(
        400,
        'That doesn’t look like a GitHub token (they start with ghp_, github_pat_ …).',
      );
    const account = await whoAmI(token).catch((e: any) => {
      throw new HttpError(400, `Couldn’t connect GitHub: ${e.message}`);
    });
    await setProjectSecret(p.id, 'githubToken', token, user);
    await recordConnection(p.id, user, { account });
    return { ok: true };
  }
  if (b.action === 'disconnect') {
    await setProjectSecret(p.id, 'githubToken', '', user);
    await forgetConnection(p.id);
    return { ok: true };
  }
  if (b.action === 'repos') return { repos: await accessibleRepos(user, p.id, String(b.q || '')) };
  if (b.action === 'saveRepo') return saveRepoLink(user, p.id, String(b.repo ?? ''));
  throw new HttpError(400, 'Unknown action');
});

import { api, authed, body, HttpError } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { SERVERLESS, currentContext } from '@/lib/db.js';
import { inspectRepo, githubToken, listFolders } from '@/lib/devagent.js';
import { setProjectSecret, getProjectSecret, hasProjectSecret } from '@/lib/secrets.js';

// Project settings → Code & GitHub: checks the local repository folder and keeps the project's GitHub token.
const localOnly = () => !SERVERLESS && Boolean((currentContext() as any).local);

export const GET = api(async (_req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  const saved = await getProjectSecret(p.id, 'githubToken');
  return { local: localOnly(), hasGitlabToken: await hasProjectSecret(p.id, 'gitlabToken'), envGitlabToken: Boolean(process.env.GITLAB_TOKEN), hasToken: await hasProjectSecret(p.id, 'githubToken'), ghSignedIn: !saved && !process.env.GITHUB_TOKEN ? Boolean(await githubToken('')) : false, envToken: Boolean(process.env.GITHUB_TOKEN) };
});

export const POST = api(async (req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  if (!store.has(user, 'project.settings')) throw new HttpError(403, 'Changing Code & GitHub needs the project settings permission.');
  const b = await body(req);
  if (b.action === 'inspect') {
    if (!localOnly()) throw new HttpError(400, 'Local repositories work only when TicketForge runs on your computer (opened at localhost).');
    return inspectRepo(String(b.localPath || ''));
  }
  if (b.action === 'browse') {
    if (!localOnly()) throw new HttpError(400, 'Browsing folders works only when TicketForge runs on your computer (opened at localhost).');
    return listFolders(String(b.path || ''));
  }
  if (b.action === 'saveToken') {
    const token = String(b.token || '').trim();
    if (!/^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(token)) throw new HttpError(400, 'That doesn’t look like a GitHub token (they start with ghp_, github_pat_ …).');
    await setProjectSecret(p.id, 'githubToken', token, user);
    return { hasToken: true };
  }
  if (b.action === 'saveGitlabToken') {
    const token = String(b.token || '').trim();
    if (!/^[\w.-]{20,200}$/.test(token)) throw new HttpError(400, 'That doesn’t look like a GitLab access token (they usually start with glpat-).');
    await setProjectSecret(p.id, 'gitlabToken', token, user);
    return { hasGitlabToken: true };
  }
  if (b.action === 'clearGitlabToken') { await setProjectSecret(p.id, 'gitlabToken', '', user); return { hasGitlabToken: false }; }
  if (b.action === 'clearToken') { await setProjectSecret(p.id, 'githubToken', '', user); return { hasToken: false }; }
  throw new HttpError(400, 'Unknown action');
});

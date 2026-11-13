import { api, authed, body, HttpError, ndjson } from '@/lib/server/http';
import * as store from '@/lib/store.js';
import { SERVERLESS, currentContext } from '@/lib/db.js';
import { inspectRepo, githubToken, listFolders, learnRepo, cloneRepo } from '@/lib/devagent.js';
import { setProjectSecret, getProjectSecret, hasProjectSecret } from '@/lib/secrets.js';
import { codeRabbitStatus } from '@/lib/coderabbit.js';
import { getClientId, saveClientId, startDeviceLogin, pollDeviceLogin, listRepos } from '@/lib/github-connect.js';

// Project settings → Code & GitHub: checks the local repository folder and keeps the project's GitHub token.
const localOnly = () => !SERVERLESS && Boolean((currentContext() as any).local);

export const GET = api(async (_req, p) => {
  const user = await authed();
  store.requireAccess(user, p.id);
  const saved = await getProjectSecret(p.id, 'githubToken');
  return { local: localOnly(), hasGitlabToken: await hasProjectSecret(p.id, 'gitlabToken'), envGitlabToken: Boolean(process.env.GITLAB_TOKEN), hasToken: await hasProjectSecret(p.id, 'githubToken'), ghSignedIn: !saved && !process.env.GITHUB_TOKEN ? Boolean(await githubToken('')) : false, envToken: Boolean(process.env.GITHUB_TOKEN),
    githubConnect: { configured: Boolean((await getClientId()).clientId), source: (await getClientId()).source },
    coderabbit: localOnly() ? { ...(await codeRabbitStatus({ fresh: new URL(_req.url).searchParams.has('fresh') })), bin: undefined, hasKey: await hasProjectSecret(p.id, 'coderabbitKey') } : null };
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
  // Connect GitHub (device sign-in) and the repository picker.
  if (b.action === 'ghClientId') {
    if (!store.has(user, 'users.manage')) throw new HttpError(403, 'Only an administrator can set the GitHub OAuth App.');
    const r = await saveClientId(String(b.clientId || ''));
    return { configured: Boolean(r.clientId), source: r.source };
  }
  if (b.action === 'ghConnectStart') return startDeviceLogin(p.id);
  if (b.action === 'ghConnectPoll') {
    const r: any = await pollDeviceLogin(String(b.id || ''), p.id);
    if (r.state !== 'done') return r;
    await setProjectSecret(p.id, 'githubToken', r.token, user);
    return { state: 'done', account: r.account, scopes: r.scopes };
  }
  if (b.action === 'ghRepos') return { repos: await listRepos((await getProjectSecret(p.id, 'githubToken')) || process.env.GITHUB_TOKEN || '', { q: String(b.q || '') }) };
  // Clone from Git: TicketForge clones the repository into its data folder (or updates its clone) and uses it.
  if (b.action === 'clone') {
    if (!localOnly()) throw new HttpError(400, 'Cloning works only when TicketForge runs on your computer (opened at localhost).');
    const side = b.side === 'backend' ? 'backend' : 'frontend';
    const [token, gitlabToken] = await Promise.all([getProjectSecret(p.id, 'githubToken'), getProjectSecret(p.id, 'gitlabToken')]);
    return ndjson(req, async (send) => {
      try {
        const r = await cloneRepo({ projectId: p.id, side, source: String(b.source || ''), branch: String(b.branch || '').trim(), token: token || process.env.GITHUB_TOKEN || '', gitlabToken: gitlabToken || process.env.GITLAB_TOKEN || '', onStep: (text: string) => send({ type: 'step', text }) });
        send({ type: 'repo', ...r });
      } catch (e: any) { send({ type: 'error', message: e.message }); }
    });
  }
  // Learn from repository: a read-only Claude Code agent writes the Repository Profile (streamed: steps, then the profile).
  if (b.action === 'learn') {
    if (!localOnly()) throw new HttpError(400, 'Learning a repository works only when TicketForge runs on your computer (opened at localhost).');
    if (!store.has(user, 'ai.use')) throw new HttpError(403, 'Learning a repository uses AI, which your role doesn’t allow (ai.use).');
    const project: any = await store.getProject(p.id);
    const dev = b.side === 'backend' ? project.devBackend : project.dev;
    if (!dev?.localPath) throw new HttpError(400, 'Set the repository folder first.');
    return ndjson(req, async (send, signal) => {
      try {
        const r = await learnRepo({ localPath: dev.localPath, signal, onStep: (text: string) => send({ type: 'step', text }) });
        send({ type: 'profile', ...r, learnedAt: new Date().toISOString() });
      } catch (e: any) { send({ type: 'error', message: e.message }); }
    });
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
  if (b.action === 'saveCoderabbitKey') {
    const key = String(b.key || '').trim();
    if (!/^[\w.-]{16,300}$/.test(key)) throw new HttpError(400, 'That doesn’t look like a CodeRabbit API key (Agentic API keys usually start with cr-).');
    await setProjectSecret(p.id, 'coderabbitKey', key, user);
    return { hasKey: true };
  }
  if (b.action === 'clearCoderabbitKey') { await setProjectSecret(p.id, 'coderabbitKey', '', user); return { hasKey: false }; }
  if (b.action === 'clearToken') { await setProjectSecret(p.id, 'githubToken', '', user); return { hasToken: false }; }
  throw new HttpError(400, 'Unknown action');
});

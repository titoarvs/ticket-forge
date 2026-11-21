// TF-142: Project settings → Code & GitHub → GitHub connection and repository: the status of the
// project's GitHub connection and the repository linked to the project, kept in two tables
// (github_connections and github_repo_links in lib/db/schema.ts) so they survive a reload.
// - Who: people whose custom role has the Code & GitHub permission (project.repo), for seeing and for
//   changing. The server checks it (and row-level security does too); the UI only hides the card.
// - Connection: the GitHub sign-in the project already uses (its saved token, else GITHUB_TOKEN). The
//   token stays encrypted in the project's secrets and is never stored in these tables or sent to
//   the browser. Each time the tab opens the sign-in is checked against GitHub: status 'connected',
//   'not_connected' (no sign-in) or 'error' (GitHub refused it, it was revoked, or it didn't answer).
// - Repository: chosen from the repositories the connection can access. An error never touches the
//   saved choice, so it is still there once GitHub works again. Clearing it leaves the project
//   with no repository.
import { q, asSystem } from './db';
import { HttpError } from './auth';
import { has } from './store';
import { getProjectSecret } from './secrets';
import { whoAmI, listRepos } from './github-connect';

export const NEEDS_REPO_PERM =
  'Connecting GitHub and choosing the repository needs the Set up the repository permission (Code & GitHub).';
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

const needPerm = (user: any) => {
  if (!has(user, 'project.repo')) throw new HttpError(403, NEEDS_REPO_PERM);
};
/** The token the project uses for GitHub and where it comes from, or no token. */
async function tokenOf(projectId: string) {
  const saved = await getProjectSecret(projectId, 'githubToken');
  if (saved) return { token: saved, source: 'project' as const };
  if (process.env.GITHUB_TOKEN) return { token: process.env.GITHUB_TOKEN, source: 'workspace' as const };
  return { token: '', source: '' as const };
}
/** A GitHub request that can't even reach GitHub is a readable error. */
const message = (e: any) => (e?.status ? String(e.message) : 'GitHub didn’t respond. Try again.');

const accountOf = (r: any) =>
  r?.account_login
    ? { login: r.account_login, name: r.account_name, avatar: r.account_avatar, scopes: r.scopes }
    : null;
const iso = (d: any) => (d ? new Date(d).toISOString() : null);

/** The repository linked to the project: { fullName, defaultBranch, url, private, selectedAt } or null. */
export async function readRepoLink(projectId: string) {
  const r = (await q('select * from github_repo_links where project_id = $1', [projectId])).rows[0];
  if (!r || !r.repo_full_name) return null;
  return {
    fullName: r.repo_full_name as string,
    defaultBranch: r.default_branch as string,
    url: r.repo_url as string,
    private: Boolean(r.repo_private),
    selectedAt: iso(r.updated_at),
  };
}

/**
 * Records a fresh connection (after Connect GitHub or a saved token) for the project. The caller
 * has already checked who may connect, so this writes as the system. A failed check of the account
 * is recorded as an error rather than thrown: the token is saved either way.
 */
export async function recordConnection(projectId: string, user: any, known?: any) {
  const { token } = await tokenOf(projectId);
  let account = known?.account;
  let error = '';
  if (!account && token) account = await whoAmI(token).catch((e: any) => ((error = message(e)), null));
  await asSystem(() =>
    q(
      `insert into github_connections (project_id, status, account_login, account_name, account_avatar, scopes, last_error, connected_by, connected_at, checked_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), now())
       on conflict (project_id) do update set status = excluded.status, account_login = excluded.account_login,
         account_name = excluded.account_name, account_avatar = excluded.account_avatar, scopes = excluded.scopes,
         last_error = excluded.last_error, connected_by = excluded.connected_by, connected_at = now(),
         checked_at = now(), updated_at = now()`,
      [
        projectId,
        error ? 'error' : 'connected',
        account?.login || '',
        account?.name || '',
        account?.avatar || '',
        known?.scopes || '',
        error,
        user?.name || null,
      ],
    ),
  );
}
/** Forgets the connection record (the token was removed). The chosen repository stays. */
export const forgetConnection = (projectId: string) =>
  asSystem(() => q('delete from github_connections where project_id = $1', [projectId]));

/**
 * What the card shows: { status: 'connected' | 'not_connected' | 'error', source, account, error,
 * connectedAt, checkedAt, repo }. Checks the sign-in with GitHub first, so a revoked token shows
 * as an error with the saved repository still in `repo`.
 */
export async function githubSettings(user: any, projectId: string) {
  needPerm(user);
  const { token, source } = await tokenOf(projectId);
  if (!token) {
    await q('delete from github_connections where project_id = $1', [projectId]);
    return {
      status: 'not_connected',
      source: '',
      account: null,
      error: '',
      connectedAt: null,
      checkedAt: null,
      repo: await readRepoLink(projectId),
    };
  }
  let error = '';
  const who = await whoAmI(token).catch((e: any) => ((error = message(e)), null));
  const row = (
    await q(
      `insert into github_connections (project_id, status, account_login, account_name, account_avatar, last_error, connected_by, checked_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (project_id) do update set status = excluded.status, last_error = excluded.last_error,
         account_login = case when excluded.status = 'connected' then excluded.account_login else github_connections.account_login end,
         account_name = case when excluded.status = 'connected' then excluded.account_name else github_connections.account_name end,
         account_avatar = case when excluded.status = 'connected' then excluded.account_avatar else github_connections.account_avatar end,
         checked_at = now(), updated_at = now()
       returning *`,
      [
        projectId,
        who ? 'connected' : 'error',
        who?.login || '',
        who?.name || '',
        who?.avatar || '',
        error,
        user?.name || null,
      ],
    )
  ).rows[0];
  return {
    status: who ? 'connected' : 'error',
    source,
    account: accountOf(row),
    error,
    connectedAt: iso(row.connected_at),
    checkedAt: iso(row.checked_at),
    repo: await readRepoLink(projectId),
  };
}

/** The repositories the connection can access (personal and organisations), searchable by `search`. */
export async function accessibleRepos(user: any, projectId: string, search = '') {
  needPerm(user);
  const { token } = await tokenOf(projectId);
  if (!token) throw new HttpError(400, 'Connect GitHub to list the repositories it can access.');
  try {
    return await listRepos(token, { q: search });
  } catch (e: any) {
    throw new HttpError(e?.status || 504, message(e));
  }
}

/**
 * Saves the project's repository: `fullName` (owner/name) from the accessible list, or '' to clear
 * it. Returns { repo } as the card shows it (null when cleared).
 */
export async function saveRepoLink(user: any, projectId: string, fullName: string) {
  needPerm(user);
  const name = String(fullName || '').trim();
  if (!name) {
    await q(
      `insert into github_repo_links (project_id, repo_full_name, default_branch, repo_url, repo_private, selected_by)
       values ($1, '', '', '', false, $2)
       on conflict (project_id) do update set repo_full_name = '', default_branch = '', repo_url = '',
         repo_private = false, selected_by = excluded.selected_by, updated_at = now()`,
      [projectId, user?.name || null],
    );
    return { repo: null };
  }
  if (!REPO_RE.test(name)) throw new HttpError(400, 'Choose a repository from the list (owner/name).');
  const found = (await accessibleRepos(user, projectId)).find(
    (r: any) => r.fullName.toLowerCase() === name.toLowerCase(),
  );
  if (!found)
    throw new HttpError(400, `${name} isn’t one of the repositories this GitHub connection can access.`);
  await q(
    `insert into github_repo_links (project_id, repo_full_name, default_branch, repo_url, repo_private, selected_by)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (project_id) do update set repo_full_name = excluded.repo_full_name,
       default_branch = excluded.default_branch, repo_url = excluded.repo_url,
       repo_private = excluded.repo_private, selected_by = excluded.selected_by, updated_at = now()`,
    [projectId, found.fullName, found.defaultBranch || '', found.url || '', Boolean(found.private), user?.name || null],
  );
  return { repo: await readRepoLink(projectId) };
}

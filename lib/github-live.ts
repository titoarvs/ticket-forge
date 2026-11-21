// TF-140: the Issues and Projects sections of Project → Code & GitHub, read live from the GitHub
// API on every request (nothing is cached or copied into the project), and the connection status
// shown in Administration → GitHub.
// - Who: people whose custom role has the Code & GitHub permission (project.repo, the one that
//   opens Project settings → Code & GitHub); the server checks it, the UI only hides the section.
// - Connection: the GitHub sign-in the project already uses (its saved token, else GITHUB_TOKEN,
//   which is shared by every project). No sign-in → { connected: false } and no GitHub request.
// - Repository: the one chosen in Code & GitHub → GitHub connection and repository (TF-142, the
//   github_repo_links table), else the one chosen in Repository (dev.repo), else the one linked for
//   GitHub issues (githubSync.repo). None → { repo: '' } and no GitHub request.
// - A failed GitHub request throws HttpError, so the client shows an error state, never old data.
// Read-only: creating or editing issues and Projects from Ticket Forge is a follow-up.
import { q } from './db';
import { HttpError } from './auth';
import { has, listProjects } from './store';
import { getProjectSecret, hasProjectSecret } from './secrets';
import { gh } from './github-sync';
import { listBoards } from './github-project/board';

export const NEEDS_REPO_PERM =
  'Seeing GitHub issues and projects needs the Set up the repository permission (Code & GitHub).';
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const PAGE = 100;

/** The token the project uses for GitHub, or ''. */
const tokenOf = async (projectId: string) =>
  (await getProjectSecret(projectId, 'githubToken')) || process.env.GITHUB_TOKEN || '';

/** The repository to read and the token to read it with, or that there is no connection. */
async function target(user: any, projectId: string) {
  if (!has(user, 'project.repo')) throw new HttpError(403, NEEDS_REPO_PERM);
  const pr = (
    await q('select data from projects where id = $1 and archived_at is null', [projectId])
  ).rows[0];
  if (!pr) throw new HttpError(404, 'Project not found');
  const token = await tokenOf(projectId);
  if (!token) return { connected: false as const };
  // The repository chosen in the GitHub connection card (TF-142, github_repo_links) wins, even
  // when it was cleared; projects that never used the card keep the older settings.
  const link = (await q('select repo_full_name from github_repo_links where project_id = $1', [projectId]))
    .rows[0];
  const repo = String(
    link ? link.repo_full_name : pr.data?.dev?.repo || pr.data?.githubSync?.repo || '',
  ).trim();
  return { connected: true as const, token, repo: REPO_RE.test(repo) ? repo : '' };
}

/** A GitHub request that can't even reach GitHub is a readable 504, like the GraphQL ones. */
const reachable = async <T>(run: () => Promise<T>) => {
  try {
    return await run();
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(504, 'GitHub didn’t respond. Try again.');
  }
};

/**
 * The repository's issues (pull requests left out), most recently updated first:
 * { connected, repo, issues, truncated }.
 */
export async function liveIssues(user: any, projectId: string) {
  const t = await target(user, projectId);
  if (!t.connected) return { connected: false, repo: '', issues: [], truncated: false };
  if (!t.repo) return { connected: true, repo: '', issues: [], truncated: false };
  const { data, more } = await reachable(() =>
    gh(`repos/${t.repo}/issues?state=all&sort=updated&direction=desc&per_page=${PAGE}`, t.token),
  );
  const issues = (Array.isArray(data) ? data : [])
    .filter((i: any) => !i.pull_request)
    .map((i: any) => ({
      number: Number(i.number),
      title: String(i.title || ''),
      state: i.state === 'closed' ? 'closed' : 'open',
      url: i.html_url || '',
      author: i.user?.login || '',
      assignee: i.assignee?.login || i.assignees?.[0]?.login || '',
      labels: (i.labels || [])
        .map((l: any) => (typeof l === 'string' ? l : l?.name))
        .filter(Boolean),
      comments: Number(i.comments) || 0,
      updatedAt: i.updated_at || '',
    }));
  return { connected: true, repo: t.repo, issues, truncated: Boolean(more) };
}

/**
 * The open GitHub Projects of the repository and of its owner: { connected, repo, projects }.
 * GitHub only serves them through its GraphQL API.
 */
export async function liveProjects(user: any, projectId: string) {
  const t = await target(user, projectId);
  if (!t.connected) return { connected: false, repo: '', projects: [] };
  if (!t.repo) return { connected: true, repo: '', projects: [] };
  const boards = await reachable(() => listBoards(t.token, t.repo));
  return {
    connected: true,
    repo: t.repo,
    projects: boards.map((b: any) => ({ id: b.id, number: b.number, title: b.title, url: b.url })),
  };
}

/**
 * Administration → GitHub: whether the workspace has a GitHub connection. `shared` is GITHUB_TOKEN
 * (every project uses it); otherwise `projects` counts the projects with their own saved token.
 * Never the token itself.
 */
export async function connectionStatus(user: any) {
  const shared = Boolean(process.env.GITHUB_TOKEN);
  const all = await listProjects({ ...user, is_owner: true });
  let own = 0;
  for (const p of all) if (await hasProjectSecret(p.id, 'githubToken')) own++;
  return { connected: shared || own > 0, shared, projects: own, total: all.length };
}

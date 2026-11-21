// Project settings → GitHub issues → Push tickets to GitHub: every ticket that has no GitHub issue
// yet gets one (createGithubIssue: the Jira-style body with its pull request links, its labels,
// closed when the ticket is Done) and goes on the linked GitHub Project board. Tickets go in key
// order, a few per request with a pause between them, so a request stays short and GitHub's limit
// on creating content isn't hit; the browser asks again until none are left. Each link is saved
// right after its issue is made, so a stopped push carries on without duplicates.
// Only the project owner and the Super Admin can, like linking and syncing.
import { q, tx } from './db';
import { HttpError } from './auth';
import { noteVersion } from './store';
import { uid } from './model';
import { openProject, requireOwner, createGithubIssue } from './github-sync';

export const PUSH_BATCH = 12;
const PAUSE_MS = Number(process.env.GITHUB_PUSH_PAUSE_MS ?? 1000);

const keyNumber = (key: any) => Number(String(key || '').match(/-(\d+)$/)?.[1] || 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The project's tickets without a GitHub issue (sub-tasks left out), in key order. */
async function waiting(projectId: string) {
  const rows = (await q('select id, data from issues where project_id = $1', [projectId])).rows;
  return rows
    .filter((r) => !r.data?.github?.number && !r.data?.parentId)
    .sort((a, b) => keyNumber(a.data.key) - keyNumber(b.data.key));
}

/** Saves the GitHub link on the ticket (its own small save) with a note in its activity. */
async function saveLink(user: any, projectId: string, id: string, github: any) {
  const version = await tx(async (t) => {
    const pr = (
      await t.query(
        'update projects set version = version + 1, updated_at = now() where id = $1 and archived_at is null returning version',
        [projectId],
      )
    ).rows[0];
    if (!pr) throw new HttpError(404, 'Project not found');
    const note = {
      id: uid(),
      at: new Date().toISOString(),
      author: user.name || '',
      field: 'event',
      text: `filed as GitHub issue #${github.number}`,
    };
    await t.query(
      `update issues set data = jsonb_set(data, '{github}', $3::jsonb)
          || jsonb_build_object('history', coalesce(data->'history', '[]'::jsonb) || $4::jsonb),
        updated_by = $5, updated_at = now(), rev = $6
       where project_id = $1 and id = $2`,
      [projectId, id, JSON.stringify(github), JSON.stringify([note]), user.id, pr.version],
    );
    return pr.version;
  });
  noteVersion(projectId, version);
}

/**
 * Pushes the next batch. Returns { pushed, remaining, errors, issues: [{ key, number, url }] }; a
 * ticket that failed stays waiting (its error says why) and the batch stops at a rate limit.
 */
export async function pushTickets(user: any, projectId: string) {
  const project = await openProject(user, projectId);
  requireOwner(project);
  if (!project.link?.repo) throw new HttpError(400, 'Link a GitHub repository first.');
  const queue = await waiting(projectId);
  const out = { pushed: 0, remaining: queue.length, errors: [] as string[], issues: [] as any[] };
  for (const [i, row] of queue.slice(0, PUSH_BATCH).entries()) {
    if (i > 0 && PAUSE_MS > 0) await sleep(PAUSE_MS);
    const t = row.data;
    try {
      const github = await createGithubIssue(projectId, t);
      if (!github) break; // the repository was unlinked meanwhile
      await saveLink(user, projectId, row.id, github);
      out.pushed++;
      out.issues.push({ key: t.key, number: github.number, url: github.url });
    } catch (e: any) {
      out.errors.push(`${t.key}: ${e.message}`);
      if (e.status === 429) break;
    }
  }
  out.remaining = queue.length - out.pushed;
  return out;
}

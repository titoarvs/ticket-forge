// TF-132: create an issue from the project workspace (by hand or from AI output), write it to the
// activity log and notify the project's members. The issue lives only in Ticket Forge: a linked
// GitHub repository is import-only, so no GitHub issue is filed (lib/github-sync.ts).
import { q, tx } from './db';
import { HttpError, listUsers } from './auth';
import { requireAccess, requirePerm, noteVersion, canAccess } from './store';
import { notify } from './notify';
import { uid } from './model';

export const ISSUE_TYPES = ['Story', 'Task', 'Bug', 'Spike'];
const PRIORITIES = ['Highest', 'High', 'Medium', 'Low'];
const RICH_MAX = 100000;

const idIn = (list: any, id: any) =>
  Array.isArray(list) && list.some((x: any) => x?.id === id) ? String(id) : null;

/**
 * The planning fields the Create issue form may set, checked against the project: an epic or
 * sprint that isn't in it is left empty, an unknown priority becomes Medium.
 */
function planning(input: any, data: any) {
  const points = Number(input?.storyPoints);
  const rich = input?.descriptionRich;
  const richOk = rich && typeof rich === 'object' && JSON.stringify(rich).length <= RICH_MAX;
  return {
    epicId: idIn(data?.epics, input?.epicId),
    sprintId: idIn(data?.sprints, input?.sprintId),
    priority: PRIORITIES.includes(input?.priority) ? input.priority : 'Medium',
    storyPoints:
      input?.storyPoints !== null && input?.storyPoints !== '' && points >= 0 && points <= 1000
        ? points
        : null,
    assignee: String(input?.assignee ?? '')
      .trim()
      .slice(0, 120),
    ...(richOk ? { descriptionRich: rich } : {}),
  };
}

/**
 * Creates one issue at the end of a project's backlog as `user`. input: { title, description, type,
 * status, attachments: [file id], epicId, sprintId, priority, storyPoints, assignee,
 * descriptionRich }. Nothing is written to GitHub, even when the project has a repository linked.
 */
export async function createProjectIssue(user: any, projectId: string, input: any) {
  requireAccess(user, projectId);
  requirePerm(user, 'issue.create');
  const title = String(input?.title ?? '').trim();
  if (!title) throw new HttpError(400, 'Title is required.');
  if (title.length > 200) throw new HttpError(400, 'Title must be at most 200 characters.');
  const type = ISSUE_TYPES.find(
    (x) =>
      x.toLowerCase() ===
      String(input?.type ?? '')
        .trim()
        .toLowerCase(),
  );
  if (!type) throw new HttpError(400, `Type must be one of ${ISSUE_TYPES.join(', ')}.`);
  const description = String(input?.description ?? '')
    .trim()
    .slice(0, 20000);
  const attachments = (Array.isArray(input?.attachments) ? input.attachments : [])
    .map((x: any) => String(x))
    .filter((x: string) => /^\w{1,40}$/.test(x))
    .slice(0, 20);
  const wanted = String(input?.status ?? '').trim();

  const out = await tx(async (t) => {
    const pr = (
      await t.query(
        'update projects set version = version + 1, updated_at = now() where id = $1 and archived_at is null returning version, data, key, name',
        [projectId],
      )
    ).rows[0];
    if (!pr) throw new HttpError(404, 'Project not found');
    const names: string[] = (pr.data?.workflow || []).map((s: any) => s.name);
    if (wanted && names.length && !names.includes(wanted))
      throw new HttpError(400, `Status must be one of ${names.join(', ')}.`);
    const status = wanted || names[0] || 'To Do';
    const key = String(pr.key);
    const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
    const rows = (
      await t.query("select data->>'key' as key, position from issues where project_id = $1", [
        projectId,
      ])
    ).rows;
    const max = rows.reduce(
      (m: number, r: any) => Math.max(m, Number(String(r.key || '').match(re)?.[1] || 0)),
      0,
    );
    const maxPos = rows.reduce((m: number, r: any) => Math.max(m, Number(r.position)), -1);
    const now = new Date().toISOString();
    const issue = {
      id: uid(),
      key: `${key}-${max + 1}`,
      parentId: null,
      title,
      type,
      ...planning(input, pr.data),
      labels: [],
      userStory: '',
      description,
      acceptanceCriteria: [],
      dependencies: [],
      testCases: [],
      attachments,
      status,
      reporter: user.name || '',
      createdBy: user.id,
      links: [],
      prs: [],
      comments: [],
      history: [
        {
          id: uid(),
          at: now,
          author: user.name || '',
          field: 'created',
          text: 'created the issue',
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    await t.query(
      'insert into issues (project_id, id, position, data, updated_by, updated_at, rev) values ($1,$2,$3,$4,$5,now(),$6)',
      [projectId, issue.id, maxPos + 1, JSON.stringify(issue), user.id, pr.version],
    );
    await t.query(
      "insert into activity (project_id, version, user_id, author, kind, target, text) values ($1,$2,$3,$4,'issue',$5,$6)",
      [
        projectId,
        pr.version,
        user.id,
        user.name || '',
        issue.key,
        `created ${issue.key} “${title.slice(0, 120)}”`,
      ],
    );
    return { version: pr.version, issue };
  });
  noteVersion(projectId, out.version);

  // Tell every other member of the project. A failed notification must not undo the issue.
  try {
    const users = (await listUsers()).filter((u: any) => u.status === 'active');
    for (const u of users) {
      if (u.id === user.id) continue;
      if (!canAccess({ is_owner: u.isOwner, project_access: u.projectAccess }, projectId)) continue;
      await notify({
        userId: u.id,
        projectId,
        issueId: out.issue.id,
        kind: 'issue-created',
        title: `${user.name || 'Someone'} created ${out.issue.key}`,
        body: title,
        link: `/p/${projectId}/backlog?issue=${encodeURIComponent(out.issue.id)}`,
      });
    }
  } catch (e) {
    console.error('issue-created notifications failed', e);
  }
  return { issue: out.issue };
}

export async function projectExists(id: string) {
  return !!(await q('select 1 from projects where id = $1', [id])).rows[0];
}

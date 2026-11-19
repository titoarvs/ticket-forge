import { q, tx } from '../db';
import { HttpError } from '../auth';
import { projectWorkspace, requireAccess, requirePerm, noteVersion } from '../store';
import { uid } from '../model';

export const SERVER_INFO = { name: 'ticketforge', title: 'Ticket Forge', version: '1.0.0' };
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const TYPES = ['Story', 'Task', 'Bug', 'Spike'];
export const PRIORITIES = ['Highest', 'High', 'Medium', 'Low'];
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;
export const TITLE_MAX = 200;
const TEXT_MAX = 20000;
const LIST_MAX = 50;
const ITEM_MAX = 1000;
export const bad = (msg: string) => new HttpError(400, msg);
// ---------------------------------------------------------------- project and argument checks
/**
 * The project the call is about. Unknown ids (also another workspace's or an archived project's)
 * are one error, a project the person can't open another; `unknownIsInvalid` makes the first a
 * validation error (create_issue) instead of "not found".
 */
async function openProject(user, projectId: unknown, unknownIsInvalid = false) {
  const id = typeof projectId === 'string' ? projectId.trim() : '';
  if (!id) throw bad('projectId is required.');
  const unknown = unknownIsInvalid
    ? bad(`Unknown project id “${id.slice(0, 64)}”.`)
    : new HttpError(404, 'Project not found');
  if (!/^[\w-]{1,64}$/.test(id)) throw unknown;
  const w = await projectWorkspace(id);
  if (!w || w !== user.workspace_id) throw unknown;
  requireAccess(user, id);
  const p = (
    await q('select id, key, data from projects where id = $1 and archived_at is null', [id])
  ).rows[0];
  if (!p) throw unknown;
  return { id, key: String(p.key), data: p.data || {} };
}
const text = (v: unknown, field: string, max: number, required = false) => {
  if (v == null || v === '') {
    if (required) throw bad(`${field} is required.`);
    return '';
  }
  if (typeof v !== 'string') throw bad(`${field} must be text.`);
  const s = v.trim();
  if (required && !s) throw bad(`${field} is required.`);
  if (s.length > max) throw bad(`${field} must be at most ${max} characters.`);
  return s;
};
const list = (v: unknown, field: string) => {
  if (v == null) return [];
  const a = typeof v === 'string' ? [v] : v;
  if (!Array.isArray(a)) throw bad(`${field} must be a list of text.`);
  if (a.length > LIST_MAX) throw bad(`${field} can have at most ${LIST_MAX} items.`);
  return a.map((x) => text(x, `${field} item`, ITEM_MAX)).filter(Boolean);
};
const oneOf = (v: unknown, field: string, allowed: string[], dflt: string) => {
  if (v == null || v === '') return dflt;
  const m = allowed.find(
    (x) => typeof v === 'string' && x.toLowerCase() === v.trim().toLowerCase(),
  );
  if (!m) throw bad(`${field} must be one of ${allowed.join(', ')}.`);
  return m;
};
const paging = (args: any) => {
  const limit = args?.limit == null ? DEFAULT_LIMIT : Number(args.limit);
  const offset = args?.offset == null ? 0 : Number(args.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
    throw bad(`limit must be a whole number from 1 to ${MAX_LIMIT}.`);
  if (!Number.isInteger(offset) || offset < 0)
    throw bad('offset must be a whole number, 0 or more.');
  return { limit, offset };
};
const likeOf = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
// ---------------------------------------------------------------- output
const issueSummary = (d: any) => ({
  id: d.id,
  key: d.key,
  title: d.title,
  type: d.type,
  priority: d.priority,
  status: d.status,
  epicId: d.epicId || null,
  assignee: d.assignee || '',
});
const issueFull = (d: any) => ({
  ...issueSummary(d),
  sprintId: d.sprintId || null,
  storyPoints: d.storyPoints ?? null,
  labels: d.labels || [],
  userStory: d.userStory || '',
  description: d.description || '',
  acceptanceCriteria: d.acceptanceCriteria || [],
  dependencies: d.dependencies || [],
  reporter: d.reporter || '',
  createdBy: d.createdBy || null,
  createdAt: d.createdAt || null,
  updatedAt: d.updatedAt || null,
});
// Draft epics are saved AI output that nobody published yet: they aren't part of the backlog, so
// they aren't shown.
const publishedEpics = (data: any) =>
  (Array.isArray(data?.epics) ? data.epics : []).filter((e: any) => e && e.id && !e.draft);
const epicOut = (e: any) => ({
  id: e.id,
  key: e.key || '',
  title: e.title || '',
  description: e.description || '',
});
// ---------------------------------------------------------------- tools
/** Creates one issue at the end of the project's backlog, as the calling person. */
export async function createIssue(user, args: any) {
  const title = text(args?.title, 'title', TITLE_MAX, true);
  const description = text(args?.description, 'description', TEXT_MAX);
  const userStory = text(args?.userStory, 'userStory', TEXT_MAX);
  const type = oneOf(args?.type, 'type', TYPES, 'Story');
  const priority = oneOf(args?.priority, 'priority', PRIORITIES, 'Medium');
  const labels = list(args?.labels, 'labels');
  const acceptanceCriteria = list(args?.acceptanceCriteria, 'acceptanceCriteria');
  let storyPoints: number | null = null;
  if (args?.storyPoints != null) {
    storyPoints = Number(args.storyPoints);
    if (typeof args.storyPoints === 'boolean' || !Number.isFinite(storyPoints) || storyPoints < 0)
      throw bad('storyPoints must be a number, 0 or more.');
  }
  const epicId = args?.epicId == null || args.epicId === '' ? null : String(args.epicId);

  const project = await openProject(user, args?.projectId, true);
  requirePerm(user, 'issue.create');
  if (epicId && !publishedEpics(project.data).some((e: any) => e.id === epicId))
    throw bad('That epic isn’t in this project.');

  const out = await tx(async (t) => {
    // The project row first (the same order as every other save): it holds the project's lock while
    // the key is chosen.
    const pr = (
      await t.query(
        'update projects set version = version + 1, updated_at = now() where id = $1 and archived_at is null returning version, data',
        [project.id],
      )
    ).rows[0];
    if (!pr) throw bad(`Unknown project id “${project.id}”.`);
    const re = new RegExp(`^${project.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
    const rows = (
      await t.query("select data->>'key' as key, position from issues where project_id = $1", [
        project.id,
      ])
    ).rows;
    const max = rows.reduce(
      (m, r) => Math.max(m, Number(String(r.key || '').match(re)?.[1] || 0)),
      0,
    );
    const maxPos = rows.reduce((m, r) => Math.max(m, Number(r.position)), -1);
    const now = new Date().toISOString();
    const issue = {
      id: uid(),
      key: `${project.key}-${max + 1}`,
      epicId,
      sprintId: null,
      parentId: null,
      title,
      type,
      priority,
      storyPoints,
      labels,
      userStory,
      description,
      acceptanceCriteria,
      dependencies: [],
      testCases: [],
      status: pr.data?.workflow?.[0]?.name || 'To Do', // the backlog default: the first workflow status
      assignee: '',
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
          text: 'created the issue through MCP',
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    await t.query(
      'insert into issues (project_id, id, position, data, updated_by, updated_at, rev) values ($1,$2,$3,$4,$5,now(),$6)',
      [project.id, issue.id, maxPos + 1, JSON.stringify(issue), user.id, pr.version],
    );
    await t.query(
      "insert into activity (project_id, version, user_id, author, kind, target, text) values ($1,$2,$3,$4,'issue',$5,$6)",
      [
        project.id,
        pr.version,
        user.id,
        user.name || '',
        issue.key,
        `created ${issue.key} “${title.slice(0, 120)}” through MCP`,
      ],
    );
    return { version: pr.version, issue };
  });
  noteVersion(project.id, out.version);
  return { issue: issueFull(out.issue) };
}
/**
 * Issues of one project, newest position last; `query` searches key, title, user story and
 * description.
 */
export async function listIssues(user, args: any) {
  const project = await openProject(user, args?.projectId);
  const { limit, offset } = paging(args);
  const params: any[] = [project.id];
  const where = ['project_id = $1'];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('$$', () => `$${params.length}`));
  };
  const query = text(args?.query, 'query', 200);
  if (query)
    add(
      "concat_ws(' ', data->>'key', data->>'title', data->>'userStory', data->>'description') ilike $$",
      likeOf(query),
    );
  for (const f of ['status', 'type', 'priority', 'assignee', 'epicId']) {
    const v = text(args?.[f], f, 200);
    if (v) add(`data->>'${f}' = $$`, v);
  }
  const rows = (
    await q(
      `select data from issues where ${where.join(' and ')} order by position, id limit ${limit + 1} offset ${offset}`,
      params,
    )
  ).rows;
  return {
    issues: rows.slice(0, limit).map((r) => issueSummary(r.data)),
    more: rows.length > limit,
  };
}
/** One issue of the project, by id or key. */
export async function getIssue(user, args: any) {
  const project = await openProject(user, args?.projectId);
  const ref = text(args?.issueId, 'issueId', 200, true);
  const row = (
    await q(
      "select data from issues where project_id = $1 and (id = $2 or upper(data->>'key') = upper($2))",
      [project.id, ref],
    )
  ).rows[0];
  if (!row) throw new HttpError(404, `No issue “${ref}” in this project.`);
  return { issue: issueFull(row.data) };
}
/**
 * Epics of one project with how many issues each has; `query` searches key, title and description.
 */
export async function listEpics(user, args: any) {
  const project = await openProject(user, args?.projectId);
  const { limit, offset } = paging(args);
  const query = text(args?.query, 'query', 200).toLowerCase();
  const match = (e: any) =>
    !query ||
    [e.key, e.title, e.description].some((s) =>
      String(s || '')
        .toLowerCase()
        .includes(query),
    );
  const found = publishedEpics(project.data).filter(match);
  const counts = new Map(
    (
      await q(
        "select data->>'epicId' as epic, count(*)::int as n from issues where project_id = $1 and data->>'epicId' is not null group by 1",
        [project.id],
      )
    ).rows.map((r) => [r.epic, r.n]),
  );
  return {
    epics: found
      .slice(offset, offset + limit)
      .map((e: any) => ({ ...epicOut(e), issueCount: counts.get(e.id) || 0 })),
    more: found.length > offset + limit,
  };
}
/** One epic of the project, by id or key, with its issues. */
export async function getEpic(user, args: any) {
  const project = await openProject(user, args?.projectId);
  const ref = text(args?.epicId, 'epicId', 200, true).toLowerCase();
  const epic = publishedEpics(project.data).find(
    (e: any) => String(e.id).toLowerCase() === ref || String(e.key || '').toLowerCase() === ref,
  );
  if (!epic) throw new HttpError(404, `No epic “${ref.slice(0, 64)}” in this project.`);
  const rows = (
    await q(
      "select data from issues where project_id = $1 and data->>'epicId' = $2 order by position, id limit $3",
      [project.id, epic.id, MAX_LIMIT + 1],
    )
  ).rows;
  return {
    epic: {
      ...epicOut(epic),
      issueCount: rows.length,
      issues: rows.slice(0, MAX_LIMIT).map((r) => issueSummary(r.data)),
      more: rows.length > MAX_LIMIT,
    },
  };
}

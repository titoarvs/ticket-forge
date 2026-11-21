// TF-130: import GitHub issues as tickets and keep them in two-way sync (Project settings → Code &
// GitHub → GitHub issues). Only the project's owner and the Super Admin (the workspace owner) can
// link a repository or run an import / sync.
// - GitHub sign-in is the one the project already has (Connect GitHub, a saved token or GITHUB_TOKEN).
// - A ticket remembers its GitHub issue in `ticket.github` ({ repo, number, … }): the external key
//   used to match on re-import, plus a snapshot (`base`) of the mapped fields as of the last sync.
// - Mapping: title → title, body → description, labels → labels, assignee → assignee, milestone →
//   epic (created when missing), open / closed → the project's first / "done" workflow status.
//   An issue filed from Ticket Forge has a Jira-style body (lib/github-body.ts): only its marked
//   description part maps to the ticket, and a description change rewrites the whole layout.
// - Conflicts: a field changed on both sides since the last sync takes the newer side's value
//   (GitHub's updated_at against the ticket's updatedAt; a tie goes to GitHub) and the ticket's
//   activity gets a "Sync conflict" entry. Fields changed on one side only are copied across.
// - GitHub Project board (when one is linked): Status, Priority, story points and Sprint ↔
//   Iteration sync the same way, after the issues (lib/github-project/).
// Out of scope: pull requests, comments, other hosts, and issues deleted or transferred in GitHub
// (their tickets are left as they are).
import { q, tx } from './db';
import { HttpError } from './auth';
import { canDeleteProject, noteVersion } from './store';
import { statsOf } from './store/create-project';
import { insertVersions } from './store/patch-project';
import { EPIC_COLORS, uid } from './model';
import { getProjectSecret } from './secrets';
import { ticketBody, descriptionOf, isTicketBody, type TicketForBody } from './github-body';
import { syncBoard, addToBoard } from './github-project/sync';

export const ONLY_OWNERS =
  'Only the project owner or a Super Admin can link a GitHub repository or import from GitHub.';
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const PAGE = 100;
/** The most issues one import reads (20 pages of 100): the rest is reported as `truncated`. */
export const MAX_PAGES = 20;
const FIELDS = ['title', 'description', 'labels', 'assignee', 'milestone', 'state'];
/** The fields a change in Ticket Forge writes back to GitHub (milestones are read-only). */
const PUSHABLE = ['title', 'description', 'labels', 'assignee', 'state'];
const FIELD_LABEL = {
  title: 'title',
  description: 'description',
  labels: 'labels',
  assignee: 'assignee',
  milestone: 'epic',
  state: 'status',
};
const DEFAULT_WORKFLOW = [
  { name: 'To Do', category: 'todo' },
  { name: 'In Progress', category: 'inprogress' },
  { name: 'In Review', category: 'inprogress' },
  { name: 'Done', category: 'done' },
];

// ---------------------------------------------------------------- GitHub
async function gh(path: string, token: string, { method = 'GET', body }: any = {}) {
  const res = await fetch(`https://api.github.com/${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'TicketForge',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (res.ok) return { data: await res.json(), more: /rel="next"/.test(res.headers.get('link') || '') };
  const left = res.headers.get('x-ratelimit-remaining');
  if (res.status === 429 || (res.status === 403 && (left === '0' || res.headers.get('retry-after')))) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    throw new HttpError(
      429,
      `GitHub’s rate limit is used up${reset ? ` until ${new Date(reset * 1000).toISOString()}` : ''}. Try again later.`,
    );
  }
  if (res.status === 401) throw new HttpError(400, 'GitHub rejected the sign-in. Connect GitHub again.');
  if (res.status === 403 || res.status === 404)
    throw new HttpError(
      400,
      'Couldn’t reach that repository on GitHub. Check its name and that the connected GitHub account can access it.',
    );
  throw new HttpError(502, `GitHub said ${res.status}.`);
}
/** The issues of a repository (pull requests left out), oldest first: { issues, truncated }. */
async function fetchIssues(repo: string, token: string) {
  const out: any[] = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, more } = await gh(
      `repos/${repo}/issues?state=all&sort=created&direction=asc&per_page=${PAGE}&page=${page}`,
      token,
    );
    out.push(...data.filter((i: any) => !i.pull_request));
    if (!more || data.length < PAGE) break;
    if (page === MAX_PAGES) truncated = true;
  }
  return { issues: out, truncated };
}
const clean = (s: any) => String(s ?? '').replace(/\r\n/g, '\n').trim();
/** A GitHub issue as the ticket-side values (before the assignee is matched to a person). */
const fromGithub = (i: any) => ({
  number: Number(i.number),
  nodeId: i.node_id || '',
  url: i.html_url || '',
  author: i.user?.login || '',
  createdAt: i.created_at || '',
  updatedAt: i.updated_at || '',
  title: clean(i.title),
  description: descriptionOf(i.body),
  formatted: isTicketBody(i.body),
  labels: (i.labels || []).map((l: any) => clean(typeof l === 'string' ? l : l?.name)).filter(Boolean),
  assigneeLogin: i.assignee?.login || i.assignees?.[0]?.login || '',
  milestone: clean(i.milestone?.title),
  state: i.state === 'closed' ? 'closed' : 'open',
});

// ---------------------------------------------------------------- mapping and conflict rule
const same = (field: string, a: any, b: any) =>
  field === 'labels'
    ? JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort())
    : (a ?? '') === (b ?? '');
const workflowOf = (data: any) => (data?.workflow?.length ? data.workflow : DEFAULT_WORKFLOW);
const openStatus = (wf: any[]) => wf[0].name;
const closedStatus = (wf: any[]) => (wf.find((w) => w.category === 'done') || wf[wf.length - 1]).name;
/** The mapped fields of a ticket, comparable with a GitHub issue's. */
function ticketValues(d: any, epics: any[], wf: any[]) {
  const done = wf.find((w) => w.name === d.status)?.category === 'done';
  return {
    title: clean(d.title),
    description: clean(d.description),
    labels: d.labels || [],
    assignee: d.assignee || '',
    milestone: clean(epics.find((e) => e.id === d.epicId)?.title),
    state: done ? 'closed' : 'open',
  };
}
/**
 * What to do with one linked ticket: the fields to copy from GitHub (`apply`), the ones to write to
 * GitHub (`push`) and the fields both sides changed (`conflicts`, each decided by the newer side).
 * `base` is what both sides had at the last sync.
 */
type PlanInput = { tf: any; base: any; gh: any; tfTime: number; ghTime: number };
/** planSync's rule for any set of fields (the GitHub Project board uses it too). */
export function planFields(fields: string[], pushable: string[], v: PlanInput) {
  const { tf, base, gh, tfTime, ghTime } = v;
  const apply: any = {},
    push: any = {},
    conflicts: any[] = [];
  for (const f of fields) {
    if (same(f, tf[f], gh[f])) continue;
    const ghChanged = !same(f, gh[f], base?.[f]);
    const tfChanged = !same(f, tf[f], base?.[f]);
    if (ghChanged && tfChanged) {
      const github = ghTime >= tfTime;
      conflicts.push({ field: f, winner: github ? 'GitHub' : 'Ticket Forge', tf: tf[f], gh: gh[f] });
      if (github) apply[f] = gh[f];
      else if (pushable.includes(f)) push[f] = tf[f];
    } else if (ghChanged) apply[f] = gh[f];
    else if (tfChanged && pushable.includes(f)) push[f] = tf[f];
  }
  return { apply, push, conflicts };
}
export function planSync(tf: any, base: any, gh: any, tfTime: number, ghTime: number) {
  return planFields(FIELDS, PUSHABLE, { tf, base, gh, tfTime, ghTime });
}
const clip = (v: any) => {
  const s = Array.isArray(v) ? v.join(', ') : String(v ?? '');
  return s.length > 80 ? `${s.slice(0, 80)}…` : s || 'none';
};
const conflictText = (conflicts: any[], tfTime: number, ghTime: number) => {
  const when = (t: number) => (t ? new Date(t).toISOString() : 'unknown');
  return `Sync conflict: ${conflicts
    .map(
      (c) =>
        `${FIELD_LABEL[c.field]} (${c.winner} won; ${c.winner === 'GitHub' ? `Ticket Forge’s value was “${clip(c.tf)}”` : `GitHub’s value was “${clip(c.gh)}”`})`,
    )
    .join('; ')}. Both sides changed it; the newer change wins (GitHub ${when(ghTime)}, Ticket Forge ${when(tfTime)}).`;
};
/** The login to assign on GitHub for a ticket's assignee, or null when it isn't a GitHub login. */
const loginOf = (assignee: string) => {
  const s = String(assignee || '').trim().replace(/^@/, '');
  return LOGIN_RE.test(s) ? s : null;
};
const pushBody = (fields: any) => {
  const b: any = {};
  if ('title' in fields) b.title = fields.title;
  if ('description' in fields) b.body = fields.description;
  if ('labels' in fields) b.labels = fields.labels;
  if ('state' in fields) b.state = fields.state;
  if ('assignee' in fields) {
    const login = loginOf(fields.assignee);
    if (login || !fields.assignee) b.assignees = login ? [login] : [];
  }
  return b;
};

// ---------------------------------------------------------------- permission and token
/**
 * The project with its repository link ({ repo, url, private, linkedAt, linkedBy, lastSyncAt, last }
 * or null) and whether this person may link and import.
 */
export async function openProject(user: any, projectId: string) {
  const pr = (
    await q('select created_by, key, data from projects where id = $1 and archived_at is null', [
      projectId,
    ])
  ).rows[0];
  if (!pr) throw new HttpError(404, 'Project not found');
  return { ...pr, link: pr.data?.githubSync || null, canManage: canDeleteProject(user, pr.created_by) };
}
export function requireOwner(project: any) {
  if (!project.canManage) throw new HttpError(403, ONLY_OWNERS);
}
export async function tokenFor(projectId: string) {
  const token = (await getProjectSecret(projectId, 'githubToken')) || process.env.GITHUB_TOKEN || '';
  if (!token)
    throw new HttpError(
      400,
      'Connect GitHub first (Project settings → Code & GitHub → Repository setup).',
    );
  return token;
}
/**
 * TF-134: files a GitHub issue for a new ticket in the project's linked repository. Returns the
 * `ticket.github` link, or null when the project has no repository linked (the ticket then lives
 * only in Ticket Forge). Throws HttpError with a readable message when a linked repository can't
 * be used.
 */
export async function createGithubIssue(
  projectId: string,
  ticket: TicketForBody & { epicId?: any; sprintId?: any; status?: string; labels?: string[] },
) {
  const pr = (
    await q('select data from projects where id = $1 and archived_at is null', [projectId])
  ).rows[0];
  const repo = pr?.data?.githubSync?.repo;
  if (!repo) return null;
  const title = clean(ticket.title);
  const epic = (pr.data.epics || []).find((e: any) => e.id === ticket.epicId)?.title || '';
  const token = (await getProjectSecret(projectId, 'githubToken')) || process.env.GITHUB_TOKEN || '';
  if (!token)
    throw new HttpError(
      400,
      'GitHub connection missing: add a personal access token in settings (Project settings → Code & GitHub) to create tickets.',
    );
  // Labels go with the issue so both sides start equal; a Done ticket's issue is closed right away.
  const labels = (ticket.labels || []).map(clean).filter(Boolean).slice(0, 20);
  const done = workflowOf(pr.data).find((w: any) => w.name === ticket.status)?.category === 'done';
  let data: any;
  try {
    ({ data } = await gh(`repos/${repo}/issues`, token, {
      method: 'POST',
      body: { title, body: ticketBody(ticket, epic), ...(labels.length ? { labels } : {}) },
    }));
  } catch (e: any) {
    if (e instanceof HttpError) {
      if (e.status === 400) throw new HttpError(400, `GitHub connection problem: ${e.message}`);
      throw e;
    }
    throw new HttpError(504, 'GitHub connection problem: GitHub didn’t respond. Try again.');
  }
  // The issue exists now: a failed close mustn't lose it (the next sync closes it).
  if (done)
    data = await gh(`repos/${repo}/issues/${data.number}`, token, {
      method: 'PATCH',
      body: { state: 'closed', state_reason: 'completed' },
    })
      .then((r) => r.data)
      .catch(() => data);
  const g: any = fromGithub(data);
  const now = new Date().toISOString();
  // The linked GitHub Project board gets the issue with the ticket's status, priority, points and
  // sprint. The issue already exists, so a board problem doesn't stop the ticket: the next sync
  // adds it.
  let board: any = null;
  if (pr.data.githubSync?.project?.id && g.nodeId)
    board = await addToBoard(token, pr.data.githubSync.project.id, g.nodeId, ticket, pr.data).catch(
      () => null,
    );
  return {
    repo,
    number: g.number,
    nodeId: g.nodeId,
    url: g.url,
    updatedAt: g.updatedAt,
    syncedAt: now,
    base: {
      title: g.title,
      description: g.description,
      labels: g.labels,
      assignee: '',
      milestone: '',
      state: g.state,
    },
    ...(board ? { board } : {}),
  };
}

// ---------------------------------------------------------------- link a repository
/** "owner/name" from that or a github.com address. */
export function parseRepo(input: any) {
  const s = String(input || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  if (!REPO_RE.test(s)) throw new HttpError(400, 'Enter the repository as owner/name, for example acme/shop.');
  return s;
}
/** Saves a repository the connected GitHub account can access as this project's GitHub repository. */
export async function linkRepo(user: any, projectId: string, input: any) {
  const project = await openProject(user, projectId);
  requireOwner(project);
  const wanted = parseRepo(input);
  const { data: r } = await gh(`repos/${wanted}`, await tokenFor(projectId));
  const link = {
    repo: String(r.full_name || wanted),
    url: r.html_url || `https://github.com/${wanted}`,
    private: Boolean(r.private),
    linkedAt: new Date().toISOString(),
    linkedBy: user.name || '',
  };
  const version = await tx(async (t) => {
    const pr = (
      await t.query(
        `update projects set version = version + 1, updated_at = now(),
          data = data || jsonb_build_object('githubSync', $2::jsonb),
          revs = revs || jsonb_build_object('githubSync', version + 1)
        where id = $1 and archived_at is null returning version`,
        [projectId, JSON.stringify(link)],
      )
    ).rows[0];
    if (!pr) throw new HttpError(404, 'Project not found');
    await t.query(
      "insert into activity (project_id, version, user_id, author, kind, target, text) values ($1,$2,$3,$4,'project','',$5)",
      [projectId, pr.version, user.id, user.name || '', `linked the GitHub repository ${link.repo}`],
    );
    return pr.version;
  });
  noteVersion(projectId, version);
  return { linked: link };
}

// ---------------------------------------------------------------- import and sync
/**
 * Reads every issue of the linked repository and creates or updates its tickets. mode 'import' only
 * changes tickets; mode 'sync' also writes the Ticket Forge side of the changes back to GitHub.
 * Returns { total, created, updated, unchanged, conflicts, epicsCreated, pushed, errors, truncated }.
 */
export async function syncIssues(user: any, projectId: string, mode: 'import' | 'sync' = 'import') {
  const project = await openProject(user, projectId);
  requireOwner(project);
  const link = project.link;
  if (!link?.repo) throw new HttpError(400, 'Link a GitHub repository first.');
  const token = await tokenFor(projectId);
  const { issues, truncated } = await fetchIssues(link.repo, token);
  const pushes: any[] = [];
  const result: any = {
    total: issues.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    conflicts: 0,
    epicsCreated: [] as string[],
    pushed: 0,
    errors: [] as string[],
    truncated,
  };

  const version = await tx(async (t) => {
    pushes.length = 0;
    // The project row first (the same order as every other save): it holds the project's lock.
    const pr = (
      await t.query(
        'update projects set version = version + 1, updated_at = now() where id = $1 and archived_at is null returning version, key, data',
        [projectId],
      )
    ).rows[0];
    if (!pr) throw new HttpError(404, 'Project not found');
    const data = pr.data || {};
    const epics: any[] = Array.isArray(data.epics) ? [...data.epics] : [];
    const wf = workflowOf(data);
    const members: any[] = Array.isArray(data.members) ? data.members : [];
    const person = (login: string) =>
      members.find((m) => String(m?.name || '').toLowerCase() === login.toLowerCase())?.name || login;
    const all = (
      await t.query('select id, position, data from issues where project_id = $1', [projectId])
    ).rows;
    const linked = new Map<number, any>(
      all
        .filter((r) => r.data?.github?.repo === link.repo)
        .map((r) => [Number(r.data.github.number), r]),
    );
    const keyRe = new RegExp(`^${String(pr.key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
    let nextKey = all.reduce((m, r) => Math.max(m, Number(String(r.data?.key || '').match(keyRe)?.[1] || 0)), 0);
    let nextPos = all.reduce((m, r) => Math.max(m, Number(r.position)), -1);
    let nextEpic = epics.reduce((m, e) => Math.max(m, Number(String(e?.key || '').match(/-E(\d+)$/)?.[1] || 0)), 0);
    let epicsChanged = false;
    /** The published epic named like the milestone, created when the project has none. */
    const epicFor = (name: string) => {
      if (!name) return null;
      const found = epics.find((e) => e && !e.draft && clean(e.title).toLowerCase() === name.toLowerCase());
      if (found) return found.id;
      const e = {
        id: uid(),
        key: `${pr.key}-E${++nextEpic}`,
        title: name,
        description: '',
        color: EPIC_COLORS[epics.length % EPIC_COLORS.length],
      };
      epics.push(e);
      epicsChanged = true;
      result.epicsCreated.push(name);
      return e.id;
    };

    const now = new Date().toISOString();
    const rows: any[] = [];
    const moved: any[] = [];
    const events: any[] = [];
    const event = (d: any, text: string, at: string) =>
      (d.history ??= []).push({ id: uid(), at, author: 'GitHub', field: 'event', text });
    for (const raw of issues) {
      const g: any = fromGithub(raw);
      g.assignee = g.assigneeLogin ? person(g.assigneeLogin) : '';
      const mapped = Object.fromEntries(FIELDS.map((f) => [f, g[f]]));
      const meta = (base = mapped) => ({
        repo: link.repo,
        number: g.number,
        nodeId: g.nodeId,
        url: g.url,
        updatedAt: g.updatedAt,
        syncedAt: now,
        base,
      });
      const row = linked.get(g.number);
      if (!row) {
        const d: any = {
          id: uid(),
          key: `${pr.key}-${++nextKey}`,
          epicId: epicFor(g.milestone),
          sprintId: null,
          parentId: null,
          title: g.title,
          type: 'Task',
          priority: 'Medium',
          storyPoints: null,
          labels: g.labels,
          userStory: '',
          description: g.description,
          acceptanceCriteria: [],
          dependencies: [],
          testCases: [],
          status: g.state === 'closed' ? closedStatus(wf) : openStatus(wf),
          assignee: g.assignee,
          reporter: g.author || user.name || '',
          createdBy: user.id,
          links: [],
          prs: [],
          comments: [],
          history: [],
          createdAt: g.createdAt || now,
          updatedAt: g.updatedAt || now,
          github: meta(),
        };
        event(d, `imported from GitHub (${link.repo}#${g.number})`, now);
        rows.push({ id: d.id, pos: ++nextPos, data: d });
        result.created++;
        continue;
      }
      const d: any = JSON.parse(JSON.stringify(row.data));
      const tfTime = Date.parse(d.updatedAt) || 0;
      const ghTime = Date.parse(g.updatedAt) || 0;
      const plan = planSync(ticketValues(d, epics, wf), d.github.base, mapped, tfTime, ghTime);
      const applied = Object.keys(plan.apply);
      if (applied.length) {
        for (const f of applied) {
          if (f === 'title' || f === 'description' || f === 'labels' || f === 'assignee') d[f] = g[f];
          else if (f === 'milestone') d.epicId = epicFor(g.milestone);
          else if (f === 'state') d.status = g.state === 'closed' ? closedStatus(wf) : openStatus(wf);
        }
        d.updatedAt = g.updatedAt || now;
        event(d, `updated from GitHub: ${applied.map((f) => FIELD_LABEL[f]).join(', ')}`, now);
      }
      if (plan.conflicts.length) {
        event(d, conflictText(plan.conflicts, tfTime, ghTime), now);
        result.conflicts += plan.conflicts.length;
        events.push({
          kind: 'issue',
          target: d.key,
          text: `sync conflict on ${d.key}: ${plan.conflicts.map((c) => `${FIELD_LABEL[c.field]} (${c.winner} won)`).join(', ')}`,
        });
      }
      // What GitHub looks like now becomes the new common ground; whatever Ticket Forge still
      // differs in is written to GitHub next (sync) or at the next sync (import).
      const stale =
        JSON.stringify(d.github.base) !== JSON.stringify(mapped) ||
        d.github.updatedAt !== g.updatedAt ||
        d.github.nodeId !== g.nodeId;
      d.github = { ...d.github, ...meta() };
      // A Jira-style body is rewritten whole, so the layout stays around the new description.
      if ('description' in plan.push && g.formatted)
        plan.push.description = ticketBody(d, epics.find((e) => e.id === d.epicId)?.title || '');
      if (Object.keys(plan.push).length && mode === 'sync')
        pushes.push({ id: d.id, key: d.key, number: g.number, fields: plan.push });
      if (applied.length || plan.conflicts.length || stale) {
        rows.push({ id: d.id, pos: row.position, data: d });
        if (row.data.status !== d.status) moved.push({ id: d.id, data: d });
      }
      if (applied.length || plan.conflicts.length) result.updated++;
      else result.unchanged++;
    }

    if (rows.length)
      await t.query(
        `insert into issues (project_id, id, position, data, updated_by, updated_at, rev)
        select $1, x.id, x.pos, x.data, $3, now(), $4 from jsonb_to_recordset($2::jsonb) as x(id text, pos float8, data jsonb)
        on conflict (project_id, id) do update set data = excluded.data, position = excluded.position, updated_by = excluded.updated_by, updated_at = now(), rev = excluded.rev`,
        [projectId, JSON.stringify(rows), user.id, pr.version],
      );
    // A status change saves the whole issue as a new version (the same rule as a status change in
    // the app).
    if (moved.length) await insertVersions(t, projectId, moved, user);
    const section = {
      ...link,
      lastSyncAt: now,
      last: { mode, at: now, by: user.name || '', ...result, epicsCreated: result.epicsCreated.length },
    };
    const set: any = { githubSync: section };
    if (epicsChanged) set.epics = epics;
    await t.query(
      'update projects set data = data || $2::jsonb, revs = revs || $3::jsonb, stats = coalesce($4::jsonb, stats) where id = $1',
      [
        projectId,
        JSON.stringify(set),
        JSON.stringify(Object.fromEntries(Object.keys(set).map((k) => [k, pr.version]))),
        epicsChanged ? JSON.stringify(statsOf({ epics })) : null,
      ],
    );
    const summary = `${mode === 'sync' ? 'synced' : 'imported'} GitHub issues from ${link.repo}: ${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged${result.conflicts ? `, ${result.conflicts} conflict${result.conflicts === 1 ? '' : 's'}` : ''}`;
    const list = [{ kind: 'project', target: '', text: summary }, ...events].slice(0, 25);
    await t.query(
      `insert into activity (project_id, version, user_id, author, kind, target, text)
      select $1, $2, $3, $4, x.kind, x.target, x.text from jsonb_to_recordset($5::jsonb) as x(kind text, target text, text text)`,
      [projectId, pr.version, user.id, user.name || '', JSON.stringify(list)],
    );
    return pr.version;
  });
  noteVersion(projectId, version);
  if (pushes.length) await pushToGithub(user, projectId, link, token, pushes, result);
  if (link.project?.id) {
    const plan = (v: PlanInput, fields: string[]) => planFields(fields, fields, v);
    try {
      await syncBoard({ user, projectId, link, token, mode, plan }, result);
    } catch (e: any) {
      result.errors.push(`GitHub Project: ${e.message}`);
    }
  }
  return result;
}

/**
 * Writes Ticket Forge's side of the changes to GitHub, then records what GitHub now has as the
 * common ground. A failed issue is reported and tried again at the next sync.
 */
async function pushToGithub(user: any, projectId: string, link: any, token: string, pushes: any[], result: any) {
  const done: any[] = [];
  for (const p of pushes) {
    const body = pushBody(p.fields);
    if (!Object.keys(body).length) continue;
    try {
      const { data } = await gh(`repos/${link.repo}/issues/${p.number}`, token, { method: 'PATCH', body });
      done.push({ id: p.id, issue: fromGithub(data) });
      result.pushed++;
    } catch (e: any) {
      result.errors.push(`${p.key}: ${e.message}`);
      if (e.status === 429) break; // the rest would be refused too
    }
  }
  if (!done.length && !result.errors.length) return;
  const version = await tx(async (t) => {
    const pr = (
      await t.query(
        'update projects set version = version + 1, updated_at = now() where id = $1 and archived_at is null returning version, data',
        [projectId],
      )
    ).rows[0];
    if (!pr) return null;
    const members: any[] = Array.isArray(pr.data?.members) ? pr.data.members : [];
    const person = (login: string) =>
      members.find((m) => String(m?.name || '').toLowerCase() === login.toLowerCase())?.name || login;
    const now = new Date().toISOString();
    for (const x of done) {
      const g: any = x.issue;
      const row = (
        await t.query('select data from issues where project_id = $1 and id = $2', [projectId, x.id])
      ).rows[0];
      if (!row) continue;
      const base = {
        title: g.title,
        description: g.description,
        labels: g.labels,
        assignee: g.assigneeLogin ? person(g.assigneeLogin) : '',
        milestone: g.milestone,
        state: g.state,
      };
      const d = { ...row.data, github: { ...row.data.github, updatedAt: g.updatedAt, syncedAt: now, base } };
      await t.query(
        'update issues set data = $3, updated_by = $4, updated_at = now(), rev = $5 where project_id = $1 and id = $2',
        [projectId, x.id, JSON.stringify(d), user.id, pr.version],
      );
    }
    const section = {
      ...(pr.data?.githubSync || link),
      last: { ...(pr.data?.githubSync?.last || {}), pushed: result.pushed, errors: result.errors },
    };
    await t.query(
      "update projects set data = data || jsonb_build_object('githubSync', $2::jsonb), revs = revs || jsonb_build_object('githubSync', $3::int) where id = $1",
      [projectId, JSON.stringify(section), pr.version],
    );
    if (result.pushed)
      await t.query(
        "insert into activity (project_id, version, user_id, author, kind, target, text) values ($1,$2,$3,$4,'project','',$5)",
        [projectId, pr.version, user.id, user.name || '', `wrote ${result.pushed} ticket change${result.pushed === 1 ? '' : 's'} to GitHub (${link.repo})`],
      );
    return pr.version;
  });
  if (version) noteVersion(projectId, version);
}

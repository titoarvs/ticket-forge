// AI helper of a project (the chat panel on the project page): search tickets, generate tickets and
// assign tickets.
// Every action checks, on the server, that the person can open the project (a project on someone's
// access list, i.e. their workspace_members.project_access, is closed to everyone else) and that
// the project's per-person helper setting allows the action (helper_perms: search is on by default,
// generate and assign are off until a project administrator turns them on; workspace owners can do
// everything). Generated tickets are saved as drafts (ticket_drafts) and are not issues until a
// person approves them; assigning only accepts people who can open the project.
import { q, tx } from './db';
import { HttpError, listUsers, newId } from './auth';
import { canAccess, has, requireProject, requirePerm, getProject, noteVersion } from './store';
import { uid } from './model';

export const HELPER_ACTIONS = ['search', 'generate', 'assign'];
const DEFAULTS = { search: true, generate: false, assign: false };
const LABEL = { search: 'search tickets', generate: 'generate tickets', assign: 'assign tickets' };
const MAX_RESULTS = 20;
const IDEA_MIN = 5;
const IDEA_MAX = 2000;

const permsOf = (r) => ({
  search: Boolean(r.can_search),
  generate: Boolean(r.can_generate),
  assign: Boolean(r.can_assign),
});

/**
 * What the person may do with the helper in this project: owners everything, others their saved
 * setting or the defaults.
 */
export async function helperPerms(projectId: string, user) {
  if (user?.is_owner) return { search: true, generate: true, assign: true };
  const r = (
    await q(
      'select can_search, can_generate, can_assign from helper_perms where project_id = $1 and user_id = $2',
      [projectId, user?.id],
    )
  ).rows[0];
  return r ? permsOf(r) : { ...DEFAULTS };
}

/**
 * The check every helper action starts with: the person must be able to open the project (404 like
 * any project they can't see, and nothing about it is returned) and, when an action is named, be
 * allowed to do it here (403 with a message the chat shows). Returns their helper settings.
 */
export async function requireHelper(user, projectId: string, action?: string) {
  await requireProject(user, projectId);
  const perms = await helperPerms(projectId, user);
  if (action && !perms[action])
    throw new HttpError(
      403,
      `You’re not allowed to ${LABEL[action]} with the helper in this project. Ask a project administrator to turn it on for you.`,
    );
  return perms;
}

/**
 * Setting the helper's permissions is for people who may edit the project's settings (and workspace
 * owners).
 */
export const canManageHelper = (user) => has(user, 'project.settings');

/**
 * People who can open the project (active, on its access list or with access to all projects): the
 * only ones who can be assigned tickets.
 */
export async function eligiblePeople(projectId: string) {
  return (await listUsers())
    .filter(
      (u: any) =>
        u.status === 'active' &&
        canAccess({ is_owner: u.isOwner, project_access: u.projectAccess }, projectId),
    )
    .map((u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.roleName }));
}

const draftOut = (r) => ({
  id: r.id,
  idea: r.idea,
  status: r.status,
  createdBy: r.created_by_name,
  createdAt: r.created_at,
  ticket: r.data,
});
async function listDrafts(projectId: string) {
  const { rows } = await q(
    "select * from ticket_drafts where project_id = $1 and status = 'draft' order by created_at desc limit 100",
    [projectId],
  );
  return rows.map(draftOut);
}

/**
 * What the panel needs on open: the person's settings, whether they can change settings, the open
 * drafts and who can be assigned.
 */
export async function helperState(projectId: string, user) {
  const permissions = await requireHelper(user, projectId);
  const canManage = canManageHelper(user);
  return {
    permissions,
    canManage,
    drafts: await listDrafts(projectId),
    people: permissions.assign || canManage ? await eligiblePeople(projectId) : [],
  };
}

// ---------------------------------------------------------------- search
/**
 * Issues of this project whose key, title, user story or description contain the text. Drafts are
 * not issues, so they never show.
 */
export async function searchTickets(projectId: string, user, query: string) {
  await requireHelper(user, projectId, 'search');
  const text = String(query || '')
    .trim()
    .slice(0, 200);
  if (!text) throw new HttpError(400, 'Type what to look for.');
  const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { rows } = await q(
    `select data from issues where project_id = $1
      and concat_ws(' ', data->>'key', data->>'title', data->>'userStory', data->>'description') ilike $2
    order by position limit ${MAX_RESULTS + 1}`,
    [projectId, like],
  );
  return {
    tickets: rows.slice(0, MAX_RESULTS).map((r) => ({
      id: r.data.id,
      key: r.data.key,
      title: r.data.title,
      type: r.data.type,
      status: r.data.status,
      assignee: r.data.assignee || '',
    })),
    more: rows.length > MAX_RESULTS,
  };
}

// ---------------------------------------------------------------- generate (drafts)
/**
 * Writes one ticket for the idea with the AI and saves it as a draft. Nothing is written to issues:
 * the draft waits for approveDraft. `write` is the AI call (the same one as New issue); tests stand
 * it in.
 */
export async function generateDraft(
  projectId: string,
  user,
  input: any,
  write?: (a: any) => Promise<any>,
) {
  await requireHelper(user, projectId, 'generate');
  const idea = String(input?.idea || '').trim();
  if (idea.length < IDEA_MIN)
    throw new HttpError(400, 'Describe the ticket you want in a sentence.');
  if (idea.length > IDEA_MAX)
    throw new HttpError(400, `Keep the idea under ${IDEA_MAX} characters.`);
  const project = await getProject(projectId);
  const epicId = input?.epicId ? String(input.epicId) : null;
  if (epicId && !(project.epics || []).some((e: any) => e.id === epicId))
    throw new HttpError(400, 'That epic isn’t in this project.');
  const run = write || (await import('./generate')).newTicket;
  const { ticket } = await run({ epicId, project, idea, answers: '', ai: input?.ai || {} });
  const id = newId();
  const { id: _i, key: _k, ...data } = ticket || {};
  await q(
    'insert into ticket_drafts (project_id, id, idea, data, created_by, created_by_name) values ($1,$2,$3,$4,$5,$6)',
    [projectId, id, idea, JSON.stringify({ ...data, epicId }), user.id, user.name || ''],
  );
  return {
    draft: draftOut(
      (await q('select * from ticket_drafts where project_id = $1 and id = $2', [projectId, id]))
        .rows[0],
    ),
  };
}

/**
 * Writes one issue inside a transaction that already took the project's version (`pr`, the row
 * `update projects set version = version + 1 … returning version, data`): next key, first workflow
 * status, at the end of the backlog, with rev and updated_by set like any issue save. `data` is the
 * ticket's fields (id and key are made here). Shared by approveDraft and the chatbot (lib/chat.ts),
 * so both write issues the same way.
 */
export async function insertIssue(t, projectId: string, pr, user, data, via: string) {
  const prefix = String(
    (await t.query('select key from projects where id = $1', [projectId])).rows[0].key,
  );
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  const rows = (
    await t.query("select data->>'key' as key, position from issues where project_id = $1", [
      projectId,
    ])
  ).rows;
  const max = rows.reduce(
    (m, r) => Math.max(m, Number(String(r.key || '').match(re)?.[1] || 0)),
    0,
  );
  const maxPos = rows.reduce((m, r) => Math.max(m, Number(r.position)), -1);
  const now = new Date().toISOString();
  const epics = Array.isArray(pr.data?.epics) ? pr.data.epics : [];
  const issue = {
    ...data,
    id: uid(),
    key: `${prefix}-${max + 1}`,
    epicId: epics.some((e: any) => e.id === data.epicId) ? data.epicId : null,
    sprintId: null,
    parentId: null,
    status: pr.data?.workflow?.[0]?.name || 'To Do',
    assignee: '',
    reporter: user.name || '',
    links: [],
    prs: [],
    comments: [],
    history: [
      {
        id: uid(),
        at: now,
        author: user.name || '',
        field: 'created',
        text: `created the issue from ${via}`,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  await t.query(
    'insert into issues (project_id, id, position, data, updated_by, updated_at, rev) values ($1,$2,$3,$4,$5,now(),$6)',
    [projectId, issue.id, maxPos + 1, JSON.stringify(issue), user.id, pr.version],
  );
  return issue;
}

/**
 * Approves a draft: it becomes an issue (next key, first workflow status, at the end of the
 * backlog) in one transaction that also takes the project's version, so other people's browsers
 * pick it up. Needs the issue.create permission.
 */
export async function approveDraft(projectId: string, draftId: string, user) {
  await requireHelper(user, projectId);
  requirePerm(user, 'issue.create');
  const out = await tx(async (t) => {
    const pr = (
      await t.query(
        'update projects set version = version + 1, updated_at = now() where id = $1 and archived_at is null returning version, data',
        [projectId],
      )
    ).rows[0];
    if (!pr) throw new HttpError(404, 'Project not found');
    const d = (
      await t.query('select * from ticket_drafts where project_id = $1 and id = $2 for update', [
        projectId,
        draftId,
      ])
    ).rows[0];
    if (!d) throw new HttpError(404, 'Draft not found');
    if (d.status !== 'draft') throw new HttpError(409, `That draft was already ${d.status}.`);
    const issue = await insertIssue(t, projectId, pr, user, d.data, 'an AI helper draft');
    await t.query(
      "update ticket_drafts set status = 'approved', decided_by = $3, decided_at = now(), issue_id = $4 where project_id = $1 and id = $2",
      [projectId, draftId, user.id, issue.id],
    );
    await t.query(
      "insert into activity (project_id, version, user_id, author, kind, target, text) values ($1,$2,$3,$4,'issue',$5,$6)",
      [
        projectId,
        pr.version,
        user.id,
        user.name || '',
        issue.key,
        `approved the AI draft as ${issue.key} “${String(issue.title).slice(0, 120)}”`,
      ],
    );
    return { version: pr.version, issue: { id: issue.id, key: issue.key, title: issue.title } };
  });
  noteVersion(projectId, out.version);
  return out;
}

/**
 * Discards a draft: it never becomes an issue. The person who generated it, or anyone who may
 * create issues, can.
 */
export async function discardDraft(projectId: string, draftId: string, user) {
  await requireHelper(user, projectId);
  const d = (
    await q('select created_by, status from ticket_drafts where project_id = $1 and id = $2', [
      projectId,
      draftId,
    ])
  ).rows[0];
  if (!d) throw new HttpError(404, 'Draft not found');
  if (d.created_by !== user.id) requirePerm(user, 'issue.create');
  if (d.status !== 'draft') throw new HttpError(409, `That draft was already ${d.status}.`);
  await q(
    "update ticket_drafts set status = 'discarded', decided_by = $3, decided_at = now() where project_id = $1 and id = $2 and status = 'draft'",
    [projectId, draftId, user.id],
  );
  return { ok: true };
}

// ---------------------------------------------------------------- assign
/**
 * Assigns an approved ticket (an issue, by key or id) to a person who can open the project. A draft
 * is refused until it is approved, and so is anyone who isn't in the project. Saved like any issue
 * change (new project version, history entry).
 */
export async function assignTicket(projectId: string, user, input: any) {
  await requireHelper(user, projectId, 'assign');
  const ref = String(input?.ticket || '').trim();
  if (!ref) throw new HttpError(400, 'Say which ticket to assign (for example its key).');
  const person = (await eligiblePeople(projectId)).find(
    (p) => p.id === String(input?.assigneeId || ''),
  );
  if (!person)
    throw new HttpError(
      400,
      'That person isn’t a member of this project, so they can’t be assigned tickets.',
    );
  const found = (
    await q(
      "select id from issues where project_id = $1 and (id = $2 or upper(data->>'key') = upper($2))",
      [projectId, ref],
    )
  ).rows[0];
  if (!found) {
    const draft = (
      await q(
        "select 1 from ticket_drafts where project_id = $1 and id = $2 and status = 'draft'",
        [projectId, ref],
      )
    ).rows[0];
    throw draft
      ? new HttpError(409, 'That ticket is still a draft. Approve it first, then assign it.')
      : new HttpError(404, `No ticket “${ref}” in this project.`);
  }
  let change: any = null;
  const version = await tx(async (t) => {
    const pr = (
      await t.query(
        'update projects set version = version + 1, updated_at = now() where id = $1 and archived_at is null returning version',
        [projectId],
      )
    ).rows[0];
    if (!pr) throw new HttpError(404, 'Project not found');
    const row = (
      await t.query('select data from issues where project_id = $1 and id = $2 for update', [
        projectId,
        found.id,
      ])
    ).rows[0];
    if (!row) throw new HttpError(404, `No ticket “${ref}” in this project.`);
    const d = row.data;
    const was = d.assignee || '';
    const now = new Date().toISOString();
    d.assignee = person.name;
    d.updatedAt = now;
    d.history = [
      ...(d.history || []),
      {
        id: uid(),
        at: now,
        author: user.name || '',
        field: 'assignee',
        from: was || 'Unassigned',
        to: person.name,
      },
    ];
    await t.query(
      'update issues set data = $3, rev = $4, updated_by = $5, updated_at = now() where project_id = $1 and id = $2',
      [projectId, found.id, JSON.stringify(d), pr.version, user.id],
    );
    if (was !== person.name)
      change = {
        issueId: d.id,
        key: d.key,
        title: d.title,
        assignee: person.name,
        assigneeChanged: true,
        priority: d.priority,
      };
    return { number: pr.version, key: d.key, title: d.title };
  });
  noteVersion(projectId, version.number);
  if (change) {
    // The save is done: a failed notification must not undo or fail it.
    try {
      await (
        await import('./notify')
      ).notifyIssueChanges({ projectId, actor: user, changes: [change] });
    } catch (e) {
      console.error('Could not send the assignment notification', e);
    }
  }
  return {
    ticket: { id: found.id, key: version.key, title: version.title, assignee: person.name },
  };
}

// ---------------------------------------------------------------- per-person settings
/**
 * Everyone who can open the project with their helper settings (for the people who manage them).
 */
export async function listHelperPerms(projectId: string, user) {
  await requireHelper(user, projectId);
  if (!canManageHelper(user))
    throw new HttpError(
      403,
      'You don’t have permission to change who can use the helper (project.settings).',
    );
  const saved = new Map(
    (await q('select * from helper_perms where project_id = $1', [projectId])).rows.map((r) => [
      r.user_id,
      permsOf(r),
    ]),
  );
  const owners = new Set((await listUsers()).filter((u: any) => u.isOwner).map((u: any) => u.id));
  return (await eligiblePeople(projectId)).map((p) => ({
    ...p,
    owner: owners.has(p.id),
    permissions: owners.has(p.id)
      ? { search: true, generate: true, assign: true }
      : saved.get(p.id) || { ...DEFAULTS },
  }));
}

/**
 * Saves one person's helper settings for this project; only for people who can open the project.
 */
export async function setHelperPerms(projectId: string, user, userId: string, perms: any) {
  await requireHelper(user, projectId);
  if (!canManageHelper(user))
    throw new HttpError(
      403,
      'You don’t have permission to change who can use the helper (project.settings).',
    );
  if (!(await eligiblePeople(projectId)).some((p) => p.id === userId))
    throw new HttpError(400, 'That person isn’t a member of this project.');
  const next = Object.fromEntries(HELPER_ACTIONS.map((a) => [a, perms?.[a] === true]));
  await q(
    `insert into helper_perms (project_id, user_id, can_search, can_generate, can_assign, updated_by, updated_at) values ($1,$2,$3,$4,$5,$6,now())
    on conflict (project_id, user_id) do update set can_search = excluded.can_search, can_generate = excluded.can_generate,
      can_assign = excluded.can_assign, updated_by = excluded.updated_by, updated_at = now()`,
    [projectId, userId, next.search, next.generate, next.assign, user.id],
  );
  return { userId, permissions: next };
}

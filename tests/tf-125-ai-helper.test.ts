// TF-125: the project's AI helper (search, generate and assign tickets). Run with `npm test`.
// The data tests use the embedded PostgreSQL (PGlite) in a temporary folder, never a real database,
// and the AI is stood in.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-helper-'));
process.env.TICKETFORGE_DATA = dir;
process.env.DATABASE_URL = '';
process.env.SUPABASE_DB_URL = '';

let H: typeof import('../lib/helper');
let D: typeof import('../lib/db');

const WS = 'default';
const user = (id: string, extra: any = {}) => ({
  id,
  name: `Name ${id}`,
  is_owner: false,
  project_access: ['p1'],
  permissions: ['issue.create', 'ai.use'],
  workspace_id: WS,
  ...extra,
});
const owner = user('u-owner', { is_owner: true, project_access: 'all' });
const searcher = user('u-search'); // no helper row: search only
const generator = user('u-gen');
const assigner = user('u-assign');
const outsider = user('u-out', { project_access: ['p2'] }); // not on p1's list
const as = <T>(fn: () => Promise<T>) => D.asWorkspace(WS, fn);
const stand = async ({ idea }: any) => ({
  ticket: {
    id: 'ai-id',
    key: 'AI-1',
    title: `Ticket for ${idea}`,
    type: 'Story',
    priority: 'Medium',
    description: idea,
    testCases: [],
  },
});
const issueKeys = async () =>
  (
    await D.q("select data->>'key' as k from issues where project_id = 'p1' order by position")
  ).rows.map((r) => r.k);

before(async () => {
  D = await import('../lib/db');
  H = await import('../lib/helper');
  const auth = await import('../lib/auth');
  await D.migrate();
  await auth.seedRoles();
  await D.q(
    "insert into workspaces (id, name) values ($1, 'Test workspace') on conflict (id) do nothing",
    [WS],
  );
  for (const u of [owner, searcher, generator, assigner, outsider]) {
    await D.q(
      "insert into users (id, email, name, password_hash, role_id, status) values ($1,$2,$3,'x','admin','active')",
      [u.id, `${u.id}@x.test`, u.name],
    );
    await D.q(
      "insert into workspace_members (workspace_id, user_id, role_id, project_access, is_owner) values ($1,$2,'admin',$3,$4)",
      [WS, u.id, JSON.stringify(u.project_access), u.is_owner],
    );
  }
  await D.q(
    "insert into projects (id, name, key, data, created_by, workspace_id) values ('p1','Shop','SH',$1,$2,$3)",
    [
      JSON.stringify({
        name: 'Shop',
        key: 'SH',
        epics: [{ id: 'e1', title: 'Accounts' }],
        workflow: [{ name: 'To Do', category: 'todo' }],
      }),
      owner.id,
      WS,
    ],
  );
  await D.q(
    "insert into projects (id, name, key, data, created_by, workspace_id) values ('p2','Other','OT','{}',$1,$2)",
    [owner.id, WS],
  );
  const rows = [
    { id: 'i1', key: 'SH-1', title: 'Login page', description: 'Users sign in', status: 'To Do' },
    {
      id: 'i2',
      key: 'SH-2',
      title: 'Checkout',
      description: 'Pay for the cart; login required',
      status: 'To Do',
    },
    { id: 'i3', key: 'SH-3', title: 'Reports', description: 'Monthly numbers', status: 'To Do' },
  ];
  for (const [pos, r] of rows.entries())
    await D.q('insert into issues (project_id, id, position, data) values ($1,$2,$3,$4)', [
      'p1',
      r.id,
      pos,
      JSON.stringify(r),
    ]);
  await D.q("insert into issues (project_id, id, position, data) values ('p2','x1',0,$1)", [
    JSON.stringify({ id: 'x1', key: 'OT-1', title: 'Login elsewhere' }),
  ]);
  await as(async () => {
    await H.setHelperPerms('p1', owner, generator.id, { search: true, generate: true });
    await H.setHelperPerms('p1', owner, assigner.id, { search: true, assign: true });
  });
});
after(async () => {
  await (await D.db()).close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- AC 2: search
test('AC2: a person with search permission finds this project’s tickets by title or content', () =>
  as(async () => {
    const r = await H.searchTickets('p1', searcher, 'login');
    assert.deepEqual(
      r.tickets.map((t) => t.key),
      ['SH-1', 'SH-2'],
    );
  }));

test('AC2: search never returns tickets of another project and treats % and _ as plain text', () =>
  as(async () => {
    assert.equal((await H.searchTickets('p1', searcher, 'elsewhere')).tickets.length, 0);
    assert.equal((await H.searchTickets('p1', searcher, '%')).tickets.length, 0);
  }));

test('AC2: search refuses a person whose search setting is off', () =>
  as(async () => {
    await H.setHelperPerms('p1', owner, searcher.id, { search: false });
    await assert.rejects(H.searchTickets('p1', searcher, 'login'), /not allowed to search/);
    await H.setHelperPerms('p1', owner, searcher.id, { search: true });
  }));

// ---------------------------------------------------------------- AC 3 and 4: generate, drafts
test('AC3: without generate permission the helper refuses and no draft is created', () =>
  as(async () => {
    await assert.rejects(
      H.generateDraft('p1', searcher, { idea: 'Reset password by email' }, stand),
      (e: any) => e.status === 403 && /not allowed to generate/.test(e.message),
    );
    assert.equal((await D.q('select count(*)::int n from ticket_drafts')).rows[0].n, 0);
  }));

test('AC4: a generated ticket is stored as a draft and is not in the issues until it is approved', () =>
  as(async () => {
    const was = await issueKeys();
    const { draft } = await H.generateDraft(
      'p1',
      generator,
      { idea: 'Reset password by email', epicId: 'e1' },
      stand,
    );
    assert.equal(draft.status, 'draft');
    assert.deepEqual(await issueKeys(), was);
    assert.equal((await H.helperState('p1', searcher)).drafts.length, 1);
    assert.equal((await H.searchTickets('p1', searcher, 'Reset password')).tickets.length, 0);
    // Approving moves it to the issues.
    const done = await H.approveDraft('p1', draft.id, generator);
    assert.equal(done.issue.key, 'SH-4');
    assert.deepEqual(await issueKeys(), [...was, 'SH-4']);
    assert.equal((await H.helperState('p1', searcher)).drafts.length, 0);
    await assert.rejects(H.approveDraft('p1', draft.id, generator), /already approved/);
  }));

test('AC4: a discarded draft never becomes an issue', () =>
  as(async () => {
    const was = await issueKeys();
    const { draft } = await H.generateDraft(
      'p1',
      generator,
      { idea: 'Export everything as CSV' },
      stand,
    );
    await H.discardDraft('p1', draft.id, generator);
    await assert.rejects(H.approveDraft('p1', draft.id, owner), /already discarded/);
    assert.deepEqual(await issueKeys(), was);
  }));

test('AC4: the idea is checked and an epic outside the project is refused', () =>
  as(async () => {
    await assert.rejects(
      H.generateDraft('p1', generator, { idea: 'hi' }, stand),
      /Describe the ticket/,
    );
    await assert.rejects(
      H.generateDraft('p1', generator, { idea: 'A valid idea here', epicId: 'nope' }, stand),
      /epic/,
    );
  }));

// ---------------------------------------------------------------- AC 5: access
test('AC5: a person who is not on the project’s access list is denied everything and gets no project data', () =>
  as(async () => {
    const denied = (e: any) => e.status === 404 && !/Shop/.test(e.message);
    await assert.rejects(H.helperState('p1', outsider), denied);
    await assert.rejects(H.searchTickets('p1', outsider, 'login'), denied);
    await assert.rejects(
      H.generateDraft('p1', outsider, { idea: 'Anything at all' }, stand),
      denied,
    );
    await assert.rejects(
      H.assignTicket('p1', outsider, { ticket: 'SH-1', assigneeId: owner.id }),
      denied,
    );
    await assert.rejects(H.approveDraft('p1', 'any', outsider), denied);
    await assert.rejects(H.listHelperPerms('p1', outsider), denied);
  }));

test('AC5: even a person with the helper setting turned on is denied when they are not in the project', () =>
  as(async () => {
    await D.q(
      "insert into helper_perms (project_id, user_id, can_search, can_generate, can_assign) values ('p1',$1,true,true,true)",
      [outsider.id],
    );
    await assert.rejects(H.searchTickets('p1', outsider, 'login'), /Project not found/);
  }));

// ---------------------------------------------------------------- AC 6: assign
test('AC6: only people who can open the project are offered, and an assignment to anyone else is refused', () =>
  as(async () => {
    const state = await H.helperState('p1', assigner);
    const ids = state.people.map((p) => p.id);
    assert.ok(ids.includes(assigner.id) && ids.includes(owner.id));
    assert.ok(!ids.includes(outsider.id), 'the non-member is not in the picker');
    await assert.rejects(
      H.assignTicket('p1', assigner, { ticket: 'SH-1', assigneeId: outsider.id }),
      /isn’t a member/,
    );
    assert.equal(
      (await D.q("select data->>'assignee' a from issues where project_id='p1' and id='i1'"))
        .rows[0].a,
      null,
    );
  }));

test('AC6: a person with assign permission assigns an approved ticket to a project member and it is saved', () =>
  as(async () => {
    const r = await H.assignTicket('p1', assigner, { ticket: 'sh-1', assigneeId: generator.id });
    assert.equal(r.ticket.assignee, generator.name);
    const row = (await D.q("select data from issues where project_id='p1' and id='i1'")).rows[0]
      .data;
    assert.equal(row.assignee, generator.name);
    assert.equal(row.history.at(-1).field, 'assignee');
  }));

test('AC6: assigning needs the assign setting, and a draft cannot be assigned before it is approved', () =>
  as(async () => {
    await assert.rejects(
      H.assignTicket('p1', generator, { ticket: 'SH-1', assigneeId: owner.id }),
      /not allowed to assign/,
    );
    const { draft } = await H.generateDraft(
      'p1',
      generator,
      { idea: 'Dark mode for the app' },
      stand,
    );
    await assert.rejects(
      H.assignTicket('p1', assigner, { ticket: draft.id, assigneeId: generator.id }),
      /still a draft/,
    );
    await assert.rejects(
      H.assignTicket('p1', assigner, { ticket: 'SH-999', assigneeId: generator.id }),
      /No ticket/,
    );
  }));

// ---------------------------------------------------------------- settings
test('Settings: only people who can edit the project settings change who may use the helper', () =>
  as(async () => {
    await assert.rejects(
      H.setHelperPerms('p1', generator, searcher.id, { search: true, generate: true }),
      /permission/,
    );
    await assert.rejects(
      H.setHelperPerms('p1', owner, outsider.id, { search: true }),
      /isn’t a member/,
    );
    const list = await H.listHelperPerms('p1', owner);
    assert.ok(!list.some((p) => p.id === outsider.id));
    assert.deepEqual(list.find((p) => p.id === searcher.id)!.permissions, {
      search: true,
      generate: false,
      assign: false,
    });
  }));

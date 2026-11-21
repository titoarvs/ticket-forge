// TF-136: two-way sync of Status, Priority, story points and Sprint ↔ Iteration with a linked
// GitHub Project board. Run with `npm test`. Embedded PostgreSQL (PGlite) in a temporary folder
// and a fake GitHub (REST and GraphQL; fetch is replaced), so nothing leaves this computer.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-gh-board-'));
process.env.TICKETFORGE_DATA = dir;
process.env.DATABASE_URL = '';
process.env.SUPABASE_DB_URL = '';
process.env.GITHUB_TOKEN = 'test-token';

let G: typeof import('../lib/github-sync');
let L: typeof import('../lib/github-project/link');
let V: typeof import('../lib/github-project/values');
let D: typeof import('../lib/db');

const WS = 'default';
const REPO = 'acme/shop';
const BOARD_ID = 'PVT_1';
const as = <T>(fn: () => Promise<T>) => D.asWorkspace(WS, fn);
const owner = { id: 'u-owner', name: 'Olive Owner', workspace_id: WS, is_owner: false };
const member = { id: 'u-member', name: 'Mia Member', workspace_id: WS, is_owner: false };
const T = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
const WORKFLOW = [
  { name: 'To Do', category: 'todo' },
  { name: 'In Progress', category: 'inprogress' },
  { name: 'In Review', category: 'inprogress' },
  { name: 'Done', category: 'done' },
];
const SPRINTS = [
  { id: 's1', name: 'Sprint 1' },
  { id: 's2', name: 'Sprint 2' },
];

// ---------------------------------------------------------------- a fake GitHub
const FIELDS = [
  { __typename: 'ProjectV2Field', id: 'F_title', name: 'Title', dataType: 'TITLE' },
  {
    __typename: 'ProjectV2SingleSelectField',
    id: 'F_status',
    name: 'Status',
    dataType: 'SINGLE_SELECT',
    options: ['Todo', 'In Progress', 'Done'].map((n) => ({ id: `o_${n}`, name: n })),
  },
  {
    __typename: 'ProjectV2SingleSelectField',
    id: 'F_prio',
    name: 'Priority',
    dataType: 'SINGLE_SELECT',
    options: ['P0', 'P1', 'P2', 'P3'].map((n) => ({ id: `o_${n}`, name: n })),
  },
  { __typename: 'ProjectV2Field', id: 'F_points', name: 'Story Points', dataType: 'NUMBER' },
  {
    __typename: 'ProjectV2IterationField',
    id: 'F_sprint',
    name: 'Sprint',
    dataType: 'ITERATION',
    configuration: {
      iterations: [{ id: 'i_2', title: 'Sprint 2' }],
      completedIterations: [{ id: 'i_1', title: 'Sprint 1' }],
    },
  },
];
const optionName = (id: string) =>
  FIELDS.flatMap((f: any) =>
    [
      ...(f.options || []),
      ...(f.configuration?.iterations || []),
      ...(f.configuration?.completedIterations || []),
    ].map((o: any) => [o.id, o.name || o.title]),
  ).find(([x]) => x === id)?.[1];

let issues: any[] = [];
let items: any[] = [];
let calls: string[] = [];
let scopeError = false;
const issue = (number: number) => ({
  number,
  node_id: `I_${number}`,
  title: `Issue ${number}`,
  body: '',
  state: 'open',
  labels: [],
  assignee: null,
  milestone: null,
  html_url: `https://github.com/${REPO}/issues/${number}`,
  created_at: T(0),
  updated_at: T(1),
});
const item = (number: number, values: any, updatedAt = T(2)) => ({
  id: `PVTI_${number}`,
  number,
  updatedAt,
  values,
});
const valueNodes = (it: any) =>
  [
    it.values.status && {
      __typename: 'ProjectV2ItemFieldSingleSelectValue',
      name: it.values.status,
      field: { id: 'F_status' },
    },
    it.values.priority && {
      __typename: 'ProjectV2ItemFieldSingleSelectValue',
      name: it.values.priority,
      field: { id: 'F_prio' },
    },
    typeof it.values.points === 'number' && {
      __typename: 'ProjectV2ItemFieldNumberValue',
      number: it.values.points,
      field: { id: 'F_points' },
    },
    it.values.sprint && {
      __typename: 'ProjectV2ItemFieldIterationValue',
      title: it.values.sprint,
      field: { id: 'F_sprint' },
    },
  ].filter(Boolean);
const FIELD_KEY: any = {
  F_status: 'status',
  F_prio: 'priority',
  F_points: 'points',
  F_sprint: 'sprint',
};

function graphql(query: string, v: any) {
  const op = query.match(/(?:query|mutation) (\w+)/)?.[1] || '';
  calls.push(op);
  if (scopeError) return { errors: [{ type: 'INSUFFICIENT_SCOPES', message: 'needs project' }] };
  const board = {
    id: BOARD_ID,
    number: 3,
    title: 'Shop board',
    url: 'https://github.com/orgs/acme/projects/3',
    closed: false,
  };
  if (op === 'Boards')
    return {
      data: {
        repository: { projectsV2: { nodes: [board] } },
        repositoryOwner: {
          projectsV2: { nodes: [board, { ...board, id: 'PVT_old', number: 1, closed: true }] },
        },
      },
    };
  if (op === 'Board') return { data: { node: { ...board, fields: { nodes: FIELDS } } } };
  if (op === 'BoardItems')
    return {
      data: {
        node: {
          items: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: items.map((it) => ({
              id: it.id,
              updatedAt: it.updatedAt,
              content: {
                __typename: 'Issue',
                number: it.number,
                repository: { nameWithOwner: REPO },
              },
              fieldValues: { nodes: valueNodes(it) },
            })),
          },
        },
      },
    };
  if (op === 'AddBoardItem') {
    const n = Number(String(v.content).replace('I_', ''));
    const it = item(n, { status: '', priority: '', points: null, sprint: '' }, T(50));
    items.push(it);
    return { data: { addProjectV2ItemById: { item: { id: it.id, updatedAt: it.updatedAt } } } };
  }
  if (op === 'SetBoardFields') {
    const it = items.find((x) => x.id === v.item);
    for (let i = 0; `f${i}` in v; i++) {
      const key = FIELD_KEY[v[`f${i}`]];
      const val = v[`v${i}`];
      it.values[key] = !val
        ? key === 'points'
          ? null
          : ''
        : (val.number ?? optionName(val.singleSelectOptionId || val.iterationId));
    }
    it.updatedAt = T(60);
    return { data: {} };
  }
  return { errors: [{ type: 'NOT_FOUND', message: `unknown ${op}` }] };
}

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = new URL(String(url));
  if (u.pathname === '/graphql') {
    const b = JSON.parse(init.body);
    return json(graphql(b.query, b.variables));
  }
  const route = u.pathname.slice(1);
  if (route === `repos/${REPO}`)
    return json({ full_name: REPO, private: true, html_url: `https://github.com/${REPO}` });
  if (route === `repos/${REPO}/issues` && (init.method || 'GET') === 'GET') return json(issues);
  if (route === `repos/${REPO}/issues` && init.method === 'POST') {
    const i = { ...issue(issues.length + 100), title: JSON.parse(init.body).title };
    issues.push(i);
    return json(i, 201);
  }
  return json({ message: 'Not Found' }, 404);
}) as any;

// ---------------------------------------------------------------- helpers
const tickets = async () =>
  (await D.q("select data from issues where project_id = 'p1' order by position")).rows.map(
    (r) => r.data,
  );
const setTicket = (id: string, patch: any) =>
  D.q("update issues set data = data || $2::jsonb where project_id = 'p1' and id = $1", [
    id,
    JSON.stringify(patch),
  ]);
const sync = (mode: 'import' | 'sync') => as(() => G.syncIssues(owner, 'p1', mode));
const linkAll = async () => {
  await as(() => G.linkRepo(owner, 'p1', REPO));
  await as(() => L.linkBoard(owner, 'p1', BOARD_ID));
};

before(async () => {
  D = await import('../lib/db');
  G = await import('../lib/github-sync');
  L = await import('../lib/github-project/link');
  V = await import('../lib/github-project/values');
  const A = await import('../lib/auth');
  await D.migrate();
  await A.seedRoles();
  await D.q("insert into workspaces (id, name) values ($1, 'WS') on conflict (id) do nothing", [
    WS,
  ]);
  for (const u of [owner, member])
    await D.q(
      "insert into users (id, email, name, password_hash, role_id, status) values ($1,$2,$3,'x','admin','active')",
      [u.id, `${u.id}@x.test`, u.name],
    );
});
beforeEach(async () => {
  issues = [];
  items = [];
  calls = [];
  scopeError = false;
  await D.q("delete from projects where id = 'p1'");
  await D.q(
    "insert into projects (id, name, key, data, created_by, workspace_id) values ('p1','Shop','SH',$1,$2,$3)",
    [
      JSON.stringify({
        name: 'Shop',
        key: 'SH',
        epics: [],
        members: [],
        workflow: WORKFLOW,
        sprints: SPRINTS,
      }),
      owner.id,
      WS,
    ],
  );
});
after(async () => {
  await (await D.db()).close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- mapping
test('statuses map by name, else by kind, and statuses sharing a column don’t flip', () => {
  const board: any = { fields: { status: { options: FIELDS[1].options } } };
  assert.equal(V.statusOption(board, 'To Do', WORKFLOW), 'Todo');
  assert.equal(V.statusOption(board, 'In Review', WORKFLOW), 'In Progress');
  assert.equal(V.statusOption(board, 'Done', WORKFLOW), 'Done');
  assert.equal(V.statusFor('Todo', WORKFLOW), 'To Do');
  const t = { status: 'In Review' };
  assert.deepEqual(V.applyValues(t, { status: 'In Progress' }, board, WORKFLOW, []), []);
  assert.equal(t.status, 'In Review');
});

test('priorities map to P0–P3 and back', () => {
  const board: any = { fields: { priority: { options: FIELDS[2].options } } };
  assert.equal(V.priorityOption(board, 'Highest'), 'P0');
  assert.equal(V.priorityOption(board, 'Medium'), 'P2');
  assert.equal(V.priorityFor('P1'), 'High');
  assert.equal(V.priorityFor('Urgent'), 'Highest');
});

// ---------------------------------------------------------------- linking
test('the boards of the repository and its owner are listed once, closed ones left out', async () => {
  await as(() => G.linkRepo(owner, 'p1', REPO));
  const { boards } = await as(() => L.boardsFor(owner, 'p1'));
  assert.deepEqual(
    boards.map((b: any) => b.id),
    [BOARD_ID],
  );
});

test('linking saves the board and which of its fields are mapped; others can’t link', async () => {
  await as(() => G.linkRepo(owner, 'p1', REPO));
  const { board } = await as(() => L.linkBoard(owner, 'p1', BOARD_ID));
  assert.deepEqual(board.fields, {
    status: 'Status',
    priority: 'Priority',
    points: 'Story Points',
    sprint: 'Sprint',
  });
  const saved = (await D.q("select data from projects where id = 'p1'")).rows[0].data.githubSync;
  assert.equal(saved.repo, REPO);
  assert.equal(saved.project.title, 'Shop board');
  await assert.rejects(
    as(() => L.linkBoard(member, 'p1', BOARD_ID)),
    /Only the project owner/,
  );
  await as(() => L.unlinkBoard(owner, 'p1'));
  assert.equal(
    (await D.q("select data from projects where id = 'p1'")).rows[0].data.githubSync.project,
    undefined,
  );
});

// ---------------------------------------------------------------- sync
test('an import copies the board’s values onto the tickets and writes nothing to GitHub', async () => {
  issues = [issue(1)];
  items = [item(1, { status: 'In Progress', priority: 'P1', points: 5, sprint: 'Sprint 2' })];
  await linkAll();
  const r: any = await sync('import');
  const [t] = await tickets();
  assert.deepEqual(
    [t.status, t.priority, t.storyPoints, t.sprintId],
    ['In Progress', 'High', 5, 's2'],
  );
  assert.equal(r.board.updated, 1);
  assert.ok(!calls.includes('SetBoardFields') && !calls.includes('AddBoardItem'));
});

test('a change made in Ticket Forge is written to the board, once', async () => {
  issues = [issue(1)];
  items = [item(1, { status: 'Todo', priority: 'P2', points: 3, sprint: 'Sprint 1' })];
  await linkAll();
  await sync('import');
  const [t] = await tickets();
  await setTicket(t.id, { priority: 'Highest', storyPoints: 8, sprintId: 's2', updatedAt: T(30) });
  calls = [];
  await sync('sync');
  assert.deepEqual(items[0].values, {
    status: 'Todo',
    priority: 'P0',
    points: 8,
    sprint: 'Sprint 2',
  });
  assert.equal(calls.filter((c) => c === 'SetBoardFields').length, 1);
  calls = [];
  await sync('sync');
  assert.ok(!calls.includes('SetBoardFields'), 'nothing left to write');
});

test('when both sides changed, the newer change wins and the conflict is recorded', async () => {
  issues = [issue(1)];
  items = [item(1, { status: 'Todo', priority: 'P2', points: null, sprint: '' })];
  await linkAll();
  await sync('import');
  const [t] = await tickets();
  await setTicket(t.id, { priority: 'Low', updatedAt: T(30) });
  items[0].values.priority = 'P1';
  items[0].updatedAt = T(40); // GitHub's change is newer
  await sync('sync');
  const [after] = await tickets();
  assert.equal(after.priority, 'High');
  assert.ok(
    after.history.some((h: any) =>
      /GitHub Project sync conflict: priority \(GitHub won\)/.test(h.text),
    ),
  );
});

test('a sync adds issues missing from the board with the ticket’s values; an import doesn’t', async () => {
  issues = [issue(1)];
  await linkAll();
  await sync('import');
  assert.equal(items.length, 0);
  const [t] = await tickets();
  await setTicket(t.id, { priority: 'High', storyPoints: 2, updatedAt: T(30) });
  await sync('sync');
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].values, { status: 'Todo', priority: 'P1', points: 2, sprint: '' });
});

test('a new issue filed from Ticket Forge goes on the board with its values', async () => {
  await linkAll();
  const github: any = await as(() =>
    G.createGithubIssue('p1', {
      title: 'Pay by card',
      priority: 'High',
      storyPoints: 5,
      sprintId: 's2',
    }),
  );
  assert.equal(github.board.itemId, items[0].id);
  assert.deepEqual(items[0].values, {
    status: 'Todo',
    priority: 'P1',
    points: 5,
    sprint: 'Sprint 2',
  });
  assert.equal(github.board.base.priority, 'P1');
});

test('a token without Projects access is reported and the issues still sync', async () => {
  issues = [issue(1)];
  await linkAll();
  scopeError = true;
  const r: any = await sync('import');
  assert.equal(r.created, 1);
  assert.ok(r.errors.some((e: string) => /project/.test(e)));
});

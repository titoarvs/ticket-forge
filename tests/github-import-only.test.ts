// The GitHub issues connection is import-only: issues and GitHub Project fields flow from GitHub
// into Ticket Forge, and Ticket Forge never writes anything back. These tests run every server
// entry point behind Project settings → Code & GitHub → GitHub issues (and creating a ticket) with
// a fake GitHub that records each request, then check that only reads were sent: REST GETs and
// GraphQL queries, never a POST / PATCH / PUT / DELETE or a GraphQL mutation. Run with `npm test`.
// Embedded PostgreSQL (PGlite) in a temporary folder and a replaced fetch, so nothing leaves this
// computer.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-gh-import-only-'));
process.env.TICKETFORGE_DATA = dir;
process.env.DATABASE_URL = '';
process.env.SUPABASE_DB_URL = '';
process.env.GITHUB_TOKEN = 'test-token';

const ROOT = path.join(import.meta.dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

let G: typeof import('../lib/github-sync');
let L: typeof import('../lib/github-project/link');
let I: typeof import('../lib/issue-create');
let LIVE: typeof import('../lib/github-live');
let D: typeof import('../lib/db');

const WS = 'default';
const REPO = 'acme/shop';
const BOARD_ID = 'PVT_1';
const as = <T>(fn: () => Promise<T>) => D.asWorkspace(WS, fn);
const owner = {
  id: 'u-owner',
  name: 'Olive Owner',
  workspace_id: WS,
  is_owner: true,
  project_access: ['p1'],
  permissions: ['issue.create', 'project.repo'],
};
const T = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();

// ---------------------------------------------------------------- a recording fake GitHub
type Req = { method: string; url: string; query?: string };
let requests: Req[] = [];
const isWrite = (r: Req) =>
  r.method !== 'GET' &&
  !(r.method === 'POST' && r.url.endsWith('/graphql') && !/\bmutation\b/.test(r.query || ''));
const writes = () => requests.filter(isWrite);

let issues: any[] = [];
let items: any[] = [];
const issue = (number: number, extra: any = {}) => ({
  number,
  node_id: `I_${number}`,
  title: `Issue ${number}`,
  body: `Body ${number}`,
  state: 'open',
  labels: [{ name: 'bug' }],
  assignee: { login: 'octocat' },
  milestone: { title: 'v1' },
  user: { login: 'hubot' },
  html_url: `https://github.com/${REPO}/issues/${number}`,
  created_at: T(0),
  updated_at: T(1),
  ...extra,
});
const BOARD = {
  id: BOARD_ID,
  number: 3,
  title: 'Shop board',
  url: 'https://github.com/orgs/acme/projects/3',
  closed: false,
};
const FIELDS = [
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
  { __typename: 'ProjectV2Field', id: 'F_points', name: 'Estimate', dataType: 'NUMBER' },
];
const valueNodes = (v: any) =>
  [
    v.status && { name: v.status, field: { id: 'F_status' } },
    v.priority && { name: v.priority, field: { id: 'F_prio' } },
    typeof v.points === 'number' && { number: v.points, field: { id: 'F_points' } },
  ].filter(Boolean);

function graphql(query: string) {
  const op = query.match(/(?:query|mutation) (\w+)/)?.[1] || '';
  if (/\bmutation\b/.test(query)) return { errors: [{ type: 'FORBIDDEN', message: 'no writes' }] };
  if (op === 'Boards')
    return {
      data: {
        repository: { projectsV2: { nodes: [BOARD] } },
        repositoryOwner: { projectsV2: { nodes: [BOARD] } },
      },
    };
  if (op === 'Board') return { data: { node: { ...BOARD, fields: { nodes: FIELDS } } } };
  if (op === 'BoardItems')
    return {
      data: {
        node: {
          items: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: items.map((it) => ({
              id: it.id,
              updatedAt: it.updatedAt,
              content: { __typename: 'Issue', number: it.number, repository: { nameWithOwner: REPO } },
              fieldValues: { nodes: valueNodes(it.values) },
            })),
          },
        },
      },
    };
  return { errors: [{ type: 'NOT_FOUND', message: `unknown ${op}` }] };
}

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = new URL(String(url));
  const method = String(init.method || 'GET').toUpperCase();
  const query = u.pathname === '/graphql' ? JSON.parse(init.body || '{}').query : undefined;
  requests.push({ method, url: u.toString(), query });
  if (u.pathname === '/graphql') return json(graphql(query || ''));
  // Anything but a GET answers as if it worked, so a write can't hide behind an error path.
  if (method !== 'GET') return json({ number: 900, html_url: 'x', node_id: 'I_900' }, 201);
  const route = u.pathname.slice(1);
  if (route === `repos/${REPO}`)
    return json({ full_name: REPO, private: false, html_url: `https://github.com/${REPO}` });
  if (route === `repos/${REPO}/issues`) return json(issues);
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

before(async () => {
  D = await import('../lib/db');
  G = await import('../lib/github-sync');
  L = await import('../lib/github-project/link');
  I = await import('../lib/issue-create');
  LIVE = await import('../lib/github-live');
  const A = await import('../lib/auth');
  await D.migrate();
  await A.seedRoles();
  await D.q("insert into workspaces (id, name) values ($1, 'WS') on conflict (id) do nothing", [
    WS,
  ]);
  await D.q(
    "insert into users (id, email, name, password_hash, role_id, status) values ($1,'o@x.test',$2,'x','admin','active')",
    [owner.id, owner.name],
  );
});
beforeEach(async () => {
  requests = [];
  issues = [];
  items = [];
  await D.q("delete from projects where id = 'p1'");
  await D.q(
    "insert into projects (id, name, key, data, created_by, workspace_id) values ('p1','Shop','SH',$1,$2,$3)",
    [
      JSON.stringify({
        name: 'Shop',
        key: 'SH',
        epics: [],
        members: [],
        workflow: [
          { name: 'To Do', category: 'todo' },
          { name: 'In Progress', category: 'inprogress' },
          { name: 'Done', category: 'done' },
        ],
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

// ---------------------------------------------------------------- the whole panel, read-only
test('linking, importing, syncing and the GitHub Project only ever read from GitHub', async () => {
  issues = [issue(1), issue(2), issue(3, { state: 'closed' })];
  items = [{ id: 'PVTI_1', number: 1, updatedAt: T(2), values: { status: 'Todo', priority: 'P2', points: 3 } }];

  await as(() => G.linkRepo(owner, 'p1', REPO));
  await as(() => L.boardsFor(owner, 'p1'));
  await as(() => L.linkBoard(owner, 'p1', BOARD_ID));
  const first: any = await as(() => G.syncIssues(owner, 'p1', 'import'));
  assert.equal(first.created, 3);

  // Every kind of change Ticket Forge used to write back: title, description, labels, assignee,
  // status (close / reopen), and the board's Status, Priority and Estimate.
  const [a, b, c] = await tickets();
  await setTicket(a.id, {
    title: 'Renamed here',
    description: 'New description',
    labels: ['feature'],
    assignee: 'someone-else',
    status: 'Done',
    priority: 'Highest',
    storyPoints: 13,
    updatedAt: T(30),
  });
  await setTicket(b.id, { status: 'Done', updatedAt: T(30) });
  await setTicket(c.id, { status: 'To Do', updatedAt: T(30) });
  // A conflict Ticket Forge wins (its change is newer) used to be written to GitHub too.
  issues[1].title = 'Renamed on GitHub';
  issues[1].updated_at = T(20);
  await setTicket(b.id, { title: 'Renamed here first', updatedAt: T(40) });

  const synced: any = await as(() => G.syncIssues(owner, 'p1', 'sync'));
  const imported: any = await as(() => G.syncIssues(owner, 'p1', 'import'));
  for (const r of [synced, imported]) {
    assert.equal(r.pushed, undefined);
    assert.deepEqual(r.errors, []);
    assert.equal(r.board.added, undefined);
    assert.equal(r.board.pushed, undefined);
  }
  await as(() => L.unlinkBoard(owner, 'p1'));

  assert.ok(requests.length > 0, 'GitHub was read');
  assert.deepEqual(writes(), [], 'no request wrote to GitHub');
  // GitHub is exactly as it was, and Ticket Forge kept its own edits.
  assert.deepEqual(
    issues.map((i) => [i.title, i.state]),
    [
      ['Issue 1', 'open'],
      ['Renamed on GitHub', 'open'],
      ['Issue 3', 'closed'],
    ],
  );
  assert.deepEqual(items[0].values, { status: 'Todo', priority: 'P2', points: 3 });
  const [a2, b2, c2] = await tickets();
  assert.deepEqual(
    [a2.title, a2.status, a2.priority, a2.storyPoints],
    ['Renamed here', 'Done', 'Highest', 13],
  );
  assert.equal(b2.title, 'Renamed here first');
  assert.equal(c2.status, 'To Do');
});

test('creating a ticket in a project with a linked repository and board never calls GitHub', async () => {
  await D.q("update projects set data = data || $1::jsonb where id = 'p1'", [
    JSON.stringify({ githubSync: { repo: REPO, project: { id: BOARD_ID, title: 'Shop board' } } }),
  ]);
  const { issue: made } = await as(() =>
    I.createProjectIssue(owner, 'p1', { title: 'Pay by card', type: 'Story', status: 'Done' }),
  );
  assert.equal(made.github, undefined);
  assert.deepEqual(requests, []);
});

test('the live Issues and Projects sections only read', async () => {
  issues = [issue(1)];
  await D.q("update projects set data = data || $1::jsonb where id = 'p1'", [
    JSON.stringify({ githubSync: { repo: REPO } }),
  ]);
  await as(() => LIVE.liveIssues(owner, 'p1'));
  await as(() => LIVE.liveProjects(owner, 'p1'));
  assert.ok(requests.length >= 2);
  assert.deepEqual(writes(), []);
});

test('gh() sends a GET even when a caller tries to pass a method and a body', async () => {
  const gh: any = G.gh;
  await gh(`repos/${REPO}/issues`, 'test-token', { method: 'POST', body: { title: 'x' } });
  assert.deepEqual(
    requests.map((r) => r.method),
    ['GET'],
  );
});

test('no write helpers are left: push, create-issue, board add / set', async () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'lib/github-push.ts')), false);
  assert.equal('createGithubIssue' in G, false);
  assert.equal('fileGithubIssue' in I, false);
  const B = await import('../lib/github-project/board');
  const S = await import('../lib/github-project/sync');
  assert.equal('addItem' in B || 'setValues' in B || 'addToBoard' in S, false);
});

// ---------------------------------------------------------------- the route and the panel
test('the github-sync route refuses the former write actions and imports nothing that writes', () => {
  const route = read('app/api/projects/[id]/github-sync/route.ts');
  assert.doesNotMatch(route, /github-push|pushTickets|fileGithubIssue|createGithubIssue/);
  assert.match(route, /const WRITES = \['create-issue', 'push-tickets'\]/);
  assert.match(route, /if \(WRITES\.includes\(b\.action\)\) throw new HttpError\(410/);
});

test('the browser has no way left to write to GitHub issues', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'client/GithubPushButton.tsx')), false);
  const panel = read('client/GithubSync.tsx');
  assert.doesNotMatch(panel, /GithubPushButton|Push .*to GitHub/);
  assert.match(panel, /'Sync from GitHub'/);
  assert.match(panel, /never creates, edits or closes GitHub issues/);
  const client = (d: string): string[] =>
    fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? client(path.join(d, e.name))
        : /\.tsx?$/.test(e.name)
          ? [path.join(d, e.name)]
          : [],
    );
  for (const file of client('client')) {
    const src = read(file);
    assert.doesNotMatch(src, /action: '(create-issue|push-tickets)'/, file);
  }
});

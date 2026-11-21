// TF-140: the Issues and Projects sections of Code & GitHub read live from GitHub, only for people
// with the Code & GitHub permission, with a "connect GitHub" answer when there is no connection and
// an error (never old data) when GitHub fails. Run with `npm test`. Embedded PostgreSQL (PGlite) in
// a temporary folder and a fake GitHub (REST and GraphQL; fetch is replaced), so nothing leaves
// this computer.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-gh-live-'));
process.env.TICKETFORGE_DATA = dir;
process.env.DATABASE_URL = '';
process.env.SUPABASE_DB_URL = '';
const TOKEN = 'test-token';
process.env.GITHUB_TOKEN = TOKEN;

let L: typeof import('../lib/github-live');
let D: typeof import('../lib/db');

const WS = 'default';
const REPO = 'acme/shop';
const as = <T>(fn: () => Promise<T>) => D.asWorkspace(WS, fn);
const owner = { id: 'u-owner', name: 'Olive Owner', workspace_id: WS, is_owner: false };
const withRepo = { ...owner, permissions: ['project.repo'] };
const without = { ...owner, id: 'u-member', name: 'Mia Member', permissions: ['issue.edit'] };

// ---------------------------------------------------------------- a fake GitHub
let issues: any[] = [];
let boards: any[] = [];
let calls: string[] = [];
let down = false;
const issue = (number: number, extra: any = {}) => ({
  number,
  title: `Issue ${number}`,
  state: 'open',
  labels: [{ name: 'bug' }],
  assignee: { login: 'mia' },
  user: { login: 'olive' },
  comments: 2,
  html_url: `https://github.com/${REPO}/issues/${number}`,
  updated_at: new Date(Date.UTC(2026, 0, 1, 0, number)).toISOString(),
  ...extra,
});
const board = (number: number) => ({
  id: `PVT_${number}`,
  number,
  title: `Board ${number}`,
  url: `https://github.com/orgs/acme/projects/${number}`,
  closed: false,
});
const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = new URL(String(url));
  calls.push(u.pathname);
  if (down) return json({ message: 'Server Error' }, 500);
  if (u.pathname === '/graphql')
    return json({
      data: {
        repository: { projectsV2: { nodes: boards } },
        repositoryOwner: { projectsV2: { nodes: [] } },
      },
    });
  if (u.pathname === `/repos/${REPO}/issues`) return json(issues);
  return json({ message: 'Not Found' }, 404);
}) as any;

// ---------------------------------------------------------------- helpers
const addProject = (dev: any = { repo: REPO }) =>
  D.q(
    "insert into projects (id, name, key, data, created_by, workspace_id) values ('p1','Shop','SH',$1,$2,$3)",
    [JSON.stringify({ name: 'Shop', key: 'SH', epics: [], members: [], dev }), owner.id, WS],
  );

before(async () => {
  D = await import('../lib/db');
  L = await import('../lib/github-live');
  const A = await import('../lib/auth');
  await D.migrate();
  await A.seedRoles();
  await D.q("insert into workspaces (id, name) values ($1, 'WS') on conflict (id) do nothing", [
    WS,
  ]);
});
beforeEach(async () => {
  issues = [];
  boards = [];
  calls = [];
  down = false;
  process.env.GITHUB_TOKEN = TOKEN;
  await D.q("delete from projects where id = 'p1'");
  await addProject();
});
after(async () => {
  await (await D.db()).close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- live data
test('the Issues section lists the repository’s issues live, without pull requests', async () => {
  issues = [issue(2), issue(1, { state: 'closed' }), issue(3, { pull_request: {} })];
  const r = await as(() => L.liveIssues(withRepo, 'p1'));
  assert.equal(r.connected, true);
  assert.equal(r.repo, REPO);
  assert.deepEqual(
    r.issues.map((i: any) => [i.number, i.title, i.state, i.assignee, i.labels]),
    [
      [2, 'Issue 2', 'open', 'mia', ['bug']],
      [1, 'Issue 1', 'closed', 'mia', ['bug']],
    ],
  );
  // Read again after GitHub changed: nothing is kept from the first read.
  issues = [issue(9)];
  const again = await as(() => L.liveIssues(withRepo, 'p1'));
  assert.deepEqual(
    again.issues.map((i: any) => i.number),
    [9],
  );
  assert.equal(calls.filter((c) => c === `/repos/${REPO}/issues`).length, 2);
});

test('the Projects section lists the GitHub Projects live', async () => {
  boards = [board(1), board(2)];
  const r = await as(() => L.liveProjects(withRepo, 'p1'));
  assert.equal(r.connected, true);
  assert.deepEqual(
    r.projects.map((b: any) => [b.number, b.title]),
    [
      [2, 'Board 2'],
      [1, 'Board 1'],
    ],
  );
});

test('the Projects section is empty, not an error, when there are no GitHub Projects', async () => {
  const r = await as(() => L.liveProjects(withRepo, 'p1'));
  assert.equal(r.connected, true);
  assert.deepEqual(r.projects, []);
});

test('the repository linked for GitHub issues is used when none was chosen', async () => {
  await D.q("update projects set data = $1::jsonb where id = 'p1'", [
    JSON.stringify({ githubSync: { repo: REPO } }),
  ]);
  issues = [issue(1)];
  assert.equal((await as(() => L.liveIssues(withRepo, 'p1'))).repo, REPO);
});

test('with no repository chosen nothing is read from GitHub', async () => {
  await D.q("update projects set data = '{}'::jsonb where id = 'p1'");
  const r = await as(() => L.liveIssues(withRepo, 'p1'));
  assert.deepEqual([r.connected, r.repo, r.issues], [true, '', []]);
  assert.deepEqual(calls, []);
});

// ---------------------------------------------------------------- access
test('a user without the Code & GitHub permission is refused and nothing is read', async () => {
  for (const read of [L.liveIssues, L.liveProjects])
    await assert.rejects(
      as(() => read(without, 'p1')),
      (e: any) => e.status === 403,
    );
  assert.deepEqual(calls, []);
});

test('the workspace owner can read without a role permission', async () => {
  issues = [issue(1)];
  const r = await as(() => L.liveIssues({ ...owner, is_owner: true }, 'p1'));
  assert.equal(r.issues.length, 1);
});

// ---------------------------------------------------------------- no connection
test('with no GitHub connection both sections say to connect GitHub and show no data', async () => {
  delete process.env.GITHUB_TOKEN;
  issues = [issue(1)];
  boards = [board(1)];
  const i = await as(() => L.liveIssues(withRepo, 'p1'));
  const p = await as(() => L.liveProjects(withRepo, 'p1'));
  assert.deepEqual([i.connected, i.issues], [false, []]);
  assert.deepEqual([p.connected, p.projects], [false, []]);
  assert.deepEqual(calls, []);
});

// ---------------------------------------------------------------- failures
test('a failed GitHub request is an error, and the next read does not reuse earlier data', async () => {
  issues = [issue(1)];
  boards = [board(1)];
  assert.equal((await as(() => L.liveIssues(withRepo, 'p1'))).issues.length, 1);
  down = true;
  for (const read of [L.liveIssues, L.liveProjects])
    await assert.rejects(
      as(() => read(withRepo, 'p1')),
      (e: any) => e.status >= 400,
    );
  down = false;
  issues = [];
  assert.deepEqual((await as(() => L.liveIssues(withRepo, 'p1'))).issues, []);
});

test('a repository the token can’t reach is an error with a readable message', async () => {
  await D.q("update projects set data = $1::jsonb where id = 'p1'", [
    JSON.stringify({ dev: { repo: 'acme/secret' } }),
  ]);
  await assert.rejects(
    as(() => L.liveIssues(withRepo, 'p1')),
    (e: any) => e.status === 400 && /Couldn’t reach that repository/.test(e.message),
  );
});

// ---------------------------------------------------------------- admin status
test('Administration shows the workspace connection status', async () => {
  const shared = await as(() => L.connectionStatus({ ...owner, is_owner: true }));
  assert.deepEqual([shared.connected, shared.shared, shared.total], [true, true, 1]);
  delete process.env.GITHUB_TOKEN;
  const none = await as(() => L.connectionStatus({ ...owner, is_owner: true }));
  assert.deepEqual([none.connected, none.shared, none.projects], [false, false, 0]);
});

// TF-134: creating an issue files a GitHub issue too, but only when the project has a repository
// linked. Run with `npm test`. Embedded PostgreSQL (PGlite) in a temporary folder and a fake GitHub
// (fetch is replaced), so nothing leaves this computer.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-gh-create-'));
process.env.TICKETFORGE_DATA = dir;
process.env.DATABASE_URL = '';
process.env.SUPABASE_DB_URL = '';
process.env.GITHUB_TOKEN = 'test-token';

let I: typeof import('../lib/issue-create');
let D: typeof import('../lib/db');

const WS = 'default';
const REPO = 'acme/shop';
const as = <T>(fn: () => Promise<T>) => D.asWorkspace(WS, fn);
const person = {
  id: 'u-dev',
  name: 'Dana Dev',
  workspace_id: WS,
  is_owner: false,
  project_access: ['p1'],
  permissions: ['issue.create'],
};

// ---------------------------------------------------------------- a fake GitHub
let posted: any[] = [];
let failWith = 0;
globalThis.fetch = (async (url: any, init: any = {}) => {
  const route = new URL(String(url)).pathname.slice(1);
  if (route === `repos/${REPO}/issues` && init.method === 'POST') {
    if (failWith) return new Response(JSON.stringify({ message: 'Nope' }), { status: failWith });
    const body = JSON.parse(init.body);
    posted.push(body);
    const n = 40 + posted.length;
    const data = {
      number: n,
      title: body.title,
      body: body.body,
      state: 'open',
      labels: [],
      html_url: `https://github.com/${REPO}/issues/${n}`,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    return new Response(JSON.stringify(data), { status: 201 });
  }
  return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
}) as any;

const tickets = async () =>
  (await D.q("select data from issues where project_id = 'p1' order by position")).rows.map(
    (r) => r.data,
  );
const setProject = (extra: any) =>
  D.q("update projects set data = data || $1::jsonb where id = 'p1'", [JSON.stringify(extra)]);
const create = (input: any) => as(() => I.createProjectIssue(person, 'p1', input));

before(async () => {
  D = await import('../lib/db');
  I = await import('../lib/issue-create');
  const A = await import('../lib/auth');
  await D.migrate();
  await A.seedRoles();
  await D.q("insert into workspaces (id, name) values ($1, 'WS') on conflict (id) do nothing", [
    WS,
  ]);
  await D.q(
    "insert into users (id, email, name, password_hash, role_id, status) values ($1,'dev@x.test',$2,'x','admin','active')",
    [person.id, person.name],
  );
});
beforeEach(async () => {
  posted = [];
  failWith = 0;
  process.env.GITHUB_TOKEN = 'test-token';
  await D.q("delete from projects where id = 'p1'");
  const data = {
    name: 'Shop',
    key: 'SH',
    epics: [{ id: 'e1', key: 'SH-E1', title: 'Checkout' }],
    sprints: [{ id: 's1', name: 'Sprint 1' }],
    workflow: [{ name: 'To Do' }, { name: 'Done' }],
  };
  await D.q(
    "insert into projects (id, name, key, data, created_by, workspace_id) values ('p1','Shop','SH',$1,$2,$3)",
    [JSON.stringify(data), person.id, WS],
  );
});
after(async () => {
  await (await D.db()).close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('without a linked repository the issue is created only in Ticket Forge', async () => {
  const { issue } = await create({ title: 'Pay by card', type: 'Story' });
  assert.equal(issue.key, 'SH-1');
  assert.equal(issue.github, undefined);
  assert.equal(posted.length, 0);
  assert.equal((await tickets()).length, 1);
});

test('the planning fields are kept and checked against the project', async () => {
  const { issue } = await create({
    title: 'Pay by card',
    type: 'Bug',
    epicId: 'e1',
    sprintId: 's1',
    priority: 'High',
    storyPoints: 5,
    assignee: '  Ana  ',
  });
  assert.deepEqual(
    [issue.epicId, issue.sprintId, issue.priority, issue.storyPoints, issue.assignee],
    ['e1', 's1', 'High', 5, 'Ana'],
  );
  const odd = await create({
    title: 'Odd values',
    type: 'Task',
    epicId: 'nope',
    sprintId: 'nope',
    priority: 'Urgent!',
    storyPoints: -3,
  });
  assert.deepEqual(
    [odd.issue.epicId, odd.issue.sprintId, odd.issue.priority, odd.issue.storyPoints],
    [null, null, 'Medium', null],
  );
});

test('with a linked repository the GitHub issue is filed and linked to the ticket', async () => {
  await setProject({ githubSync: { repo: REPO } });
  const { issue } = await create({ title: 'Pay by card', type: 'Story', description: 'Visa' });
  assert.deepEqual(posted, [{ title: 'Pay by card', body: 'Visa' }]);
  assert.equal(issue.github.repo, REPO);
  assert.equal(issue.github.number, 41);
  assert.equal(issue.github.url, `https://github.com/${REPO}/issues/41`);
  assert.equal((await tickets())[0].github.number, 41);
});

test('when GitHub refuses, no ticket is saved and the reason is shown', async () => {
  await setProject({ githubSync: { repo: REPO } });
  failWith = 403;
  await assert.rejects(
    create({ title: 'Pay by card', type: 'Story' }),
    (e: any) => e.status >= 400,
  );
  assert.equal((await tickets()).length, 0);
});

test('a linked repository without a token asks for one and saves nothing', async () => {
  await setProject({ githubSync: { repo: REPO } });
  process.env.GITHUB_TOKEN = '';
  await assert.rejects(
    create({ title: 'Pay by card', type: 'Story' }),
    (e: any) => e.status === 400 && /personal access token/.test(e.message),
  );
  assert.equal(posted.length, 0);
  assert.equal((await tickets()).length, 0);
});

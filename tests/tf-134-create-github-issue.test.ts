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
  assert.equal(posted.length, 1);
  assert.equal(posted[0].title, 'Pay by card');
  assert.match(
    posted[0].body,
    /### Description\n<!-- tf:description -->\nVisa\n<!-- \/tf:description -->/,
  );
  // The first sync sees the plain description, not the layout, so nothing looks changed.
  assert.equal(issue.github.base.description, 'Visa');
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

// ---------------------------------------------------------------- Write issue with AI
const file = (input: any, who: any = person) => as(() => I.fileGithubIssue(who, 'p1', input));

test('an AI-written ticket gets its GitHub issue filed when a repository is linked', async () => {
  await setProject({ githubSync: { repo: REPO } });
  const { github } = await file({ title: 'Export to CSV', description: 'From the table' });
  assert.equal(posted[0].title, 'Export to CSV');
  assert.match(posted[0].body, /From the table/);
  assert.equal(github.number, 41);
  // The browser saves the ticket itself: nothing is written to issues here.
  assert.equal((await tickets()).length, 0);
});

test('without a linked repository nothing is filed', async () => {
  const { github } = await file({ title: 'Export to CSV' });
  assert.equal(github, null);
  assert.equal(posted.length, 0);
});

test('filing needs a title and the permission to create issues', async () => {
  await setProject({ githubSync: { repo: REPO } });
  await assert.rejects(file({ title: '  ' }), (e: any) => e.status === 400);
  await assert.rejects(
    file({ title: 'Export' }, { ...person, permissions: [] }),
    (e: any) => e.status === 403,
  );
  assert.equal(posted.length, 0);
});

test('the GitHub issue is laid out like the ticket, with Given / When / Then criteria', async () => {
  await setProject({ githubSync: { repo: REPO } });
  await file({
    key: 'SH-7',
    title: 'Reset password',
    type: 'Story',
    priority: 'High',
    storyPoints: 3,
    epicId: 'e1',
    userStory: 'As a user, I want to reset my password, so that I can sign in again.',
    description: 'Send a reset link by email.',
    acceptanceCriteria: [
      'Given a registered email, when I ask for a reset, then a link is emailed',
      'The link expires after 1 hour',
    ],
    testCases: [
      {
        title: 'Link arrives',
        type: 'Functional',
        steps: ['Ask', 'Open mail'],
        expected: 'Mail has a link',
      },
    ],
  });
  const body = posted[0].body;
  assert.match(
    body,
    /^> \*\*Story\*\* · Priority: \*\*High\*\* · Story points: \*\*3\*\* · Epic: \*\*Checkout\*\* · Ticket Forge: \*\*SH-7\*\*/,
  );
  assert.match(body, /### User story\nAs a user, I want to reset my password/);
  assert.match(
    body,
    /\*\*AC1\*\*\n- \*\*Given\*\* a registered email\n- \*\*When\*\* I ask for a reset\n- \*\*Then\*\* a link is emailed/,
  );
  assert.match(body, /\*\*AC2\*\*\n- The link expires after 1 hour/);
  assert.match(
    body,
    /### Test cases\n1\. \*\*Link arrives\*\* _\(Functional\)_\n   1\. Ask\n   2\. Open mail\n   - Expected: Mail has a link/,
  );
});

test('only the marked description is read back from the layout', async () => {
  const B = await import('../lib/github-body');
  const body = B.ticketBody({
    title: 'T',
    description: 'Line 1\n\n## Not a section',
    acceptanceCriteria: ['Given a, then b'],
  });
  assert.equal(B.descriptionOf(body), 'Line 1\n\n## Not a section');
  assert.equal(B.isTicketBody(body), true);
  // An issue written on GitHub keeps its whole body as the description.
  assert.equal(B.descriptionOf('Plain body\r\nline 2'), 'Plain body\nline 2');
  assert.equal(B.isTicketBody('Plain body'), false);
});

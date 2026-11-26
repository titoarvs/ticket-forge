// TF-134 (now import-only): creating an issue never files a GitHub issue, with or without a
// linked repository; the ticket lives only in Ticket Forge. Run with `npm test`. Embedded
// PostgreSQL (PGlite) in a temporary folder and a fake GitHub (fetch is replaced), so nothing
// leaves this computer.
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
/** Every request made to GitHub: creating an issue must make none. */
let requests: any[] = [];
globalThis.fetch = (async (url: any, init: any = {}) => {
  requests.push({ method: init.method || 'GET', url: String(url), body: init.body });
  return new Response(JSON.stringify({ message: 'Ticket Forge must not call GitHub here' }), {
    status: 405,
  });
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
  requests = [];
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
  assert.equal(requests.length, 0);
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

test('with a linked repository no GitHub issue is filed: the ticket is only in Ticket Forge', async () => {
  await setProject({ githubSync: { repo: REPO, project: { id: 'PVT_1', title: 'Board' } } });
  const { issue } = await create({ title: 'Pay by card', type: 'Story', description: 'Visa' });
  assert.equal(issue.key, 'SH-1');
  assert.equal(issue.github, undefined);
  assert.equal(requests.length, 0, 'GitHub is not called at all');
  const [saved] = await tickets();
  assert.equal(saved.title, 'Pay by card');
  assert.equal(saved.github, undefined);
});

test('a linked repository without a token still creates the ticket (GitHub isn’t needed)', async () => {
  await setProject({ githubSync: { repo: REPO } });
  process.env.GITHUB_TOKEN = '';
  const { issue } = await create({ title: 'Pay by card', type: 'Story' });
  assert.equal(issue.key, 'SH-1');
  assert.equal(requests.length, 0);
  assert.equal((await tickets()).length, 1);
});

test('the browser’s former “file a GitHub issue” call is gone from the server', async () => {
  assert.equal('fileGithubIssue' in I, false);
  const G = await import('../lib/github-sync');
  assert.equal('createGithubIssue' in G, false);
});

test('the Ticket Forge issue layout is still written and read the same way', async () => {
  const B = await import('../lib/github-body');
  const body = B.ticketBody(
    {
      key: 'SH-7',
      title: 'Reset password',
      type: 'Story',
      priority: 'High',
      storyPoints: 3,
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
    },
    'Checkout',
  );
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
  assert.equal(B.descriptionOf(body), 'Send a reset link by email.');
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

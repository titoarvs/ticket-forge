// TF-130: import GitHub issues as tickets. Import-only: Import issues and Sync from GitHub read
// GitHub and never write to it. Run with `npm test`.
// The tests use the embedded PostgreSQL (PGlite) in a temporary folder, never a real database, and
// a fake GitHub (fetch is replaced), so nothing leaves this computer. They call the functions the
// route uses, as the person making the request.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-gh-sync-'));
process.env.TICKETFORGE_DATA = dir;
process.env.DATABASE_URL = '';
process.env.SUPABASE_DB_URL = '';
process.env.GITHUB_TOKEN = 'test-token';

let G: typeof import('../lib/github-sync');
let D: typeof import('../lib/db');

const WS = 'default';
const REPO = 'acme/shop';
const as = <T>(fn: () => Promise<T>) => D.asWorkspace(WS, fn);
const owner = { id: 'u-owner', name: 'Olive Owner', workspace_id: WS, is_owner: false };
const superAdmin = { id: 'u-admin', name: 'Sam Admin', workspace_id: WS, is_owner: true };
const member = { id: 'u-member', name: 'Mia Member', workspace_id: WS, is_owner: false };

// ---------------------------------------------------------------- a fake GitHub
let issues: any[] = [];
/** Every request that wasn't a GET: there must never be one. */
let writes: any[] = [];
const T = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
const issue = (number: number, extra: any = {}) => ({
  number,
  title: `Issue ${number}`,
  body: `Body ${number}`,
  state: 'open',
  labels: [{ name: 'bug' }, { name: 'ui' }],
  assignee: { login: 'octocat' },
  milestone: { title: 'v1.0' },
  user: { login: 'hubot' },
  html_url: `https://github.com/${REPO}/issues/${number}`,
  created_at: T(0),
  updated_at: T(1),
  ...extra,
});
const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = new URL(String(url));
  const route = u.pathname.slice(1);
  if ((init.method || 'GET') !== 'GET') {
    writes.push({ method: init.method, route, body: init.body });
    return json({ message: 'Ticket Forge must not write to GitHub' }, 405);
  }
  if (route === `repos/${REPO}`)
    return json({ full_name: REPO, private: true, html_url: `https://github.com/${REPO}` });
  if (route === `repos/${REPO}/issues`)
    return json(
      // pull requests come back in this list too: they must be left out
      [...issues, { number: 999, title: 'A pull request', pull_request: {}, state: 'open' }],
    );
  return json({ message: 'Not Found' }, 404);
}) as any;

// ---------------------------------------------------------------- helpers
const tickets = async () =>
  (await D.q("select data from issues where project_id = 'p1' order by position")).rows.map(
    (r) => r.data,
  );
const project = async () => (await D.q("select data from projects where id = 'p1'")).rows[0].data;
const setTicket = (id: string, patch: any) =>
  D.q("update issues set data = data || $2::jsonb where project_id = 'p1' and id = $1", [
    id,
    JSON.stringify(patch),
  ]);
const link = () => as(() => G.linkRepo(owner, 'p1', REPO));

before(async () => {
  D = await import('../lib/db');
  G = await import('../lib/github-sync');
  const A = await import('../lib/auth');
  await D.migrate();
  await A.seedRoles();
  await D.q(
    "insert into workspaces (id, name) values ($1, 'Test workspace') on conflict (id) do nothing",
    [WS],
  );
  for (const u of [owner, superAdmin, member])
    await D.q(
      "insert into users (id, email, name, password_hash, role_id, status) values ($1,$2,$3,'x','admin','active')",
      [u.id, `${u.id}@x.test`, u.name],
    );
});
beforeEach(async () => {
  issues = [];
  writes = [];
  await D.q("delete from projects where id = 'p1'");
  await D.q(
    "insert into projects (id, name, key, data, created_by, workspace_id) values ('p1','Shop','SH',$1,$2,$3)",
    [JSON.stringify({ name: 'Shop', key: 'SH', epics: [], members: [] }), owner.id, WS],
  );
});
after(async () => {
  await (await D.db()).close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- AC 1: link
test('AC1: the project owner links a repository they can access and it is saved on the project', async () => {
  const r: any = await link();
  assert.equal(r.linked.repo, REPO);
  assert.equal((await project()).githubSync.repo, REPO);
});
test('AC1: a github.com address links the same repository', async () => {
  const r: any = await as(() => G.linkRepo(owner, 'p1', `https://github.com/${REPO}.git`));
  assert.equal(r.linked.repo, REPO);
});
test('AC1: a repository the account cannot reach is refused and nothing is saved', async () => {
  await assert.rejects(
    as(() => G.linkRepo(owner, 'p1', 'acme/secret')),
    /Couldn’t reach that repository/,
  );
  assert.equal((await project()).githubSync, undefined);
});
test('AC1: a malformed repository name is refused', async () => {
  await assert.rejects(
    as(() => G.linkRepo(owner, 'p1', 'not a repo')),
    /owner\/name/,
  );
});

// ---------------------------------------------------------------- AC 5: permission
test('AC5: a user who is neither the project owner nor a Super Admin cannot link or import', async () => {
  issues = [issue(1)];
  await assert.rejects(
    as(() => G.linkRepo(member, 'p1', REPO)),
    /Only the project owner or a Super Admin/,
  );
  await link();
  await assert.rejects(
    as(() => G.syncIssues(member, 'p1')),
    /Only the project owner or a Super Admin/,
  );
  await assert.rejects(
    as(() => G.syncIssues(member, 'p1', 'sync')),
    /Only the project owner or a Super Admin/,
  );
  assert.equal((await tickets()).length, 0);
});
test('AC5: a Super Admin can link and import in a project they did not create', async () => {
  issues = [issue(1)];
  await as(() => G.linkRepo(superAdmin, 'p1', REPO));
  const r: any = await as(() => G.syncIssues(superAdmin, 'p1'));
  assert.equal(r.created, 1);
});
test('importing before a repository is linked asks for the link first', async () => {
  await assert.rejects(
    as(() => G.syncIssues(owner, 'p1')),
    /Link a GitHub repository first/,
  );
});

// ---------------------------------------------------------------- AC 2 and 6: import and mapping
test('AC2 and AC6: every issue becomes a ticket with mapped fields and an epic named after the milestone', async () => {
  issues = [
    issue(1),
    issue(2, { milestone: null, assignee: null, labels: [], body: null, state: 'closed' }),
  ];
  await link();
  const r: any = await as(() => G.syncIssues(owner, 'p1'));
  assert.equal(r.total, 2); // the pull request is left out
  assert.equal(r.created, 2);
  assert.deepEqual(r.epicsCreated, ['v1.0']);
  const [a, b] = await tickets();
  const epics = (await project()).epics;
  assert.equal(epics.length, 1);
  assert.equal(epics[0].title, 'v1.0');
  assert.equal(a.title, 'Issue 1');
  assert.equal(a.description, 'Body 1');
  assert.deepEqual(a.labels, ['bug', 'ui']);
  assert.equal(a.assignee, 'octocat');
  assert.equal(a.epicId, epics[0].id);
  assert.deepEqual({ repo: a.github.repo, number: a.github.number }, { repo: REPO, number: 1 });
  assert.equal(a.key, 'SH-1');
  assert.equal(b.epicId, null);
  assert.equal(b.status, 'Done'); // closed → the "done" status
  assert.equal(a.status, 'To Do'); // open → the first status
});
test('AC6: a milestone that already has an epic reuses it', async () => {
  await D.q("update projects set data = data || $1::jsonb where id = 'p1'", [
    JSON.stringify({ epics: [{ id: 'e1', key: 'SH-E1', title: 'V1.0' }] }),
  ]);
  issues = [issue(1), issue(2)];
  await link();
  const r: any = await as(() => G.syncIssues(owner, 'p1'));
  assert.deepEqual(r.epicsCreated, []);
  assert.deepEqual(
    (await tickets()).map((t) => t.epicId),
    ['e1', 'e1'],
  );
  assert.equal((await project()).epics.length, 1);
});

// ---------------------------------------------------------------- AC 3: re-import
test('AC3: importing again updates the ticket and creates no duplicate', async () => {
  issues = [issue(1)];
  await link();
  await as(() => G.syncIssues(owner, 'p1'));
  issues[0].title = 'Renamed on GitHub';
  issues[0].updated_at = T(5);
  const r: any = await as(() => G.syncIssues(owner, 'p1'));
  assert.equal(r.created, 0);
  assert.equal(r.updated, 1);
  const all = await tickets();
  assert.equal(all.length, 1);
  assert.equal(all[0].title, 'Renamed on GitHub');
});
test('AC3: importing an unchanged repository changes nothing', async () => {
  issues = [issue(1)];
  await link();
  await as(() => G.syncIssues(owner, 'p1'));
  const r: any = await as(() => G.syncIssues(owner, 'p1'));
  assert.deepEqual([r.created, r.updated, r.unchanged], [0, 0, 1]);
  assert.equal((await tickets()).length, 1);
});

// ---------------------------------------------------------------- AC 4: conflicts
test('AC4: when both sides changed, the newer change (GitHub) wins and the conflict is in the ticket activity', async () => {
  issues = [issue(1)];
  await link();
  await as(() => G.syncIssues(owner, 'p1'));
  const [t] = await tickets();
  await setTicket(t.id, { title: 'Edited in Ticket Forge', updatedAt: T(10) });
  issues[0].title = 'Edited on GitHub';
  issues[0].updated_at = T(20);
  const r: any = await as(() => G.syncIssues(owner, 'p1', 'sync'));
  assert.equal(r.conflicts, 1);
  const [after] = await tickets();
  assert.equal(after.title, 'Edited on GitHub');
  const entry = after.history.find((h: any) => /^Sync conflict/.test(h.text || ''));
  assert.ok(entry, 'the ticket activity has a conflict entry');
  assert.match(entry.text, /title \(GitHub won/);
  assert.match(entry.text, /Edited in Ticket Forge/);
  assert.equal(writes.length, 0);
});
test('AC4: when the Ticket Forge change is newer it is kept in Ticket Forge, GitHub is left alone, and the conflict is recorded', async () => {
  issues = [issue(1)];
  await link();
  await as(() => G.syncIssues(owner, 'p1'));
  const [t] = await tickets();
  await setTicket(t.id, { title: 'Edited in Ticket Forge', updatedAt: T(30) });
  issues[0].title = 'Edited on GitHub';
  issues[0].updated_at = T(20);
  const r: any = await as(() => G.syncIssues(owner, 'p1', 'sync'));
  assert.equal(r.conflicts, 1);
  assert.equal(r.pushed, undefined, 'nothing is pushed');
  const [after] = await tickets();
  assert.equal(after.title, 'Edited in Ticket Forge');
  const entry = after.history.find((h: any) => /^Sync conflict/.test(h.text || ''));
  assert.match(entry.text, /title \(Ticket Forge won; GitHub’s value was “Edited on GitHub”, and GitHub is left as it is\)/);
  assert.equal(issues[0].title, 'Edited on GitHub');
  // GitHub's value is the new common ground: the next sync reports no conflict again.
  const again: any = await as(() => G.syncIssues(owner, 'p1', 'sync'));
  assert.deepEqual([again.conflicts, again.updated], [0, 0]);
  assert.equal((await tickets())[0].title, 'Edited in Ticket Forge');
  assert.equal(writes.length, 0);
});
test("Sync from GitHub copies GitHub's changes; a change made only in Ticket Forge stays there", async () => {
  issues = [issue(1), issue(2)];
  await link();
  await as(() => G.syncIssues(owner, 'p1'));
  const [t1] = await tickets();
  await setTicket(t1.id, { title: 'Only in Ticket Forge', updatedAt: T(10) });
  issues[1].body = 'Only on GitHub';
  issues[1].updated_at = T(11);
  const r: any = await as(() => G.syncIssues(owner, 'p1', 'sync'));
  assert.equal(r.conflicts, 0);
  assert.equal(issues[0].title, 'Issue 1', 'GitHub keeps its title');
  const [a, b] = await tickets();
  assert.equal(a.title, 'Only in Ticket Forge');
  assert.equal(b.description, 'Only on GitHub');
  assert.equal(writes.length, 0);
  assert.equal((await project()).githubSync.last.mode, 'sync');
});
test('an import never writes to GitHub', async () => {
  issues = [issue(1)];
  await link();
  await as(() => G.syncIssues(owner, 'p1'));
  const [t] = await tickets();
  await setTicket(t.id, { title: 'Only in Ticket Forge', updatedAt: T(10) });
  await as(() => G.syncIssues(owner, 'p1', 'import'));
  assert.equal(writes.length, 0);
  assert.equal((await tickets())[0].title, 'Only in Ticket Forge');
});

test('a Jira-style issue maps only its description, and a description edited here is never written back', async () => {
  const B = await import('../lib/github-body');
  issues = [
    issue(7, {
      body: B.ticketBody({
        title: 'Issue 7',
        description: 'Old text',
        acceptanceCriteria: ['Given a, when b, then c'],
      }),
      milestone: null,
      labels: [],
      assignee: null,
    }),
  ];
  await link();
  await as(() => G.syncIssues(owner, 'p1', 'import'));
  const [t] = await tickets();
  assert.equal(t.description, 'Old text');
  await setTicket(t.id, { description: 'New text', updatedAt: T(30) });
  await as(() => G.syncIssues(owner, 'p1', 'sync'));
  assert.equal(writes.length, 0);
  assert.match(issues[0].body, /<!-- tf:description -->\nOld text\n<!-- \/tf:description -->/);
  assert.equal((await tickets())[0].description, 'New text');
});

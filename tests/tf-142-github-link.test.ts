// TF-142: Code & GitHub → GitHub connection and repository: the connection status (connected, not
// connected, error), choosing, changing and clearing the project's repository from the ones the
// connection can access, the choice kept after a reload and through a GitHub error, and the access
// check (only people with the Code & GitHub permission). Run with `npm test`. Embedded PostgreSQL
// (PGlite) in a temporary folder and a fake GitHub (fetch is replaced), so nothing leaves this
// computer.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-gh-link-'));
process.env.TICKETFORGE_DATA = dir;
process.env.DATABASE_URL = '';
process.env.SUPABASE_DB_URL = '';
process.env.GITHUB_TOKEN = 'test-token';

let K: typeof import('../lib/github-link');
let L: typeof import('../lib/github-live');
let D: typeof import('../lib/db');

const WS = 'default';
const as = <T>(fn: () => Promise<T>) => D.asWorkspace(WS, fn);
const base = { id: 'u-1', name: 'Olive Owner', workspace_id: WS, is_owner: false };
const withRepo = { ...base, permissions: ['project.repo'] };
const without = { ...base, id: 'u-2', name: 'Mia Member', permissions: ['issue.edit', 'project.settings'] };

// ---------------------------------------------------------------- a fake GitHub
let revoked = false;
let down = false;
let calls: string[] = [];
const repo = (fullName: string, extra: any = {}) => ({
  full_name: fullName,
  private: false,
  description: `The ${fullName} repository`,
  default_branch: 'main',
  pushed_at: '2026-01-01T00:00:00Z',
  html_url: `https://github.com/${fullName}`,
  archived: false,
  permissions: { push: true },
  ...extra,
});
const REPOS = [repo('acme/shop'), repo('acme/api', { private: true, default_branch: 'develop' })];
const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (url: any) => {
  const u = new URL(String(url));
  calls.push(u.pathname);
  if (down) throw new TypeError('fetch failed');
  if (revoked) return json({ message: 'Bad credentials' }, 401);
  if (u.pathname === '/user')
    return json({ login: 'olive', name: 'Olive Owner', avatar_url: 'https://x/a.png' });
  if (u.pathname === '/user/repos') return json(REPOS);
  if (u.pathname === '/repos/acme/api/issues') return json([]);
  if (u.pathname === '/repos/acme/shop/issues') return json([]);
  return json({ message: 'Not Found' }, 404);
}) as any;

// ---------------------------------------------------------------- helpers
const addProject = () =>
  D.q(
    "insert into projects (id, name, key, data, created_by, workspace_id) values ('p1','Shop','SH',$1,$2,$3)",
    [JSON.stringify({ name: 'Shop', key: 'SH', epics: [], members: [] }), base.id, WS],
  );
const rows = async (table: string) =>
  (await D.q(`select * from ${table} where project_id = 'p1'`)).rows;

before(async () => {
  D = await import('../lib/db');
  K = await import('../lib/github-link');
  L = await import('../lib/github-live');
  const A = await import('../lib/auth');
  await D.migrate();
  await A.seedRoles();
  await D.q("insert into workspaces (id, name) values ($1, 'WS') on conflict (id) do nothing", [
    WS,
  ]);
});
beforeEach(async () => {
  revoked = false;
  down = false;
  calls = [];
  process.env.GITHUB_TOKEN = 'test-token';
  await D.q("delete from projects where id = 'p1'");
  await addProject();
});
after(async () => {
  await (await D.db()).close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- status
test('a permitted user sees the connection as connected, with the account', async () => {
  const s = await as(() => K.githubSettings(withRepo, 'p1'));
  assert.equal(s.status, 'connected');
  assert.equal(s.account?.login, 'olive');
  assert.equal(s.repo, null);
  const [row] = await rows('github_connections');
  assert.equal(row.status, 'connected');
  assert.equal(row.account_login, 'olive');
});

test('with no GitHub sign-in the status is not connected and GitHub is not asked', async () => {
  delete process.env.GITHUB_TOKEN;
  const s = await as(() => K.githubSettings(withRepo, 'p1'));
  assert.deepEqual([s.status, s.account, s.repo], ['not_connected', null, null]);
  assert.deepEqual(calls, []);
  assert.deepEqual(await rows('github_connections'), []);
});

test('connecting records the account, and disconnecting forgets it', async () => {
  delete process.env.GITHUB_TOKEN;
  await as(() =>
    K.recordConnection('p1', withRepo, { account: { login: 'olive', name: 'Olive', avatar: '' }, scopes: 'repo' }),
  );
  const [row] = await rows('github_connections');
  assert.deepEqual([row.status, row.account_login, row.scopes, row.connected_by], ['connected', 'olive', 'repo', 'Olive Owner']);
  await as(() => K.forgetConnection('p1'));
  assert.deepEqual(await rows('github_connections'), []);
});

// ---------------------------------------------------------------- repository selection
test('the accessible repositories are listed and can be searched', async () => {
  const all = await as(() => K.accessibleRepos(withRepo, 'p1'));
  assert.deepEqual(all.map((r: any) => r.fullName).sort(), ['acme/api', 'acme/shop']);
  const some = await as(() => K.accessibleRepos(withRepo, 'p1', 'shop'));
  assert.deepEqual(some.map((r: any) => r.fullName), ['acme/shop']);
});

test('a selected repository is still the linked repository after a reload', async () => {
  const saved = await as(() => K.saveRepoLink(withRepo, 'p1', 'acme/shop'));
  assert.equal(saved.repo?.fullName, 'acme/shop');
  // "Reload": everything is read again from the database.
  const s = await as(() => K.githubSettings(withRepo, 'p1'));
  assert.deepEqual([s.repo?.fullName, s.repo?.defaultBranch], ['acme/shop', 'main']);
  // Changing it replaces the choice.
  await as(() => K.saveRepoLink(withRepo, 'p1', 'acme/api'));
  const again = await as(() => K.githubSettings(withRepo, 'p1'));
  assert.deepEqual([again.repo?.fullName, again.repo?.defaultBranch, again.repo?.private], ['acme/api', 'develop', true]);
  assert.equal((await rows('github_repo_links')).length, 1);
});

test('clearing the selection leaves the project with no repository', async () => {
  await as(() => K.saveRepoLink(withRepo, 'p1', 'acme/shop'));
  const r = await as(() => K.saveRepoLink(withRepo, 'p1', ''));
  assert.equal(r.repo, null);
  assert.equal((await as(() => K.githubSettings(withRepo, 'p1'))).repo, null);
  assert.equal(await as(() => K.readRepoLink('p1')), null);
});

test('a repository the connection can’t access can’t be linked', async () => {
  await assert.rejects(
    as(() => K.saveRepoLink(withRepo, 'p1', 'acme/secret')),
    (e: any) => e.status === 400 && /can access/.test(e.message),
  );
  await assert.rejects(
    as(() => K.saveRepoLink(withRepo, 'p1', 'not a repo')),
    (e: any) => e.status === 400,
  );
  assert.deepEqual(await rows('github_repo_links'), []);
});

test('the Issues and Projects sections follow the repository chosen here, even when cleared', async () => {
  await D.q("update projects set data = $1::jsonb where id = 'p1'", [
    JSON.stringify({ dev: { repo: 'acme/api' } }),
  ]);
  assert.equal((await as(() => L.liveIssues(withRepo, 'p1'))).repo, 'acme/api'); // never chosen here
  await as(() => K.saveRepoLink(withRepo, 'p1', 'acme/shop'));
  assert.equal((await as(() => L.liveIssues(withRepo, 'p1'))).repo, 'acme/shop');
  await as(() => K.saveRepoLink(withRepo, 'p1', ''));
  assert.equal((await as(() => L.liveIssues(withRepo, 'p1'))).repo, '');
});

// ---------------------------------------------------------------- errors
test('a revoked connection is an error, and the saved repository is kept', async () => {
  await as(() => K.saveRepoLink(withRepo, 'p1', 'acme/shop'));
  assert.equal((await as(() => K.githubSettings(withRepo, 'p1'))).status, 'connected');
  revoked = true;
  const s = await as(() => K.githubSettings(withRepo, 'p1'));
  assert.equal(s.status, 'error');
  assert.match(s.error, /rejected|Connect GitHub again/);
  assert.equal(s.repo?.fullName, 'acme/shop');
  const [row] = await rows('github_connections');
  assert.equal(row.status, 'error');
  assert.equal(row.account_login, 'olive'); // who it was is remembered
  // Trying again once GitHub accepts the sign-in again.
  revoked = false;
  const back = await as(() => K.githubSettings(withRepo, 'p1'));
  assert.deepEqual([back.status, back.error, back.repo?.fullName], ['connected', '', 'acme/shop']);
});

test('GitHub not answering is an error with a readable message', async () => {
  down = true;
  const s = await as(() => K.githubSettings(withRepo, 'p1'));
  assert.deepEqual([s.status, s.error], ['error', 'GitHub didn’t respond. Try again.']);
  await assert.rejects(
    as(() => K.accessibleRepos(withRepo, 'p1')),
    (e: any) => e.status === 504,
  );
});

// ---------------------------------------------------------------- access
test('a user without the Code & GitHub permission can neither see nor change anything', async () => {
  await assert.rejects(as(() => K.githubSettings(without, 'p1')), (e: any) => e.status === 403);
  await assert.rejects(as(() => K.accessibleRepos(without, 'p1')), (e: any) => e.status === 403);
  await assert.rejects(as(() => K.saveRepoLink(without, 'p1', 'acme/shop')), (e: any) => e.status === 403);
  assert.deepEqual(calls, []);
  assert.deepEqual(await rows('github_repo_links'), []);
});

test('the workspace owner can use it without a role permission', async () => {
  const s = await as(() => K.githubSettings({ ...base, is_owner: true }, 'p1'));
  assert.equal(s.status, 'connected');
});

test('the link rows go away with the project', async () => {
  await as(() => K.saveRepoLink(withRepo, 'p1', 'acme/shop'));
  await as(() => K.githubSettings(withRepo, 'p1'));
  await D.q("delete from projects where id = 'p1'");
  assert.deepEqual(await rows('github_repo_links'), []);
  assert.deepEqual(await rows('github_connections'), []);
});

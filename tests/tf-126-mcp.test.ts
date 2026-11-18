// TF-126: the MCP server (create, list, search and read issues and epics with an API token). Run with `npm test`.
// The tests use the embedded PostgreSQL (PGlite) in a temporary folder, never a real database. They call the tool
// functions and the JSON-RPC handler the route uses, as the person an API token resolves to.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-mcp-'));
process.env.TICKETFORGE_DATA = dir;
process.env.DATABASE_URL = '';
process.env.SUPABASE_DB_URL = '';

let M: typeof import('../lib/mcp');
let A: typeof import('../lib/auth');
let D: typeof import('../lib/db');

const WS = 'default';
const as = <T>(fn: () => Promise<T>) => D.asWorkspace(WS, fn);
const issueKeys = async (p = 'p1') => (await D.q("select data->>'key' as k from issues where project_id = $1 order by position", [p])).rows.map((r) => r.k);
const issueCount = async () => (await D.q('select count(*)::int n from issues')).rows[0].n;
const tokens: Record<string, string> = {};
/** The person a user's token acts as, resolved the way the route does it. */
const who = async (name: string) => (await as(() => A.apiTokenUser(tokens[name]))) as any;

before(async () => {
  D = await import('../lib/db');
  M = await import('../lib/mcp');
  A = await import('../lib/auth');
  await D.migrate();
  await A.seedRoles();
  await D.q("insert into workspaces (id, name) values ($1, 'Test workspace') on conflict (id) do nothing", [WS]);
  await D.q(`insert into roles (workspace_id, id, name, permissions) values ($1,'maker','Maker','["issue.create"]'), ($1,'viewer','Viewer','["issue.comment"]')`, [WS]);
  const people = [
    { id: 'u-maker', role: 'maker', access: ['p1'] }, // may create, on p1 only
    { id: 'u-viewer', role: 'viewer', access: ['p1'] }, // may not create
    { id: 'u-p2', role: 'maker', access: ['p2'] }, // may create, but not on p1
  ];
  for (const u of people) {
    await D.q("insert into users (id, email, name, password_hash, role_id, status) values ($1,$2,$3,'x','admin','active')", [u.id, `${u.id}@x.test`, `Name ${u.id}`]);
    await D.q("insert into workspace_members (workspace_id, user_id, role_id, project_access) values ($1,$2,$3,$4)", [WS, u.id, u.role, JSON.stringify(u.access)]);
  }
  const project = (id: string, name: string, key: string, extra: any = {}) =>
    D.q("insert into projects (id, name, key, data, created_by, workspace_id) values ($1,$2,$3,$4,'u-maker',$5)", [id, name, key, JSON.stringify({ name, key, ...extra }), WS]);
  await project('p1', 'Shop', 'SH', {
    epics: [
      { id: 'e1', key: 'SH-E1', title: 'Accounts', description: 'Sign in and profiles' },
      { id: 'e2', key: 'SH-E2', title: 'Payments', description: 'Cards' },
      { id: 'e3', title: 'Hidden accounts draft', draft: true },
    ],
    workflow: [{ name: 'Backlog', category: 'todo' }, { name: 'In Progress', category: 'doing' }],
  });
  await project('p2', 'Other', 'OT', { epics: [{ id: 'f1', key: 'OT-E1', title: 'Accounts elsewhere' }] });
  await project('p3', 'Secret', 'SE', { epics: [{ id: 'g1', key: 'SE-E1', title: 'Accounts secret' }] });
  const rows = [
    ['p1', 'i1', 'SH-1', 'Login page', 'Users sign in', 'e1'],
    ['p1', 'i2', 'SH-2', 'Checkout', 'Pay for the cart; login required', 'e2'],
    ['p1', 'i3', 'SH-3', 'Reports', 'Monthly numbers', null],
    ['p2', 'x1', 'OT-1', 'Login elsewhere', 'Other project', 'f1'],
    ['p3', 's1', 'SE-1', 'Login secret', 'Hidden project', 'g1'],
  ];
  for (const [pos, [p, id, key, title, description, epicId]] of rows.entries())
    await D.q('insert into issues (project_id, id, position, data) values ($1,$2,$3,$4)', [p, id, pos, JSON.stringify({ id, key, title, description, epicId, status: 'Backlog', type: 'Story', priority: 'Medium' })]);
  for (const u of people) tokens[u.id] = (await as(() => A.createApiToken({ id: u.id, workspace_id: WS }, { name: 'test' }))).token;
});
after(async () => {
  await (await D.db()).close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- AC 1: create
test('AC1: a person whose role allows it creates a backlog issue with the default status and themself as creator', () =>
  as(async () => {
    const user = await who('u-maker');
    const was = await issueKeys();
    const { issue } = await M.callTool(user, 'create_issue', {
      projectId: 'p1',
      title: 'Export orders as CSV',
      type: 'task',
      priority: 'High',
      description: 'Customers export their orders',
      acceptanceCriteria: ['A CSV file downloads'],
      epicId: 'e1',
    });
    assert.equal(issue.key, 'SH-4');
    assert.equal(issue.status, 'Backlog'); // the project's first workflow status
    assert.equal(issue.type, 'Task');
    assert.equal(issue.createdBy, 'u-maker');
    assert.equal(issue.reporter, 'Name u-maker');
    assert.deepEqual(await issueKeys(), [...was, 'SH-4']);
    const row = (await D.q("select data, updated_by from issues where project_id = 'p1' and id = $1", [issue.id])).rows[0];
    assert.equal(row.updated_by, 'u-maker');
    assert.equal(row.data.sprintId, null); // in the backlog, not in a sprint
    assert.equal(row.data.history[0].field, 'created');
    // The project timeline records it.
    const act = (await D.q("select author, kind, target from activity where project_id = 'p1' and target = 'SH-4'")).rows;
    assert.deepEqual(act, [{ author: 'Name u-maker', kind: 'issue', target: 'SH-4' }]);
    // It is readable through the read tools.
    assert.equal((await M.callTool(user, 'get_issue', { projectId: 'p1', issueId: 'sh-4' })).issue.title, 'Export orders as CSV');
  }));

test('AC1: the JSON-RPC tools/call wraps the result for the client', () =>
  as(async () => {
    const user = await who('u-maker');
    const r: any = await M.handleMessage(user, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'create_issue', arguments: { projectId: 'p1', title: 'Via JSON-RPC' } },
    });
    assert.equal(r.id, 7);
    assert.equal(r.result.isError, false);
    assert.equal(r.result.structuredContent.issue.title, 'Via JSON-RPC');
    const tools: any = await M.handleMessage(user, { jsonrpc: '2.0', id: 8, method: 'tools/list' });
    assert.deepEqual(tools.result.tools.map((t) => t.name), ['create_issue', 'list_issues', 'get_issue', 'list_epics', 'get_epic']);
    assert.equal(await M.handleMessage(user, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  }));

// ---------------------------------------------------------------- AC 2: permission
test('AC2: a person whose role does not allow creating is refused with a permission error and nothing is saved', () =>
  as(async () => {
    const user = await who('u-viewer');
    const before = await issueCount();
    await assert.rejects(M.callTool(user, 'create_issue', { projectId: 'p1', title: 'Not allowed' }), (e: any) => e.status === 403 && /issue\.create/.test(e.message));
    assert.equal(await issueCount(), before);
    // Through JSON-RPC it is a tool error with the permission code, and the tool isn't offered to them.
    const r: any = await M.handleMessage(user, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_issue', arguments: { projectId: 'p1', title: 'x' } } });
    assert.equal(r.result.isError, true);
    assert.equal(r.result.structuredContent.error.code, 'permission_denied');
    const tools: any = await M.handleMessage(user, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.ok(!tools.result.tools.some((t) => t.name === 'create_issue'));
    assert.equal(await issueCount(), before);
    // They can still read.
    assert.equal((await M.callTool(user, 'list_issues', { projectId: 'p1' })).issues.length > 0, true);
  }));

// ---------------------------------------------------------------- AC 3: list and search stay in the project
test('AC3: list and search return only the requested project’s issues', () =>
  as(async () => {
    const user = await who('u-maker');
    const r = await M.callTool(user, 'list_issues', { projectId: 'p1', query: 'login' });
    assert.deepEqual(r.issues.map((i) => i.key), ['SH-1', 'SH-2']);
    const all = await M.callTool(user, 'list_issues', { projectId: 'p1' });
    assert.ok(all.issues.every((i) => i.key.startsWith('SH-')));
    assert.equal((await M.callTool(user, 'list_issues', { projectId: 'p1', query: '%' })).issues.length, 0);
    assert.deepEqual((await M.callTool(user, 'list_issues', { projectId: 'p1', epicId: 'e2' })).issues.map((i) => i.key), ['SH-2']);
    const page = await M.callTool(user, 'list_issues', { projectId: 'p1', limit: 1 });
    assert.equal(page.issues.length, 1);
    assert.equal(page.more, true);
  }));

test('AC3: list and search epics return only the requested project’s published epics', () =>
  as(async () => {
    const user = await who('u-maker');
    const r = await M.callTool(user, 'list_epics', { projectId: 'p1', query: 'accounts' });
    assert.deepEqual(r.epics.map((e) => e.id), ['e1']); // not f1 / g1 (other projects), not the draft e3
    assert.equal(r.epics[0].issueCount, 2); // SH-1 and the one created above
    assert.deepEqual((await M.callTool(user, 'list_epics', { projectId: 'p1' })).epics.map((e) => e.id), ['e1', 'e2']);
    const one = await M.callTool(user, 'get_epic', { projectId: 'p1', epicId: 'SH-E2' });
    assert.deepEqual(one.epic.issues.map((i) => i.key), ['SH-2']);
    await assert.rejects(M.callTool(user, 'get_epic', { projectId: 'p1', epicId: 'f1' }), (e: any) => e.status === 404); // another project's epic
    await assert.rejects(M.callTool(user, 'get_issue', { projectId: 'p1', issueId: 'x1' }), (e: any) => e.status === 404); // another project's issue
  }));

// ---------------------------------------------------------------- AC 4: no access
test('AC4: every tool refuses a project the person has no access to and returns none of its data', () =>
  as(async () => {
    const user = await who('u-maker'); // p1 only
    const before = await issueCount();
    for (const [name, args] of [
      ['list_issues', { projectId: 'p3' }],
      ['list_issues', { projectId: 'p2', query: 'login' }],
      ['get_issue', { projectId: 'p3', issueId: 'SE-1' }],
      ['list_epics', { projectId: 'p3' }],
      ['get_epic', { projectId: 'p3', epicId: 'g1' }],
      ['create_issue', { projectId: 'p3', title: 'Sneaky' }],
    ] as const) {
      await assert.rejects(M.callTool(user, name, args), (e: any) => e.status === 404 && !/Secret|SE-/.test(e.message), name);
      const r: any = await M.handleMessage(user, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
      assert.equal(r.result.isError, true, name);
      assert.ok(!/SE-1|Login secret|Accounts secret/.test(JSON.stringify(r)), name);
    }
    assert.equal(await issueCount(), before);
    // Someone with access only to p2 can't open p1 either.
    await assert.rejects(M.callTool(await who('u-p2'), 'list_issues', { projectId: 'p1' }), (e: any) => e.status === 404);
  }));

// ---------------------------------------------------------------- AC 5: validation
test('AC5: a missing title, bad field or unknown project is a validation error and nothing is saved', () =>
  as(async () => {
    const user = await who('u-maker');
    const before = await issueCount();
    const bad = (args: any, re: RegExp) => assert.rejects(M.callTool(user, 'create_issue', args), (e: any) => e.status === 400 && re.test(e.message));
    await bad({ projectId: 'p1' }, /title is required/);
    await bad({ projectId: 'p1', title: '   ' }, /title is required/);
    await bad({ projectId: 'p1', title: 'x'.repeat(201) }, /title must be at most/);
    await bad({ projectId: 'nope', title: 'Valid title' }, /Unknown project id/);
    await bad({ title: 'Valid title' }, /projectId is required/);
    await bad({ projectId: 'p1', title: 'T', type: 'Epic' }, /type must be one of/);
    await bad({ projectId: 'p1', title: 'T', priority: 'Urgent' }, /priority must be one of/);
    await bad({ projectId: 'p1', title: 'T', storyPoints: -1 }, /storyPoints/);
    await bad({ projectId: 'p1', title: 'T', epicId: 'f1' }, /epic isn’t in this project/);
    await bad({ projectId: 'p1', title: 'T', epicId: 'e3' }, /epic isn’t in this project/); // a draft epic
    await bad({ projectId: 'p1', title: 'T', labels: 5 }, /labels must be a list/);
    assert.equal(await issueCount(), before);
    const r: any = await M.handleMessage(user, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_issue', arguments: { projectId: 'p1' } } });
    assert.equal(r.result.structuredContent.error.code, 'validation_error');
    const unknown: any = await M.handleMessage(user, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nope', arguments: {} } });
    assert.equal(unknown.error.code, -32602);
  }));

// ---------------------------------------------------------------- AC 6: credentials
test('AC6: a missing, unknown, revoked or expired token resolves to no one, so the route answers 401', () =>
  as(async () => {
    assert.equal(await A.apiTokenUser(undefined), null);
    assert.equal(await A.apiTokenUser(''), null);
    assert.equal(await A.apiTokenUser('tfk_not-a-real-token'), null);
    assert.equal(await A.apiTokenUser(tokens['u-maker'].replace(/^tfk_/, '')), null); // without the prefix
    // Expired.
    const t = await A.createApiToken({ id: 'u-maker', workspace_id: WS }, { name: 'short' });
    assert.equal(((await A.apiTokenUser(t.token)) as any).id, 'u-maker');
    await D.q("update api_tokens set expires_at = now() - interval '1 minute' where id = $1", [t.id]);
    assert.equal(await A.apiTokenUser(t.token), null);
    // Revoked, and revoking someone else's token isn't possible.
    const r = await A.createApiToken({ id: 'u-maker', workspace_id: WS }, { name: 'revoked' });
    await assert.rejects(A.revokeApiToken({ id: 'u-viewer', workspace_id: WS }, r.id), (e: any) => e.status === 404);
    assert.ok(await A.apiTokenUser(r.token));
    await A.revokeApiToken({ id: 'u-maker', workspace_id: WS }, r.id);
    assert.equal(await A.apiTokenUser(r.token), null);
    // A disabled member loses access at once, and a role change applies to the next call.
    await D.q("update workspace_members set status = 'disabled' where user_id = 'u-p2'");
    assert.equal(await A.apiTokenUser(tokens['u-p2']), null);
    await D.q("update workspace_members set status = 'active' where user_id = 'u-p2'");
    // The token list never shows the token itself.
    const listed = await A.listApiTokens({ id: 'u-maker', workspace_id: WS });
    assert.ok(listed.length >= 3 && listed.every((x: any) => !('token' in x) && !('token_hash' in x)));
  }));

test('AC6: a token is only stored as a hash and the name and expiry are checked', () =>
  as(async () => {
    const u = { id: 'u-viewer', workspace_id: WS };
    const t = await A.createApiToken(u, { name: 'hash check' });
    const row = (await D.q('select token_hash from api_tokens where id = $1', [t.id])).rows[0];
    assert.notEqual(row.token_hash, t.token);
    assert.ok(t.token.startsWith('tfk_'));
    await assert.rejects(A.createApiToken(u, { name: '  ' }), (e: any) => e.status === 400);
    await assert.rejects(A.createApiToken(u, { name: 'x', expiresInDays: 0 }), (e: any) => e.status === 400);
    await assert.rejects(A.createApiToken(u, { name: 'x', expiresInDays: 9999 }), (e: any) => e.status === 400);
  }));

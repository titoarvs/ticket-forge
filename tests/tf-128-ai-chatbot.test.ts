// TF-128: the project's AI chatbot that drafts issues (replaces the AI helper panel). Run with `npm test`.
// The data tests use the embedded PostgreSQL (PGlite) in a temporary folder, never a real database, and the AI is stood in.
// (The ai_usage row and the plan's limit belong to the AI call itself, lib/claude.ts, which the chat uses unchanged.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-chat-'));
process.env.TICKETFORGE_DATA = dir;
process.env.DATABASE_URL = '';
process.env.SUPABASE_DB_URL = '';

let C: typeof import('../lib/chat');
let D: typeof import('../lib/db');

const WS = 'default';
const user = (id: string, extra: any = {}) => ({
  id,
  name: `Name ${id}`,
  is_owner: false,
  project_access: ['p1', 'p2'],
  permissions: ['issue.create'],
  workspace_id: WS,
  ...extra,
});
const userA = user('u-a');
const userB = user('u-b');
const viewer = user('u-view', { permissions: [] }); // can chat, cannot create issues
const as = <T>(fn: () => Promise<T>) => D.asWorkspace(WS, fn);
const stand = async ({ idea }: any) => ({
  ticket: {
    id: 'ai-id',
    key: 'AI-1',
    title: `Ticket for ${idea}`,
    type: 'Story',
    priority: 'High',
    storyPoints: 5,
    description: `Do: ${idea}`,
    acceptanceCriteria: ['Given a, when b, then c'],
    testCases: [],
  },
});
const issueKeys = async (p = 'p1') => (await D.q("select data->>'key' as k from issues where project_id = $1 order by position", [p])).rows.map((r) => r.k);
const draftOf = (r: any) => ({ ...r.messages[1].draft });

before(async () => {
  D = await import('../lib/db');
  C = await import('../lib/chat');
  const auth = await import('../lib/auth');
  await D.migrate();
  await auth.seedRoles();
  await D.q("insert into workspaces (id, name) values ($1, 'Test workspace') on conflict (id) do nothing", [WS]);
  for (const u of [userA, userB, viewer]) {
    await D.q("insert into users (id, email, name, password_hash, role_id, status) values ($1,$2,$3,'x','admin','active')", [u.id, `${u.id}@x.test`, u.name]);
    await D.q("insert into workspace_members (workspace_id, user_id, role_id, project_access, is_owner) values ($1,$2,'admin',$3,false)", [
      WS,
      u.id,
      JSON.stringify(u.project_access),
    ]);
  }
  for (const [id, key] of [['p1', 'SH'], ['p2', 'OT']])
    await D.q("insert into projects (id, name, key, data, created_by, workspace_id) values ($1,$2,$3,$4,$5,$6)", [
      id,
      `Project ${key}`,
      key,
      JSON.stringify({ name: `Project ${key}`, key, epics: [], workflow: [{ name: 'To Do', category: 'todo' }] }),
      userA.id,
      WS,
    ]);
  await D.q('insert into issues (project_id, id, position, data) values ($1,$2,$3,$4)', ['p1', 'i1', 0, JSON.stringify({ id: 'i1', key: 'SH-1', title: 'Existing', status: 'To Do' })]);
});
after(async () => {
  await (await D.db()).close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- AC 1: panel with a message list
test('AC1: a new chat is an empty message list the panel can show with its input', () =>
  as(async () => {
    assert.deepEqual((await C.chatHistory('p1', userA)).messages, []);
  }));

// ---------------------------------------------------------------- AC 2: the draft preview, no issue yet
test('AC2: a request is answered with a draft preview and no row is added to issues', () =>
  as(async () => {
    const was = await issueKeys();
    const r = await C.sendChatMessage('p1', userA, { message: 'Reset password by email' }, stand);
    assert.deepEqual(r.messages.map((m) => m.role), ['user', 'assistant']);
    const d = draftOf(r);
    assert.equal(d.title, 'Ticket for Reset password by email');
    assert.equal(d.type, 'Story');
    assert.equal(d.priority, 'High');
    assert.equal(d.storyPoints, 5);
    assert.ok(d.description);
    assert.deepEqual(d.acceptanceCriteria, ['Given a, when b, then c']);
    assert.deepEqual(await issueKeys(), was);
  }));

test('AC2: an empty or too long request is refused and nothing is saved or asked', () =>
  as(async () => {
    let asked = 0;
    const count = async (a: any) => (asked++, stand(a));
    const before = (await C.chatHistory('p1', userA)).messages.length;
    await assert.rejects(C.sendChatMessage('p1', userA, { message: '   ' }, count), (e: any) => e.status === 400);
    await assert.rejects(C.sendChatMessage('p1', userA, { message: 'x'.repeat(2001) }, count), (e: any) => e.status === 400);
    assert.equal(asked, 0);
    assert.equal((await C.chatHistory('p1', userA)).messages.length, before);
  }));

test('AC2: a new request refines the open draft', () =>
  as(async () => {
    let seen = '';
    await C.sendChatMessage('p1', userB, { message: 'Add dark mode' }, stand);
    await C.sendChatMessage('p1', userB, { message: 'Make it a bug' }, async (a: any) => ((seen = a.answers), stand(a)));
    assert.match(seen, /refining this draft/);
    assert.match(seen, /Ticket for Add dark mode/);
  }));

// ---------------------------------------------------------------- AC 3: Create
test('AC3: Create saves one issue in the current project with rev and updated_by, and the preview closes', () =>
  as(async () => {
    const r = await C.sendChatMessage('p1', userA, { message: 'Export to CSV' }, stand);
    const bot = r.messages[1];
    const was = await issueKeys();
    const done = await C.createFromDraft('p1', bot.id, userA, { ...draftOf(r), title: 'Export report to CSV', acceptanceCriteria: ['It downloads', '', 'It opens in Excel'] });
    assert.equal(done.issue.key, 'SH-2');
    assert.deepEqual(await issueKeys(), [...was, 'SH-2']);
    assert.deepEqual(await issueKeys('p2'), []);
    const row = (await D.q("select data, rev, updated_by from issues where project_id='p1' and data->>'key'='SH-2'")).rows[0];
    assert.equal(row.data.title, 'Export report to CSV'); // the edit was saved
    assert.deepEqual(row.data.acceptanceCriteria, ['It downloads', 'It opens in Excel']);
    assert.equal(row.data.status, 'To Do');
    assert.equal(row.updated_by, userA.id);
    assert.ok(Number(row.rev) > 0);
    // The preview stays closed when the chat is restored.
    const again = (await C.chatHistory('p1', userA)).messages.find((m) => m.id === bot.id)!;
    assert.equal(again.draft.created.key, 'SH-2');
    // A second Create of the same draft is refused: one issue per draft.
    await assert.rejects(C.createFromDraft('p1', bot.id, userA, draftOf(r)), (e: any) => e.status === 409);
    assert.deepEqual(await issueKeys(), [...was, 'SH-2']);
  }));

test('AC3: Create needs the permission to create issues', () =>
  as(async () => {
    const r = await C.sendChatMessage('p1', viewer, { message: 'Anything at all' }, stand);
    const was = await issueKeys();
    await assert.rejects(C.createFromDraft('p1', r.messages[1].id, viewer, draftOf(r)), (e: any) => e.status === 403);
    assert.deepEqual(await issueKeys(), was);
  }));

test('AC3: a discarded draft is closed and never becomes an issue', () =>
  as(async () => {
    const r = await C.sendChatMessage('p1', userA, { message: 'Something to drop' }, stand);
    const was = await issueKeys();
    await C.discardChatDraft('p1', r.messages[1].id, userA);
    await assert.rejects(C.discardChatDraft('p1', r.messages[1].id, userB), (e: any) => e.status === 404);
    assert.ok((await C.chatHistory('p1', userA)).messages.find((m) => m.id === r.messages[1].id)!.draft.discarded);
    assert.deepEqual(await issueKeys(), was);
  }));

// ---------------------------------------------------------------- AC 4: history per user and project
test('AC4: history is restored for the same person and project only', () =>
  as(async () => {
    const mine = (await C.chatHistory('p1', userA)).messages.map((m) => m.content);
    assert.ok(mine.includes('Reset password by email'));
    assert.ok(!mine.includes('Add dark mode'), 'user B’s message is not shown to user A');
    const theirs = (await C.chatHistory('p1', userB)).messages.map((m) => m.content);
    assert.ok(theirs.includes('Add dark mode') && !theirs.includes('Reset password by email'));
    assert.deepEqual((await C.chatHistory('p2', userA)).messages, [], 'another project starts empty');
  }));

test('AC4: a message can only be acted on by the person it belongs to', () =>
  as(async () => {
    const r = await C.sendChatMessage('p1', userA, { message: 'Private draft' }, stand);
    const was = await issueKeys();
    await assert.rejects(C.createFromDraft('p1', r.messages[1].id, userB, draftOf(r)), (e: any) => e.status === 404);
    await assert.rejects(C.createFromDraft('p2', r.messages[1].id, userA, draftOf(r)), (e: any) => e.status === 404);
    assert.deepEqual(await issueKeys(), was);
  }));

test('AC4: a person who can’t open the project gets no history and can’t chat', () =>
  as(async () => {
    const out = user('u-out', { project_access: ['p2'] });
    await assert.rejects(C.chatHistory('p1', out), (e: any) => e.status === 404);
    await assert.rejects(C.sendChatMessage('p1', out, { message: 'Hello there' }, stand), (e: any) => e.status === 404);
  }));

// ---------------------------------------------------------------- AC 5: plan limit
test('AC5: when the plan’s AI limit is reached the request is blocked and nothing is saved', () =>
  as(async () => {
    const limit = async () => {
      throw Object.assign(new Error('Your Free plan allows 50 AI actions this month. Upgrade for more.'), { status: 402, extra: { code: 'limit', metric: 'aiCalls' } });
    };
    const before = (await C.chatHistory('p1', userA)).messages.length;
    await assert.rejects(C.sendChatMessage('p1', userA, { message: 'One more request' }, limit), (e: any) => e.status === 402 && e.extra.code === 'limit');
    assert.equal((await C.chatHistory('p1', userA)).messages.length, before);
  }));

// ---------------------------------------------------------------- AC 6: empty title
test('AC6: Create with an empty title is refused and no issue is saved', () =>
  as(async () => {
    const r = await C.sendChatMessage('p1', userA, { message: 'Title will be removed' }, stand);
    const was = await issueKeys();
    for (const title of ['', '   ', undefined])
      await assert.rejects(C.createFromDraft('p1', r.messages[1].id, userA, { ...draftOf(r), title }), (e: any) => e.status === 400 && /title/i.test(e.message));
    assert.deepEqual(await issueKeys(), was);
    // The draft is still open, so it can be created once it has a title.
    const done = await C.createFromDraft('p1', r.messages[1].id, userA, { ...draftOf(r), title: 'Now it has one' });
    assert.ok(done.issue.key);
  }));

test('cleanDraft keeps only known fields and brings type, priority and points to valid values', () => {
  const d: any = C.cleanDraft({ title: ' T ', type: 'Nonsense', priority: 'Urgent', storyPoints: -3, acceptanceCriteria: 'a\n\nb', status: 'Done', assignee: 'x', evil: 1 });
  assert.equal(d.title, 'T');
  assert.equal(d.type, 'Story');
  assert.equal(d.priority, 'Medium');
  assert.equal(d.storyPoints, null);
  assert.deepEqual(d.acceptanceCriteria, ['a', 'b']);
  assert.ok(!('status' in d) && !('assignee' in d) && !('evil' in d));
});

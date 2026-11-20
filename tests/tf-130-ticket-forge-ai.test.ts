// Ticket Forge AI: the one chat that replaced the help chatbot and the project's AI helper. Run with
// `npm test`. The data tests use the embedded PostgreSQL (PGlite) in a temporary folder, and the AI
// calls are stood in.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-ai-chat-'));
process.env.TICKETFORGE_DATA = dir;
process.env.DATABASE_URL = '';
process.env.SUPABASE_DB_URL = '';

let T: typeof import('../lib/assistant/turn');
let R: typeof import('../lib/assistant/reply');
let C: typeof import('../lib/chat');
let D: typeof import('../lib/db');

const WS = 'default';
const person = {
  id: 'u-ai',
  name: 'Ana Reyes',
  is_owner: false,
  project_access: ['p1'],
  permissions: ['issue.create'],
  workspace_id: WS,
};
const as = <T>(fn: () => Promise<T>) => D.asWorkspace(WS, fn);
/** A stand-in AI that streams `text` in two pieces and remembers what it was asked. */
const streams =
  (text: string, seen: any[] = []) =>
  async (opts: any) => {
    seen.push(opts);
    const half = Math.floor(text.length / 2);
    opts.onText?.(half, half, text.slice(0, half));
    opts.onText?.(text.length - half, text.length, text.slice(half));
    return text;
  };
const write = async ({ idea }: any) => ({
  ticket: { title: `Story: ${idea}`, type: 'Story', priority: 'High', acceptanceCriteria: ['a'] },
});

before(async () => {
  D = await import('../lib/db');
  C = await import('../lib/chat');
  T = await import('../lib/assistant/turn');
  R = await import('../lib/assistant/reply');
  const auth = await import('../lib/auth');
  await D.migrate();
  await auth.seedRoles();
  await D.q("insert into workspaces (id, name) values ($1, 'WS') on conflict (id) do nothing", [
    WS,
  ]);
  await D.q(
    "insert into users (id, email, name, password_hash, role_id, status) values ($1,'ai@x.test',$2,'x','admin','active')",
    [person.id, person.name],
  );
  await D.q(
    "insert into workspace_members (workspace_id, user_id, role_id, project_access, is_owner) values ($1,$2,'admin',$3,false)",
    [WS, person.id, JSON.stringify(person.project_access)],
  );
  const data = { name: 'Clock', key: 'CL', epics: [], workflow: [{ name: 'To Do' }] };
  await D.q(
    "insert into projects (id, name, key, data, created_by, workspace_id) values ('p1','Clock','CL',$1,$2,$3)",
    [JSON.stringify(data), person.id, WS],
  );
  await D.q("insert into issues (project_id, id, position, data) values ('p1','i1',0,$1)", [
    JSON.stringify({ id: 'i1', key: 'CL-1', title: 'Clock in', status: 'To Do', assignee: 'Ana' }),
  ]);
});
after(async () => {
  await (await D.db()).close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the draft marker never shows, even while it is still arriving', () => {
  assert.equal(R.visiblePart('Sure.\n[[DRAFT: a story]]', true), 'Sure.\n');
  assert.equal(R.visiblePart('Sure.\n[[DR'), 'Sure.\n');
  assert.equal(R.visiblePart('Sure.\n[[DR', true), 'Sure.\n[[DR');
  assert.equal(R.draftRequest('Ok\n[[DRAFT: reset password by email]]'), 'reset password by email');
  assert.equal(R.draftRequest('[[DRAFT]]'), '');
  assert.equal(R.draftRequest('No draft here'), null);
  const out: string[] = [];
  const s = R.replyStream((t) => out.push(t));
  for (const c of ['Hel', 'lo [', '[DRA', 'FT: x]]']) s.push(c);
  assert.equal(out.join(''), 'Hello ');
});

test('in a project the reply streams, knows the project and the turn is saved', () =>
  as(async () => {
    const seen: any[] = [];
    const deltas: string[] = [];
    const r = await T.chatTurn({
      user: person,
      projectId: 'p1',
      message: 'What is open?',
      ask: streams('**CL-1** Clock in is open.', seen),
      onDelta: (t) => deltas.push(t),
    });
    assert.equal(deltas.join(''), '**CL-1** Clock in is open.');
    assert.equal(seen[0].task, 'chat');
    assert.match(seen[0].system, /CL-1 \| .*Clock in/);
    assert.deepEqual(
      r.messages.map((m) => m.role),
      ['user', 'assistant'],
    );
    const saved = (await C.chatHistory('p1', person)).messages;
    assert.equal(saved.at(-1).content, '**CL-1** Clock in is open.');
    // The next turn is given the conversation so far.
    await T.chatTurn({
      user: person,
      projectId: 'p1',
      message: 'Thanks',
      ask: streams('Ok', seen),
    });
    assert.match(seen[1].prompt, /Person: What is open\?/);
  }));

test('asking for an issue gives a draft preview and writes no issue', () =>
  as(async () => {
    const statuses: string[] = [];
    const r = await T.chatTurn({
      user: person,
      projectId: 'p1',
      message: 'Add password reset',
      ask: streams('Here is a draft.\n[[DRAFT: password reset by email]]'),
      write,
      onStatus: (s) => statuses.push(s),
    });
    const reply = r.messages[1];
    assert.equal(reply.content, 'Here is a draft.');
    assert.equal(reply.draft.title, 'Story: password reset by email');
    assert.deepEqual(statuses, ['drafting']);
    const n = (await D.q("select count(*)::int as n from issues where project_id = 'p1'")).rows[0]
      .n;
    assert.equal(n, 1);
  }));

test('outside projects nothing is saved, the history comes from the browser and no draft is made', () =>
  as(async () => {
    const seen: any[] = [];
    const before = (await C.chatHistory('p1', person)).messages.length;
    const r = await T.chatTurn({
      user: person,
      message: 'And how do I export?',
      history: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }, 'junk'],
      ask: streams('Use Export.\n[[DRAFT: something]]', seen),
      write,
    });
    assert.equal(r.messages[1].content, 'Use Export.');
    assert.equal(r.messages[1].draft, null);
    assert.match(seen[0].prompt, /You: Hello!/);
    assert.match(seen[0].system, /open the project first/);
    assert.equal((await C.chatHistory('p1', person)).messages.length, before);
  }));

test('with no AI set up the free rule-based helper answers', () =>
  as(async () => {
    const noAi = async () => {
      throw Object.assign(new Error('AI isn’t set up'), { status: 503 });
    };
    const r = await T.chatTurn({ user: person, message: 'How do I export?', ask: noAi });
    assert.match(r.messages[1].content, /Export menu/);
  }));

test('the plan’s AI limit stops the turn and nothing is saved', () =>
  as(async () => {
    const limit = async () => {
      throw Object.assign(new Error('Limit reached'), { status: 402, extra: { code: 'limit' } });
    };
    const before = (await C.chatHistory('p1', person)).messages.length;
    await assert.rejects(
      T.chatTurn({ user: person, projectId: 'p1', message: 'Hi', ask: limit }),
      (e: any) => e.status === 402,
    );
    assert.equal((await C.chatHistory('p1', person)).messages.length, before);
  }));

test('a person who can’t open the project can’t chat in it', () =>
  as(async () => {
    const out = { ...person, id: 'u-out', project_access: [] };
    await assert.rejects(
      T.chatTurn({ user: out, projectId: 'p1', message: 'Hi', ask: streams('x') }),
      (e: any) => e.status === 404,
    );
  }));

test('New chat deletes only this person’s messages in the project', () =>
  as(async () => {
    await C.clearChat('p1', person);
    assert.deepEqual((await C.chatHistory('p1', person)).messages, []);
  }));

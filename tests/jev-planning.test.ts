// Jev for planning development work: the development order of an epic or sprint (lib/devorder.ts) and the check
// before coding several issues at once (lib/parallel.ts). Jev and the AI are stood in for, so nothing leaves the machine.
// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderTickets, orderHints, planOrder, issuesFor, hardDeps } from '../lib/devorder';
import { applyOrder } from '../lib/reorder';
import { planParallel, busyFromJobs, parallelHints, checkParallel } from '../lib/parallel';

const T = (key: string, extra: any = {}) => ({
  id: key.toLowerCase(),
  key,
  title: `Issue ${key}`,
  type: 'Story',
  status: 'To Do',
  priority: 'Medium',
  storyPoints: 3,
  links: [],
  ...extra,
});
const blockedBy = (key: string) => ({ type: 'is blocked by', targetId: key.toLowerCase() });
const keys = (order: any[]) => order.map((o) => o.key);
const project = (tickets: any[], extra: any = {}) => ({
  id: 'p1',
  name: 'Shop',
  workflow: [
    { name: 'To Do', category: 'todo' },
    { name: 'Done', category: 'done' },
  ],
  tickets,
  ...extra,
});

// Stand-ins for Jev and the AI.
const off = { jevOn: async () => false, jevMin: async () => 0.6 };
const failingAi = async () => {
  throw new Error('no AI configured');
};
const jevWith = (answers: Record<string, any>, seen: any[] = []) => ({
  jevOn: async () => true,
  jevMin: async () => 0.6,
  jevDecide: (async (req: any) => {
    seen.push(req);
    return {
      answers: Object.fromEntries(
        Object.keys(req.questions)
          .filter((k) => answers[k])
          .map((k) => [k, answers[k]]),
      ),
      model: 'stand-in',
      usage: null,
    };
  }) as any,
});

// ---------------------------------------------------------------- development order: the rules

test('blocked issues come after their blockers, whatever their priority', () => {
  const tickets = [T('A-1', { priority: 'Highest', links: [blockedBy('A-2')] }), T('A-2', { priority: 'Low' })];
  const { order } = orderTickets(tickets);
  assert.deepEqual(keys(order), ['A-2', 'A-1']);
  assert.match(order[0].reason, /A-1 needs it first/);
  assert.match(order[1].reason, /after A-2 \(blocked by\)/i);
});

test('"blocks" links count the same as "is blocked by" from the other side', () => {
  const tickets = [T('A-1'), T('A-2', { links: [{ type: 'blocks', targetId: 'a-1' }] })];
  assert.deepEqual([...hardDeps(tickets)['a-1']], ['a-2']);
  assert.deepEqual(keys(orderTickets(tickets).order), ['A-2', 'A-1']);
});

test('among free issues: priority, then what others need, backend before frontend, smaller first', () => {
  const tickets = [
    T('A-1', { priority: 'Low' }),
    T('A-2', { priority: 'High' }),
    T('A-3', { layer: 'frontend', priority: 'Medium', storyPoints: 5 }),
    T('A-4', { layer: 'backend', priority: 'Medium', storyPoints: 5 }),
    T('A-5', { priority: 'Medium', storyPoints: 1 }),
  ];
  const { order } = orderTickets(tickets);
  assert.deepEqual(keys(order), ['A-2', 'A-4', 'A-5', 'A-3', 'A-1']);
  assert.match(order.find((o) => o.key === 'A-4')!.reason, /backend: the screens build on it/i);
  assert.match(order.find((o) => o.key === 'A-5')!.reason, /small \(1 pt\)/i);
});

test('an issue many others wait on goes first', () => {
  const tickets = [
    T('A-1', { priority: 'High' }),
    T('A-2'),
    T('A-3', { links: [blockedBy('A-2')] }),
    T('A-4', { links: [blockedBy('A-3')] }),
  ];
  const { order } = orderTickets(tickets);
  assert.equal(order[0].key, 'A-2');
  assert.match(order[0].reason, /A-3 needs it first/);
});

test('links that block each other are reported, and every issue is still ordered once', () => {
  const tickets = [T('A-1', { links: [blockedBy('A-2')] }), T('A-2', { links: [blockedBy('A-1')] }), T('A-3')];
  const { order, loops } = orderTickets(tickets);
  assert.equal(order.length, 3);
  assert.equal(new Set(keys(order)).size, 3);
  assert.deepEqual(
    loops.map((l) => [...l].sort()),
    [['A-1', 'A-2']],
  );
  assert.ok(order.some((o) => /block each other/i.test(o.reason)));
});

test('an open blocker outside the list pushes an issue down and is named', () => {
  const outside = T('X-9');
  const tickets = [T('A-1', { priority: 'High', links: [blockedBy('X-9')] }), T('A-2')];
  const { order } = orderTickets(tickets, { project: project([...tickets, outside]) });
  assert.deepEqual(keys(order), ['A-2', 'A-1']);
  assert.match(order[1].reason, /still blocked by X-9, outside this list/i);
  // Done blockers don't count.
  const doneOutside = { ...outside, status: 'Done' };
  assert.equal(orderTickets(tickets, { project: project([...tickets, doneOutside]) }).order[0].key, 'A-1');
});

test('hints add prerequisites and urgency, but never override links or make a loop', () => {
  const tickets = [T('A-1'), T('A-2', { links: [blockedBy('A-1')] }), T('A-3')];
  const hints = {
    'a-1': { source: 'jev' as const, prereqs: ['a-2'] }, // would make a loop with the link: ignored
    'a-3': { source: 'jev' as const, prereqs: [], urgency: 9 },
  };
  const { order } = orderTickets(tickets, { hints });
  assert.deepEqual(keys(order), ['A-3', 'A-1', 'A-2']);
  assert.match(order[0].reason, /Jev rates it early \(9\/9\)/);
  assert.deepEqual(order[1].suggestedWaitsFor, []);
  const { order: o2 } = orderTickets([T('B-1'), T('B-2')], { hints: { 'b-1': { source: 'ai', prereqs: ['b-2'] } } });
  assert.deepEqual(keys(o2), ['B-2', 'B-1']);
  assert.match(o2[1].reason, /after B-2 \(AI: builds on it\)/i);
});

test('epic and sprint scopes: top-level open issues, done ones apart, sub-tasks with their parent', () => {
  const p = project([
    T('A-1', { epicId: 'e1', sprintId: 's1' }),
    T('A-2', { epicId: 'e1', status: 'Done' }),
    T('A-3', { epicId: 'e1', parentId: 'a-1', sprintId: 's1' }),
    T('A-4', { epicId: 'e2', sprintId: 's1' }),
  ]);
  const epic = issuesFor(p, { epicId: 'e1' });
  assert.deepEqual(
    epic.open.map((t) => t.key),
    ['A-1'],
  );
  assert.deepEqual(
    epic.done.map((t) => t.key),
    ['A-2'],
  );
  assert.deepEqual(
    issuesFor(p, { sprintId: 's1' }).open.map((t) => t.key),
    ['A-1', 'A-4'],
  );
});

test('applying the order moves only those issues, within the places they hold', () => {
  assert.deepEqual(applyOrder(['x', 'a', 'y', 'b', 'c', 'z'], ['c', 'a', 'b']), ['x', 'c', 'y', 'a', 'b', 'z']);
  assert.deepEqual(applyOrder(['a', 'b'], ['b', 'gone', 'a']), ['b', 'a']);
  assert.deepEqual(applyOrder(['a', 'b'], []), ['a', 'b']);
});

// ---------------------------------------------------------------- development order: Jev, the AI and the rules

test('Jev on: one pick-one and one 0-9 question per issue, confident answers used', async () => {
  const tickets = [T('A-1'), T('A-2'), T('A-3')];
  const seen: any[] = [];
  const use = {
    ...jevWith(
      {
        'A-1.needs': { choice: 'A-3', confidence: 0.9 },
        'A-1.early': { score: 5, confidence: 0.8 },
        'A-2.needs': { choice: 'none', confidence: 0.9 },
        'A-2.early': { score: 1, confidence: 0.9 },
        'A-3.needs': { choice: 'none', confidence: 0.95 },
        'A-3.early': { score: 8, confidence: 0.9 },
      },
      seen,
    ),
    askJson: async () => {
      throw new Error('the AI should not be asked');
    },
  };
  const r = await planOrder({ project: project(tickets), ticketIds: tickets.map((t) => t.id), use });
  assert.equal(r.engine, 'jev');
  assert.equal(r.byJev, 3);
  assert.deepEqual(keys(r.order), ['A-3', 'A-1', 'A-2']);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].questions['A-1.needs'].type, 'choice');
  assert.ok(
    'none' in seen[0].questions['A-1.needs'].criteria &&
      'A-2' in seen[0].questions['A-1.needs'].criteria &&
      !('A-1' in seen[0].questions['A-1.needs'].criteria),
  );
  assert.equal(seen[0].questions['A-1.early'].type, 'score');
  assert.match(r.summary, /Jev decided 3/);
});

test('Jev unsure about an issue: that one goes to the AI', async () => {
  const tickets = [T('A-1'), T('A-2')];
  let asked = '';
  const use = {
    ...jevWith({
      'A-1.needs': { choice: 'none', confidence: 0.9 },
      'A-1.early': { score: 5, confidence: 0.9 },
      'A-2.needs': { choice: 'A-1', confidence: 0.4 },
      'A-2.early': { score: 5, confidence: 0.9 },
    }),
    askJson: async (o: any) => {
      asked = o.prompt;
      return { items: [{ key: 'A-2', needsFirst: [], urgency: 9, why: 'foundation' }] };
    },
  };
  const r = await orderHints({ project: project(tickets), tickets, use });
  assert.equal(r.engine, 'jev+ai');
  assert.equal(r.hints['a-1'].source, 'jev');
  assert.equal(r.hints['a-2'].source, 'ai');
  assert.match(asked, /Decide for: A-2$/);
});

test('Jev unreachable: the AI answers', async () => {
  const tickets = [T('A-1'), T('A-2')];
  const use = {
    jevOn: async () => true,
    jevMin: async () => 0.6,
    jevDecide: (async () => {
      throw new Error('Couldn’t reach Jev');
    }) as any,
    askJson: async () => ({
      items: [
        { key: 'A-1', needsFirst: ['A-2'], urgency: 4 },
        { key: 'A-2', needsFirst: [], urgency: 6 },
      ],
    }),
  };
  const r = await planOrder({ project: project(tickets), ticketIds: ['a-1', 'a-2'], use });
  assert.equal(r.engine, 'ai');
  assert.deepEqual(keys(r.order), ['A-2', 'A-1']);
  assert.match(r.note, /Couldn’t reach Jev/);
});

test('Jev off and the AI failing: the rules decide', async () => {
  const tickets = [T('A-1', { priority: 'Low' }), T('A-2', { priority: 'High' })];
  const r = await planOrder({ project: project(tickets), ticketIds: ['a-1', 'a-2'], use: { ...off, askJson: failingAi } });
  assert.equal(r.engine, 'rules');
  assert.deepEqual(keys(r.order), ['A-2', 'A-1']);
  assert.match(r.note, /no AI configured/);
  // Rules only (Use Jev / AI hints off) asks nobody.
  const r2 = await planOrder({
    project: project(tickets),
    ticketIds: ['a-1', 'a-2'],
    smart: false,
    use: {
      jevOn: async () => {
        throw new Error('asked');
      },
    },
  });
  assert.equal(r2.engine, 'rules');
});

test('nothing to order is a clear 400', async () => {
  await assert.rejects(
    planOrder({ project: project([T('A-1', { epicId: 'e1', status: 'Done' })]), epicId: 'e1', smart: false }),
    (e: any) => e.status === 400 && /done/.test(e.message),
  );
});

// ---------------------------------------------------------------- coding several issues at once

const spec = (key: string, files: string[], modules: string[] = [], epicId = 'e1') => ({
  ticketId: key.toLowerCase(),
  key,
  title: key,
  epicId,
  status: 'draft',
  files: files.map((path) => ({ path, action: 'modify' })),
  modules,
});

test('issues touching the same file go to different rounds; the rest run together', () => {
  const tickets = [T('A-1'), T('A-2'), T('A-3')];
  const specs = [spec('A-1', ['lib/store.ts', 'lib/a.ts']), spec('A-2', ['./LIB/Store.ts']), spec('A-3', ['client/c.tsx'])];
  const r = planParallel({ tickets, specs });
  assert.deepEqual(r.runNow, ['a-1', 'a-3']);
  assert.deepEqual(
    r.wait.map((w) => [w.key, w.round, w.after]),
    [['A-2', 2, ['A-1']]],
  );
  assert.equal(r.conflicts[0].kind, 'file');
  assert.deepEqual(r.conflicts[0].keys, ['A-1', 'A-2']);
});

test('specs of different epics still conflict when coded together', () => {
  const tickets = [T('A-1'), T('B-1')];
  const r = planParallel({ tickets, specs: [spec('A-1', ['lib/x.ts'], [], 'e1'), spec('B-1', ['lib/x.ts'], [], 'e2')] });
  assert.equal(r.rounds.length, 2);
});

test('module-only overlaps conflict, unless judged separate files', () => {
  const tickets = [T('A-1'), T('A-2')];
  const specs = [spec('A-1', ['lib/a.ts'], ['lib/store']), spec('A-2', ['lib/b.ts'], ['lib/store'])];
  assert.equal(planParallel({ tickets, specs }).rounds.length, 2);
  const ok = planParallel({ tickets, specs, cleared: new Set(['A-1|A-2|lib/store']) });
  assert.equal(ok.rounds.length, 1);
  assert.equal(ok.conflicts[0].cleared, true);
});

test('a blocked issue waits for its blocker; a running job holds back issues sharing its files', () => {
  const tickets = [T('A-1'), T('A-2', { links: [blockedBy('A-1')] }), T('A-3')];
  const specs = [spec('A-1', ['a.ts']), spec('A-2', ['b.ts']), spec('A-3', ['shared.ts']), spec('X-1', ['shared.ts'])];
  const jobs = [
    { ticketId: 'x-1', ticketKey: 'X-1', status: 'running', side: 'frontend', files: [] },
    { ticketId: 'z-1', ticketKey: 'Z-1', status: 'merged', files: [{ path: 'a.ts' }] },
  ];
  const busy = busyFromJobs(jobs, specs, new Set(tickets.map((t) => t.id)));
  assert.deepEqual(
    busy.map((b) => b.key),
    ['X-1'],
  ); // merged code doesn't count
  const r = planParallel({ tickets, specs, busy });
  assert.deepEqual(r.runNow, ['a-1']);
  assert.deepEqual(r.wait.map((w) => w.key).sort(), ['A-2', 'A-3']);
  assert.match(r.wait.find((w) => w.key === 'A-3')!.why, /X-1 is being coded now/);
  assert.match(r.wait.find((w) => w.key === 'A-2')!.why, /A-2 is blocked by A-1/);
});

test('unmerged finished code counts with its changed files', () => {
  const busy = busyFromJobs(
    [{ ticketId: 'x-2', ticketKey: 'X-2', status: 'review', files: [{ path: 'lib/store.ts' }] }],
    [],
    new Set(['a-1']),
  );
  const r = planParallel({ tickets: [T('A-1')], specs: [spec('A-1', ['lib/store.ts'])], busy });
  assert.deepEqual(r.runNow, []);
  assert.match(r.wait[0].why, /X-2 has code not merged yet/);
});

test('Jev: likely conflicts for issues without a spec, and harmless module overlaps', async () => {
  const tickets = [T('A-1'), T('A-2'), T('A-3')];
  const specs = [spec('A-1', ['lib/a.ts'], ['lib/store']), spec('A-2', ['lib/b.ts'], ['lib/store'])];
  const seen: any[] = [];
  const use = {
    ...jevWith({ 'A-3.overlaps': { choice: 'A-1', confidence: 0.85 }, pair0: { noul: 0.1, confidence: 0.9 } }, seen),
    askJson: async () => {
      throw new Error('the AI should not be asked');
    },
  };
  const h = await parallelHints({ project: project(tickets), tickets, specs, use });
  assert.equal(h.engine, 'jev');
  assert.equal(seen[0].questions.pair0.type, 'noul');
  assert.equal(seen[0].questions['A-3.overlaps'].type, 'choice');
  assert.deepEqual(
    h.likely.map((l) => [l.a, l.b]),
    [['a-3', 'a-1']],
  );
  assert.ok(h.cleared.has('A-1|A-2|lib/store'));
  const plan = planParallel({ tickets, specs, likely: h.likely as any, cleared: h.cleared });
  assert.deepEqual(plan.runNow, ['a-1', 'a-2']);
  assert.deepEqual(
    plan.wait.map((w) => w.key),
    ['A-3'],
  );
});

test('Jev unsure: the AI decides; both failing: the rules (shared module = conflict, no spec = unchecked)', async () => {
  const tickets = [T('A-1'), T('A-2'), T('A-3')];
  const specs = [spec('A-1', ['lib/a.ts'], ['lib/store']), spec('A-2', ['lib/b.ts'], ['lib/store'])];
  const unsure = {
    ...jevWith({ 'A-3.overlaps': { choice: 'A-1', confidence: 0.3 }, pair0: { noul: 0.5, confidence: 0.5 } }),
    askJson: async () => ({ likely: [{ a: 'A-3', b: 'A-2', why: 'same checkout form' }], modules: [{ pair: 0, same: false }] }),
  };
  const h = await parallelHints({ project: project(tickets), tickets, specs, use: unsure });
  assert.equal(h.engine, 'ai');
  assert.deepEqual(
    h.likely.map((l) => [l.a, l.b, l.source]),
    [['a-3', 'a-2', 'ai']],
  );
  assert.ok(h.cleared.has('A-1|A-2|lib/store'));
  const rules = await checkParallel({
    project: project(tickets),
    ticketIds: tickets.map((t) => t.id),
    specs,
    jobs: [],
    use: { ...off, askJson: failingAi },
  });
  assert.equal(rules.engine, 'rules');
  assert.deepEqual(rules.noSpec, ['A-3']);
  assert.deepEqual(rules.runNow, ['a-1', 'a-3']);
  assert.deepEqual(
    rules.wait.map((w) => w.key),
    ['A-2'],
  );
  assert.match(rules.summary, /2 of 3 can be coded together now/);
});

test('an issue already being coded is reported and not planned again', async () => {
  const tickets = [T('A-1'), T('A-2')];
  const r = await checkParallel({
    project: project(tickets),
    ticketIds: ['a-1', 'a-2'],
    specs: [],
    jobs: [{ ticketId: 'a-1', ticketKey: 'A-1', status: 'running' }],
    smart: false,
  });
  assert.deepEqual(r.alreadyRunning, ['A-1']);
  assert.deepEqual(r.runNow, ['a-2']);
});

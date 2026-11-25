// TF-141: the status flow graph. Run with `npm test`. These tests cover the helpers behind the node
// graph in Project settings → Workflow (client/WorkflowEditor/flow-graph.ts) and the server's
// duplicate-name check (lib/workflow.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toDraft,
  addNode,
  removeNode,
  renameNode,
  connect,
  removeEdge,
  checkDraft,
  applyDraft,
  addAfter,
  insertOn,
  settle,
  tidy,
  freshName,
} from '../client/WorkflowEditor/flow-graph';
import { duplicateStatus } from '../lib/workflow';

const wf = () => [
  { id: 'a', name: 'To Do', category: 'todo', next: ['b'], color: '#0c66e4' },
  { id: 'b', name: 'In Progress', category: 'inprogress', next: ['c'], wip: 3 },
  { id: 'c', name: 'Done', category: 'done' },
];

test('one node per status and one edge per saved transition', () => {
  const d = toDraft(wf());
  assert.deepEqual(
    d.nodes.map((n) => n.name),
    ['To Do', 'In Progress', 'Done'],
  );
  assert.deepEqual(d.edges, [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ]);
});

test('statuses with no transitions are unconnected nodes', () => {
  const d = toDraft([
    { id: 'a', name: 'To Do', category: 'todo' },
    { id: 'b', name: 'Done', category: 'done', next: [] },
  ]);
  assert.equal(d.nodes.length, 2);
  assert.equal(d.edges.length, 0);
});

test('transitions to unknown statuses, to itself or twice are ignored', () => {
  const d = toDraft([
    { id: 'a', name: 'A', category: 'todo', next: ['a', 'zz', 'b', 'b'] },
    { id: 'b', name: 'B', category: 'done' },
  ]);
  assert.deepEqual(d.edges, [{ from: 'a', to: 'b' }]);
});

test('an editor can add a status and a transition and save them', () => {
  let d = toDraft(wf());
  d = addNode(d, 'n', 'Review');
  d = connect(d, 'b', 'n');
  d = connect(d, 'b', 'n'); // the same transition twice is kept once
  d = connect(d, 'n', 'n'); // a status can't move to itself
  assert.equal(checkDraft(d), '');
  const out = applyDraft(wf(), d);
  // the new status goes before the last one, like "Add status"
  assert.deepEqual(
    out.workflow.map((w) => w.name),
    ['To Do', 'In Progress', 'Review', 'Done'],
  );
  // saving and reading it back (a reload) gives the same graph
  const again = toDraft(out.workflow);
  assert.ok(again.nodes.some((n) => n.name === 'Review'));
  assert.ok(again.edges.some((e) => e.from === 'b' && e.to === 'n'));
  assert.equal(again.edges.length, 3);
  // other settings of existing statuses are kept
  assert.equal(out.workflow[0].color, '#0c66e4');
  assert.equal(out.workflow[1].wip, 3);
});

test('a duplicate status name is rejected', () => {
  let d = addNode(toDraft(wf()), 'n', ' in progress ');
  assert.match(checkDraft(d), /duplicate/);
  d = renameNode(d, 'n', { name: 'Review' });
  assert.equal(checkDraft(d), '');
  assert.match(checkDraft(addNode(toDraft(wf()), 'm', '  ')), /needs a name/);
});

test('the server rejects a workflow that uses a name twice', () => {
  assert.equal(duplicateStatus(wf()), '');
  assert.equal(duplicateStatus([...wf(), { id: 'x', name: 'done ' }]), 'done');
  assert.equal(duplicateStatus(undefined), '');
});

test('removing a status removes its transitions and moves its issues', () => {
  const d = removeNode(toDraft(wf()), 'b');
  assert.deepEqual(d.edges, []);
  const out = applyDraft(wf(), d);
  assert.deepEqual(
    out.workflow.map((w) => w.id),
    ['a', 'c'],
  );
  assert.deepEqual(out.removed, [{ from: 'In Progress', to: 'To Do' }]);
  assert.deepEqual(out.workflow[0].next, []);
});

test('removing a transition keeps both statuses', () => {
  const d = removeEdge(toDraft(wf()), 'a', 'b');
  assert.equal(d.nodes.length, 3);
  assert.deepEqual(d.edges, [{ from: 'b', to: 'c' }]);
});

test('renaming reports what the issues move to', () => {
  const out = applyDraft(wf(), renameNode(toDraft(wf()), 'c', { name: 'Finished' }));
  assert.deepEqual(out.renamed, [{ from: 'Done', to: 'Finished' }]);
});

const overlaps = (n: { x: number; y: number }[]) =>
  n.some((a, i) =>
    n.some((b, j) => j > i && Math.abs(a.x - b.x) < 160 && Math.abs(a.y - b.y) < 160),
  );

test('layouts saved when nodes were smaller are spread apart, and stay put once saved', () => {
  const old = Array.from({ length: 7 }, (_, i) => ({
    id: `s${i}`,
    name: `S${i}`,
    category: 'todo',
    x: 16 + (i % 4) * 202,
    y: 16 + Math.floor(i / 4) * 78,
  }));
  const d = toDraft(old);
  assert.equal(overlaps(d.nodes), false);
  assert.deepEqual(toDraft(applyDraft(old, d).workflow), d);
  const free = { x: 1000, y: 0 };
  assert.deepEqual(settle(free, d.nodes), free);
});

test('a status added after another is connected and comes after it on the board', () => {
  const d = addAfter(toDraft(wf()), 'a', { id: 'n', name: 'Ready', category: 'todo' });
  assert.ok(d.edges.some((e) => e.from === 'a' && e.to === 'n'));
  assert.equal(overlaps(d.nodes), false);
  const names = (x: typeof d) => applyDraft(wf(), x).workflow.map((w) => w.name);
  assert.deepEqual(names(d), ['To Do', 'Ready', 'In Progress', 'Done']);
  // one after another new one; and a finished status stays the last column
  const two = addAfter(d, 'n', { id: 'm', name: 'Queued', category: 'todo' });
  assert.deepEqual(names(two), ['To Do', 'Ready', 'Queued', 'In Progress', 'Done']);
  const end = addAfter(toDraft(wf()), 'c', { id: 'n', name: 'Reopened', category: 'todo' });
  assert.deepEqual(names(end), ['To Do', 'In Progress', 'Reopened', 'Done']);
});

test('a status added on a transition goes between its two statuses', () => {
  const d = insertOn(
    toDraft(wf()),
    { from: 'b', to: 'c' },
    { id: 'n', name: 'Review', category: 'inprogress' },
  );
  assert.deepEqual(d.edges, [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'n' },
    { from: 'n', to: 'c' },
  ]);
  assert.equal(overlaps(d.nodes), false);
  assert.deepEqual(
    applyDraft(wf(), d).workflow.map((w) => w.id),
    ['a', 'b', 'n', 'c'],
  );
});

test('color and limit changed on the canvas are saved; untouched ones are kept', () => {
  let d = renameNode(toDraft(wf()), 'a', { color: null });
  d = renameNode(d, 'c', { wip: 5, fromAny: true });
  const out = applyDraft(wf(), d).workflow;
  assert.equal('color' in out[0], false);
  assert.equal(out[1].wip, 3);
  assert.equal(out[2].wip, 5);
  assert.equal(out[2].fromAny, true);
});

test('tidy up follows the board order and new names are unique', () => {
  const d = tidy(toDraft(wf()), ['c', 'b', 'a']);
  const x = (id: string) => d.nodes.find((n) => n.id === id)!.x;
  assert.ok(x('c') < x('b') && x('b') < x('a'));
  const one = addNode(d, 'n', freshName(d));
  assert.equal(freshName(d), 'New status');
  assert.equal(freshName(one), 'New status 2');
});

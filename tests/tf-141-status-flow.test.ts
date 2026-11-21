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

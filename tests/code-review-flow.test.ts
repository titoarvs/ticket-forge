// When an AI code job finishes writing an issue's code, the issue moves to the workflow's review
// status (In Review) and the job's branch is attached to it; when its pull request is merged, it
// moves to Done. These tests cover the rules behind it (client/code-review-flow.ts), which
// client/codeStatus.tsx and the pull request actions apply.
// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  reviewStatus,
  reviewMoveFor,
  branchOfJob,
  branchUrl,
  attachBranch,
  doneStatus,
  doneMoveFor,
} from '../client/code-review-flow';

const WF = [
  { name: 'To Do', category: 'todo' },
  { name: 'In Progress', category: 'inprogress' },
  { name: 'In Review', category: 'inprogress' },
  { name: 'QA', category: 'inprogress' },
  { name: 'Done', category: 'done' },
];
const AT = '2026-11-26T10:00:00.000Z';
const job = (extra: any = {}) => ({
  id: 'job-1',
  status: 'review',
  branch: 'tf/sh-12-pay-by-card',
  base: 'main',
  repo: 'acme/shop',
  provider: 'GitHub',
  side: 'frontend',
  where: 'local',
  ...extra,
});

// ---------------------------------------------------------------- the review status
test('the review status is the workflow’s “In Review”, else another in-progress review status', () => {
  assert.equal(reviewStatus(WF), 'In Review');
  assert.equal(
    reviewStatus([
      { name: 'To Do', category: 'todo' },
      { name: 'Code review', category: 'inprogress' },
      { name: 'Done', category: 'done' },
    ]),
    'Code review',
  );
  // "Reviewed" in the done column isn't a review step, and a workflow without one has none.
  assert.equal(reviewStatus([{ name: 'Reviewed', category: 'done' }]), '');
  assert.equal(reviewStatus(WF.filter((w) => w.name !== 'In Review')), '');
  assert.equal(reviewStatus(undefined), '');
});

test('finished code moves an issue from any earlier status to In Review', () => {
  assert.equal(reviewMoveFor('To Do', WF), 'In Review');
  assert.equal(reviewMoveFor('In Progress', WF), 'In Review');
  assert.equal(reviewMoveFor('Some old status', WF), 'In Review', 'a status no longer in the workflow');
});

test('an issue already in review, further along, or done keeps its status', () => {
  assert.equal(reviewMoveFor('In Review', WF), '');
  assert.equal(reviewMoveFor('QA', WF), '');
  assert.equal(reviewMoveFor('Done', WF), '');
  assert.equal(reviewMoveFor('To Do', WF.filter((w) => w.name !== 'In Review')), '');
});

// ---------------------------------------------------------------- the branch
test('a job with finished code gives its branch; a running, failed or empty job gives none', () => {
  assert.deepEqual(branchOfJob(job(), AT), {
    name: 'tf/sh-12-pay-by-card',
    base: 'main',
    repo: 'acme/shop',
    provider: 'GitHub',
    side: 'frontend',
    jobId: 'job-1',
    pushed: false,
    url: '',
    at: AT,
  });
  for (const status of ['running', 'queued', 'failed', 'empty', 'report', 'cancelled'])
    assert.equal(branchOfJob(job({ status })), null, status);
  assert.equal(branchOfJob(job({ branch: '' })), null);
  assert.ok(branchOfJob(job({ status: 'committed' })));
});

test('a pushed branch links to its page on GitHub; a local or GitLab branch has no link', () => {
  const remote = branchOfJob(job({ where: 'github' }), AT)!;
  assert.equal(remote.pushed, true);
  assert.equal(remote.url, 'https://github.com/acme/shop/tree/tf/sh-12-pay-by-card');
  assert.equal(branchOfJob(job({ status: 'pr', pr: { number: 3 } }), AT)!.pushed, true);
  assert.equal(branchOfJob(job(), AT)!.url, '');
  assert.equal(
    branchUrl({ name: 'tf/x', repo: 'group/app', provider: 'GitLab', pushed: true }),
    '',
  );
  assert.equal(
    branchUrl({ name: 'tf/a b#c', repo: 'acme/shop', pushed: true }),
    'https://github.com/acme/shop/tree/tf/a%20b%23c',
  );
});

test('attaching adds the branch once, then only updates it (a pushed branch stays pushed)', () => {
  const t: any = { key: 'SH-12' };
  assert.equal(attachBranch(t, branchOfJob(job(), AT)!), 'added');
  assert.equal(t.branches.length, 1);
  assert.equal(attachBranch(t, branchOfJob(job(), '2026-11-27T00:00:00.000Z')!), '');
  assert.equal(attachBranch(t, branchOfJob(job({ status: 'pr', pr: {} }), AT)!), 'updated');
  assert.equal(t.branches.length, 1);
  assert.equal(t.branches[0].pushed, true);
  assert.match(t.branches[0].url, /^https:\/\/github\.com\/acme\/shop\/tree\//);
  // A later local round on the same branch doesn't make it local again.
  attachBranch(t, branchOfJob(job({ id: 'job-2' }), AT)!);
  assert.equal(t.branches[0].pushed, true);
  assert.equal(t.branches[0].jobId, 'job-2');
  // The backend job of the same issue has its own branch in its own repository.
  const backend = branchOfJob(job({ repo: 'acme/api', side: 'backend' }), AT)!;
  assert.equal(attachBranch(t, backend), 'added');
  assert.deepEqual(
    t.branches.map((b: any) => `${b.repo} ${b.side}`),
    ['acme/shop frontend', 'acme/api backend'],
  );
});

// ---------------------------------------------------------------- Done on merge
const issue = (status: string, ...prs: string[]) => ({
  key: 'SH-12',
  status,
  prs: prs.map((st, i) => ({ id: `pr${i}`, status: st })),
});

test('the done status is the workflow’s “Done”, else its first done status', () => {
  assert.equal(doneStatus(WF), 'Done');
  assert.equal(
    doneStatus([
      { name: 'To Do', category: 'todo' },
      { name: 'Shipped', category: 'done' },
      { name: 'Won’t do', category: 'done' },
    ]),
    'Shipped',
  );
  assert.equal(doneStatus([{ name: 'To Do', category: 'todo' }]), '');
});

test('a merged pull request moves the issue to Done from any status', () => {
  for (const status of ['To Do', 'In Progress', 'In Review', 'QA'])
    assert.equal(doneMoveFor(issue(status, 'Merged'), WF), 'Done', status);
  // A declined attempt next to the merged one doesn't hold it back.
  assert.equal(doneMoveFor(issue('In Review', 'Declined', 'Merged'), WF), 'Done');
});

test('the issue waits while another of its pull requests is still open', () => {
  for (const other of ['Open', 'Draft', 'Pushed'])
    assert.equal(doneMoveFor(issue('In Review', 'Merged', other), WF), '', other);
  // e.g. the backend part merged, the frontend part still in review
});

test('no merged pull request, an issue already done, or no done status: nothing moves', () => {
  assert.equal(doneMoveFor(issue('In Review'), WF), '');
  assert.equal(doneMoveFor(issue('In Review', 'Open'), WF), '');
  assert.equal(doneMoveFor(issue('In Review', 'Declined'), WF), '');
  assert.equal(doneMoveFor(issue('Done', 'Merged'), WF), '');
  const wf = [...WF, { name: 'Released', category: 'done' }];
  assert.equal(doneMoveFor(issue('Released', 'Merged'), wf), '', 'another done status counts');
  assert.equal(doneMoveFor(issue('In Review', 'Merged'), WF.slice(0, 4)), '');
  assert.equal(doneMoveFor(null, WF), '');
});

// ---------------------------------------------------------------- wiring
test('the coding indicator moves finished code to review, not to Done', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '../client/codeStatus.tsx'), 'utf8');
  assert.doesNotMatch(src, /completeOnCode|doneStatus/);
  assert.match(src, /reviewOnCode\(t, by\[id\]\)/);
  assert.match(src, /reviewMoveFor\(/);
  assert.match(src, /attachBranch\(x, b\)/);
});

test('merging from Ticket Forge and a refresh that finds the request merged both apply Done on merge', () => {
  const read = (f: string) => fs.readFileSync(path.join(import.meta.dirname, '..', f), 'utf8');
  assert.match(read('client/codeStatus.tsx'), /doneMoveFor\(live, P\(\)\?\.workflow \|\| \[\]\)/);
  assert.match(read('client/DevCode/code-modal/pr-actions.ts'), /await doneOnMerge\(t\);/);
  const refresh = read('client/actions/bulk-tests.tsx');
  assert.match(refresh, /const nowMerged = info\.status === 'Merged' && r\.status !== 'Merged';/);
  assert.match(refresh, /if \(nowMerged\) await doneOnMerge\(t, \{ quiet \}\);/);
});

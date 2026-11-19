'use client';
// Changing an execution's test runs: one run or several at once, deleting the execution, and
// filing a defect from a failed run (linked to the run and the issues the test covers).
import { type Any, P, nowIso, me, toast, mutate, newTicket, addLink, logEvent } from '../../core';
import { openDrawer } from '../../actions';
import { edit } from '../run-status';

export const blankRun = () => ({ status: 'TODO', steps: {}, comment: '', defectIds: [] });

/**
 * Applies a change to these tests' runs in the execution. stamp: record who and when (a result was
 * set). tag: quick edits with the same tag are saved together (typing a comment).
 */
export function updateRuns(
  execId: string,
  testIds: string[],
  patch: Any,
  stamp: boolean,
  tag?: string,
) {
  edit((rr) => {
    const ex = rr.executions.find((x: Any) => x.id === execId);
    if (!ex) return;
    ex.runs = ex.runs || {};
    for (const tid of testIds)
      ex.runs[tid] = {
        ...blankRun(),
        ...(ex.runs[tid] || {}),
        ...patch,
        ...(stamp ? { at: nowIso(), by: me() } : {}),
      };
  }, tag);
}

/** Several selected runs at once: a result (recorded with who and when) and/or an assignee. */
export function updateSelected(execId: string, testIds: string[], patch: Any) {
  updateRuns(execId, testIds, patch, Boolean(patch.status));
  toast(`${testIds.length} test run${testIds.length === 1 ? '' : 's'} updated`);
}

export function deleteExecution(execId: string) {
  edit((rr) => {
    rr.executions = rr.executions.filter((x: Any) => x.id !== execId);
  });
}

/** Where it was found, the preconditions, every step (failed ones marked) and the tester's note. */
function defectDescription(test: Any, e: Any, run: Any) {
  const steps = (test.steps || [])
    .map((s: Any, i: number) => {
      const data = s.data ? ` (${s.data})` : '';
      const failed = run.steps?.[s.id] === 'FAILED' ? '  ✗ FAILED' : '';
      return `${i + 1}. ${s.action}${data} → expected: ${s.expected || '—'}${failed}`;
    })
    .join('\n');
  const env = e.environment ? ` on ${e.environment}` : '';
  return [
    `Found while running ${test.key} in ${e.key} (${e.title})${env}.`,
    test.preconditions && `Preconditions: ${test.preconditions}`,
    `Steps:\n${steps}`,
    run.comment && `Tester’s note: ${run.comment}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The bug's title: the test and the first failed step. */
function defectTitle(test: Any, run: Any) {
  const first = (test.steps || []).findIndex((s: Any) => run.steps?.[s.id] === 'FAILED');
  return `${test.title}: fails${first >= 0 ? ` at step ${first + 1}` : ''}`.slice(0, 120);
}

/**
 * Files a Bug for a failed or blocked run: in the epic of the first issue the test covers, blocking
 * those issues, and linked to the run.
 */
export function createDefect(e: Any, test: Any, testId: string, run: Any) {
  const linked = (test.issueIds || [])
    .map((x: string) => P().tickets.find((t: Any) => t.id === x))
    .filter(Boolean);
  let bug: Any = null;
  mutate((pp: Any) => {
    bug = newTicket({
      type: 'Bug',
      priority: test.priority === 'High' ? 'High' : 'Medium',
      epicId: linked[0]?.epicId || null,
      labels: ['defect'],
      title: defectTitle(test, run),
      description: defectDescription(test, e, run),
    });
    pp.tickets.push(bug);
    for (const l of linked) {
      const t = pp.tickets.find((x: Any) => x.id === l.id);
      if (t) addLink(t, 'is blocked by', bug);
    }
    logEvent(bug, `defect from ${test.key} in ${e.key}`, 'Test management');
    const ex = pp.testRepo.executions.find((x: Any) => x.id === e.id);
    ex.runs[testId] = {
      ...ex.runs[testId],
      defectIds: [...(ex.runs[testId]?.defectIds || []), bug.id],
    };
  });
  const also = linked.length ? ` and to ${linked.map((x: Any) => x.key).join(', ')}` : '';
  toast(`${bug.key} created and linked to the run${also}.`, 'ok', {
    title: 'Defect created',
    action: { label: 'Open', onClick: () => openDrawer('issue', bug.id) },
  });
}

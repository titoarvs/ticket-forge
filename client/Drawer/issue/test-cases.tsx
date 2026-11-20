'use client';
// The issue's test cases, with a warning for acceptance criteria no test covers.
import { type Any, mutate, S, emit, newTest, logEvent } from '../../core';
import { Ico, I, TypeIcon } from '../../ui';
import { TestCase } from '../TestCase';
import type { IssueProps } from './edit';

/** The numbers of the acceptance criteria no test case refers to. */
const uncoveredCriteria = (t: Any): number[] =>
  t.acceptanceCriteria
    .map((_: Any, i: number) => i + 1)
    .filter((n: number) => !t.testCases.some((tc: Any) => (tc.acRef || []).includes(n)));

const addTest = (t: Any) => {
  const n = newTest();
  S.openTc.add(n.id);
  mutate(() => {
    t.testCases.push(n);
    logEvent(t, 'added a test case');
  });
};

const setAllOpen = (t: Any, open: boolean) => {
  t.testCases.forEach((x: Any) => (open ? S.openTc.add(x.id) : S.openTc.delete(x.id)));
  emit();
};

export function TestCasesSection({ t, edit }: IssueProps) {
  const uncovered = uncoveredCriteria(t);
  return (
    <div className="sec">
      <div className="sec-title">
        <TypeIcon type="Test" />
        <h3>Test cases</h3>
        <span className="count">{t.testCases.length}</span>
        <div className="tools">
          {edit && (
            <button className="btn sm subtle" onClick={() => addTest(t)}>
              <Ico svg={I.plus} />
              Add
            </button>
          )}
          <button className="btn sm subtle" onClick={() => setAllOpen(t, true)}>
            Expand all
          </button>
          <button className="btn sm subtle" onClick={() => setAllOpen(t, false)}>
            Collapse all
          </button>
        </div>
      </div>
      {uncovered.length > 0 && t.testCases.length > 0 && (
        <div className="warn-banner">
          <Ico svg={I.warn} />
          <span>
            Not covered by any test case: {uncovered.map((n: number) => `AC${n}`).join(', ')}
          </span>
        </div>
      )}
      {t.testCases.map((tc: Any, i: number) => (
        <TestCase key={tc.id} t={t} tc={tc} i={i} />
      ))}
      {!t.testCases.length && (
        <p className="muted small">
          No test cases yet. Use “Regenerate test cases” to let Claude write them.
        </p>
      )}
    </div>
  );
}

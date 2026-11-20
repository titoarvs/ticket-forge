'use client';
// Acceptance criteria: numbered AC1, AC2 …, each editable, movable and removable.
import { type Any, mutate, clone, logChange } from '../../core';
import { Ico, I } from '../../ui';
import { TA } from '../../fields';
import type { IssueProps } from './edit';

const addCriterion = (t: Any, text: string) =>
  mutate(() => {
    t.acceptanceCriteria.push(text);
    logChange(t, 'acceptanceCriteria', 0, 1);
  });

/** Swaps criterion i with the one `by` places away (-1 up, +1 down). */
const moveCriterion = (t: Any, i: number, by: number) =>
  mutate(() => {
    const l = t.acceptanceCriteria;
    [l[i], l[i + by]] = [l[i + by], l[i]];
  });

const removeCriterion = (t: Any, i: number) =>
  mutate(() => {
    t.acceptanceCriteria.splice(i, 1);
    logChange(t, 'acceptanceCriteria', 1, 0);
  });

const setCriterion = (t: Any, i: number, v: string) =>
  mutate(
    () => {
      const old = clone(t.acceptanceCriteria);
      t.acceptanceCriteria[i] = v;
      logChange(t, 'acceptanceCriteria', old, t.acceptanceCriteria);
    },
    { tag: `ac${i}${t.id}` },
  );

function Criterion({ t, edit, a, i }: IssueProps & { a: string; i: number }) {
  return (
    <div className="ac">
      <span className="ac-n">AC{i + 1}</span>
      <TA
        ghost
        rows={1}
        style={{ minHeight: 32 }}
        disabled={!edit}
        value={a}
        onChange={(ev) => setCriterion(t, i, ev.target.value)}
      />
      {edit && (
        <span className="ops">
          <button
            className="icon-btn"
            title="Move up"
            disabled={i === 0}
            onClick={() => moveCriterion(t, i, -1)}
          >
            <Ico svg={I.up} />
          </button>
          <button
            className="icon-btn"
            title="Move down"
            disabled={i === t.acceptanceCriteria.length - 1}
            onClick={() => moveCriterion(t, i, 1)}
          >
            <Ico svg={I.down} />
          </button>
          <button className="icon-btn" title="Remove" onClick={() => removeCriterion(t, i)}>
            <Ico svg={I.trash} />
          </button>
        </span>
      )}
    </div>
  );
}

export function AcceptanceCriteria({ t, edit }: IssueProps) {
  return (
    <div className="sec">
      <div className="sec-title">
        <h3>Acceptance criteria</h3>
        <span className="count">{t.acceptanceCriteria.length}</span>
        {edit && (
          <div className="tools">
            <button className="btn sm subtle" onClick={() => addCriterion(t, '')}>
              <Ico svg={I.plus} />
              Add
            </button>
            <button
              className="btn sm subtle"
              onClick={() => addCriterion(t, 'Given , when , then ')}
            >
              <Ico svg={I.plus} />
              Given / When / Then
            </button>
          </div>
        )}
      </div>
      {t.acceptanceCriteria.map((a: string, i: number) => (
        <Criterion key={i} t={t} edit={edit} a={a} i={i} />
      ))}
      {!t.acceptanceCriteria.length && <p className="muted small">No acceptance criteria yet.</p>}
    </div>
  );
}

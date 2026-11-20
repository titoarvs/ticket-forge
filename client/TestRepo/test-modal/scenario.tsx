'use client';
// What the test does: a Gherkin scenario for Cucumber tests, otherwise a table of steps.
import type { Any } from '../../core';
import { Ico, I } from '../../ui';
import { TA } from '../../fields';
import type { Draft } from './draft';

type ScenarioProps = { draft: Draft; ed: boolean };

const GHERKIN_EXAMPLE =
  'Scenario: Approver approves a salary proposal\n  Given a pending proposal assigned to me\n  When I approve it with a note\n  Then the employee is notified and the history shows "Approved"';

function Gherkin({ draft, ed }: ScenarioProps) {
  return (
    <>
      <h4 className="sync-h">Scenario (Gherkin)</h4>
      <TA
        disabled={!ed}
        rows={8}
        value={draft.d.gherkin || ''}
        spellCheck={false}
        className="xr-gherkin"
        placeholder={GHERKIN_EXAMPLE}
        onChange={(e) => draft.set('gherkin', e.target.value)}
      />
    </>
  );
}

const CELLS: [string, string][] = [
  ['action', 'What to do'],
  ['data', 'Test data'],
  ['expected', 'What should happen'],
];

function StepRow({ draft, ed, s, i }: ScenarioProps & { s: Any; i: number }) {
  const last = draft.d.steps.length - 1;
  return (
    <tr>
      <td className="muted">{i + 1}</td>
      {CELLS.map(([k, placeholder]) => (
        <td key={k}>
          <TA
            disabled={!ed}
            rows={1}
            value={s[k]}
            placeholder={placeholder}
            onChange={(e) => draft.setStep(i, k, e.target.value)}
          />
        </td>
      ))}
      {ed && (
        <td style={{ whiteSpace: 'nowrap' }}>
          <button
            className="icon-btn"
            disabled={i === 0}
            title="Move up"
            aria-label="Move step up"
            onClick={() => draft.moveStep(i, -1)}
          >
            <Ico svg={I.up} />
          </button>
          <button
            className="icon-btn"
            disabled={i === last}
            title="Move down"
            aria-label="Move step down"
            onClick={() => draft.moveStep(i, 1)}
          >
            <Ico svg={I.down} />
          </button>
          <button
            className="icon-btn"
            title="Remove step"
            aria-label="Remove step"
            onClick={() => draft.removeStep(i)}
          >
            <Ico svg={I.trash} />
          </button>
        </td>
      )}
    </tr>
  );
}

function Steps({ draft, ed }: ScenarioProps) {
  return (
    <>
      <h4 className="sync-h">Steps</h4>
      <table className="tbl xr-steps">
        <thead>
          <tr>
            <th style={{ width: 28 }}>#</th>
            <th>Action</th>
            <th>Data</th>
            <th>Expected result</th>
            {ed && <th style={{ width: 80 }} />}
          </tr>
        </thead>
        <tbody>
          {draft.d.steps.map((s: Any, i: number) => (
            <StepRow key={s.id} draft={draft} ed={ed} s={s} i={i} />
          ))}
        </tbody>
      </table>
      {ed && (
        <button className="btn sm subtle" onClick={draft.addStep}>
          <Ico svg={I.plus} />
          Add step
        </button>
      )}
    </>
  );
}

export function Scenario(props: ScenarioProps) {
  return props.draft.d.type === 'Cucumber' ? <Gherkin {...props} /> : <Steps {...props} />;
}

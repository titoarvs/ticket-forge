'use client';
// Running one test: who runs it and its result, the preconditions, each step's result (or the
// Gherkin scenario), a comment, its defects, and moving to the previous or next test.
import { type Any, P, peopleNames, can } from '../../core';
import { Ico, I, TypeIcon, StatusLoz } from '../../ui';
import { SF, MenuItem, TA } from '../../fields';
import { openDrawer } from '../../actions';
import { RUN_STATUS, STATUS_LABEL } from '../run-status';
import { runStatusFromSteps, RunLoz } from '../TestManagement';
import { createDefect } from './run-ops';

export type RunCtx = {
  e: Any;
  test: Any;
  run: Any;
  ed: boolean;
  /** Changes the current run (tag: quick edits with the same tag are saved together). */
  setRun: (patch: Any, tag?: string) => void;
};

const STEP_MARK: Record<string, string> = { PASSED: '✓', FAILED: '✗', BLOCKED: '⦸' };

function RunHeader({ test, run, ed, setRun }: RunCtx) {
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
      <span className="key">{test.key}</span>
      <b style={{ flex: 1 }}>{test.title}</b>
      <SF
        disabled={!ed}
        filter
        value={run.assignee || ''}
        displayEmpty
        onChange={(ev) => setRun({ assignee: ev.target.value })}
        aria-label="Assignee"
      >
        <MenuItem value="">Unassigned</MenuItem>
        {peopleNames().map((n: string) => (
          <MenuItem key={n} value={n}>
            {n}
          </MenuItem>
        ))}
      </SF>
      <SF
        disabled={!ed}
        value={run.status}
        onChange={(ev) => setRun({ status: ev.target.value })}
        aria-label="Result"
      >
        {RUN_STATUS.map((s) => (
          <MenuItem key={s} value={s}>
            {STATUS_LABEL[s]}
          </MenuItem>
        ))}
      </SF>
    </div>
  );
}

/** Passed / failed / blocked for one step (click again to clear); the run's result follows its steps. */
function StepResult({ ctx, stepId, v }: { ctx: RunCtx; stepId: string; v: string }) {
  const { test, run, ed, setRun } = ctx;
  if (!ed) return <RunLoz s={v} />;
  const set = (st: string) => {
    const steps = { ...(run.steps || {}), [stepId]: st };
    setRun({ steps, status: runStatusFromSteps(steps, test?.steps?.length || 0) });
  };
  return (
    <>
      {(['PASSED', 'FAILED', 'BLOCKED'] as const).map((x) => (
        <button
          key={x}
          className={`xr-stepbtn ${v === x ? `on xr-${x.toLowerCase()}` : ''}`}
          title={STATUS_LABEL[x]}
          aria-pressed={v === x}
          onClick={() => set(v === x ? 'TODO' : x)}
        >
          {STEP_MARK[x]}
        </button>
      ))}
    </>
  );
}

function Steps(ctx: RunCtx) {
  const steps = ctx.test.steps || [];
  return (
    <table className="tbl xr-steps">
      <thead>
        <tr>
          <th>#</th>
          <th>Action</th>
          <th>Data</th>
          <th>Expected</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s: Any, i: number) => {
          const v = ctx.run.steps?.[s.id] || 'TODO';
          return (
            <tr key={s.id} className={`xr-step-${v.toLowerCase()}`}>
              <td className="muted">{i + 1}</td>
              <td>{s.action}</td>
              <td className="muted">{s.data}</td>
              <td>{s.expected}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <StepResult ctx={ctx} stepId={s.id} v={v} />
              </td>
            </tr>
          );
        })}
        {!steps.length && (
          <tr>
            <td colSpan={5} className="muted small">
              This test has no steps: set its result above.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** The defects filed from this run, and filing one when it failed or is blocked. */
function Defects({ ctx, testId }: { ctx: RunCtx; testId: string }) {
  const { e, test, run, ed } = ctx;
  const tickets = P().tickets;
  return (
    <>
      {(run.defectIds || []).map((did: string) => {
        const b = tickets.find((x: Any) => x.id === did);
        if (!b) return null;
        return (
          <span key={did} className="xr-issue">
            <TypeIcon type="Bug" />
            <button className="link-btn" onClick={() => openDrawer('issue', b.id)}>
              {b.key}
            </button>
            <StatusLoz s={b.status} />
          </span>
        );
      })}
      {ed && can('issue.create') && ['FAILED', 'BLOCKED'].includes(run.status) && (
        <button className="btn sm" onClick={() => createDefect(e, test, testId, run)}>
          <Ico svg={I.plus} />
          Create defect
        </button>
      )}
    </>
  );
}

type PanelProps = RunCtx & { cur: string; setCur: (id: string) => void };

export function RunPanel(props: PanelProps) {
  const { e, test, run, ed, setRun, cur, setCur } = props;
  const idx = e.testIds.indexOf(cur);
  return (
    <>
      <RunHeader {...props} />
      {test.preconditions && (
        <p className="small">
          <b>Preconditions:</b> {test.preconditions}
        </p>
      )}
      {test.type === 'Cucumber' ? (
        <pre className="xr-gherkin-view">{test.gherkin || '(no scenario written)'}</pre>
      ) : (
        <Steps {...props} />
      )}
      <label className="field">
        <span>Comment / evidence</span>
        <TA
          disabled={!ed}
          rows={2}
          value={run.comment || ''}
          placeholder="What you saw, links to screenshots or logs"
          onChange={(ev) => setRun({ comment: ev.target.value }, `xr-c-${e.id}-${cur}`)}
        />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <Defects ctx={props} testId={cur} />
        <span className="spacer" />
        <button
          className="btn sm subtle"
          disabled={idx <= 0}
          onClick={() => setCur(e.testIds[idx - 1])}
        >
          Previous
        </button>
        <button
          className="btn sm primary"
          disabled={idx >= e.testIds.length - 1}
          onClick={() => setCur(e.testIds[idx + 1])}
        >
          Next test
        </button>
      </div>
    </>
  );
}

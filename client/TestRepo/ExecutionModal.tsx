'use client';
// Running a test execution: its progress, the tests in it, and the run of the chosen test. The parts
// are in client/TestRepo/execution/.
import { useState } from 'react';
import { useStore, P, type Any, openModal } from '../core';
import { Modal, Confirm } from '../ui';
import { repo } from './run-status';
import { canEdit } from './TestManagement';
import { blankRun, updateRuns, deleteExecution } from './execution/run-ops';
import { ExecHead, BulkBar } from './execution/exec-head';
import { TestList } from './execution/test-list';
import { RunPanel } from './execution/run-panel';

/** Opens on the given test, else the first one that hasn't passed. */
const firstTest = (e: Any, startAt?: string) =>
  startAt ||
  e?.testIds.find((t: string) => e.runs?.[t]?.status !== 'PASSED') ||
  e?.testIds[0] ||
  null;

const confirmDelete = (e: Any) =>
  openModal(
    <Confirm
      title={`Delete ${e.key}?`}
      label="Delete"
      text="Its results are removed. Defects created from it stay."
      onYes={() => deleteExecution(e.id)}
    />,
  );

export function ExecutionModal({ id, startAt }: { id: string; startAt?: string }) {
  useStore(); // a dialog doesn't redraw with the page: follow the project so results show as they're marked
  const r = repo(P());
  const e = r.executions.find((x: Any) => x.id === id);
  const [cur, setCur] = useState<string | null>(firstTest(e, startAt));
  const [picked, setPicked] = useState<string[]>([]);
  if (!e)
    return (
      <Modal title="Execution not found">
        <p>It may have been deleted.</p>
      </Modal>
    );
  const ed = canEdit();
  const test = r.tests.find((t: Any) => t.id === cur);
  const run = cur ? e.runs?.[cur] || blankRun() : null;
  const setRun = (patch: Any, tag?: string) => cur && updateRuns(id, [cur], patch, true, tag);
  const actions = [
    ...(ed
      ? [{ label: 'Delete execution', kind: 'danger' as const, onClick: () => confirmDelete(e) }]
      : []),
    { label: 'Close' },
  ];
  return (
    <Modal title={`${e.key} · ${e.title}`} wide persistent actions={actions}>
      <ExecHead e={e} ed={ed} />
      {ed && picked.length > 0 && (
        <BulkBar execId={id} picked={picked} clear={() => setPicked([])} />
      )}
      <div className="xr-exec">
        <TestList
          e={e}
          tests={r.tests}
          ed={ed}
          cur={cur}
          setCur={setCur}
          picked={picked}
          setPicked={setPicked}
        />
        <div className="xr-exec-run">
          {!test ? (
            <p className="muted">Pick a test.</p>
          ) : (
            <RunPanel
              e={e}
              test={test}
              run={run}
              ed={ed}
              setRun={setRun}
              cur={cur!}
              setCur={setCur}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

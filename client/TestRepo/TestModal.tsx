'use client';
// Test repository → a test: its review workflow, fields, scenario, covered issues and history.
// This component only puts the parts in client/TestRepo/test-modal/ together.
import { type Any, openModal, can } from '../core';
import { Modal, Confirm } from '../ui';
import { repo } from './run-status';
import { canEdit } from './TestManagement';
import { useDraft, saveTest, deleteTest } from './test-modal/draft';
import { WorkflowBar, ChangesRequested } from './test-modal/workflow-bar';
import { TestFields } from './test-modal/test-fields';
import { ImproveWithAi } from './test-modal/improve-ai';
import { Scenario } from './test-modal/scenario';
import { CoveredIssues } from './test-modal/covered-issues';
import { ExecutionHistory, ReviewHistory } from './test-modal/history';

type TestModalProps = { test: Any | null; folderId: string | null; issueId?: string };

const confirmDelete = (test: Any) =>
  openModal(
    <Confirm
      title={`Delete ${test.key}?`}
      label="Delete test"
      text="It’s removed from the repository, its plans and executions (their other results stay)."
      onYes={() => deleteTest(test)}
    />,
  );

/** Delete (saved tests), Cancel, and Save or Create test (for people who may edit tests). */
function modalActions(test: Any | null, ed: boolean, save: () => void) {
  const del =
    test && ed
      ? [{ label: 'Delete', kind: 'danger' as const, onClick: () => confirmDelete(test) }]
      : [];
  const ok = ed
    ? [{ label: test ? 'Save' : 'Create test', kind: 'primary' as const, onClick: save }]
    : [];
  return [...del, { label: 'Cancel' }, ...ok];
}

export function TestModal({ test, folderId, issueId }: TestModalProps) {
  const draft = useDraft(test, folderId, issueId);
  const ed = canEdit();
  // The test as saved now (its workflow state can change while the editor is open).
  const live = test ? repo().tests.find((x: Any) => x.id === test.id) || test : null;
  return (
    <Modal
      title={test ? `${test.key} · ${test.title}` : 'New test'}
      wide
      persistent
      actions={modalActions(test, ed, () => saveTest(test, draft.d))}
    >
      {live && <WorkflowBar test={test} live={live} />}
      {live && <ChangesRequested live={live} />}
      <TestFields draft={draft} ed={ed} isNew={!test} />
      {ed && can('ai.use') && <ImproveWithAi test={test} draft={draft} />}
      <Scenario draft={draft} ed={ed} />
      <CoveredIssues draft={draft} ed={ed} />
      {test && <ExecutionHistory test={test} />}
      {live && <ReviewHistory live={live} draft={draft} ed={ed} />}
    </Modal>
  );
}

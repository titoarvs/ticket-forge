'use client';
import { useState } from 'react';
import { P, type Any, uid, nowIso, me, closeModal, toast, useStore, ago, openModal } from '../core';
import { Modal, TypeIcon } from '../ui';
import { CB, TF } from '../fields';
import { repo, edit } from './run-status';
import { nextKey, wfOf, wfAction, WfLoz, canReview, canEdit, wfSettings } from './TestManagement';
import { TestModal } from './TestModal';

/** Test cases already on issues → repository tests, linked to their issue, one folder per epic. */
export function ImportModal({ folderId }: { folderId: string | null }) {
  const p = P();
  const r = repo(p);
  const done = new Set(r.tests.map((t: Any) => t.source?.tcId).filter(Boolean));
  const issues = p.tickets.filter((t: Any) =>
    (t.testCases || []).some((c: Any) => !done.has(c.id)),
  );
  const [pick, setPick] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(issues.map((t: Any) => [t.id, true])),
  );
  const [byEpic, setByEpic] = useState(!folderId);
  const n = issues
    .filter((t: Any) => pick[t.id])
    .reduce((x: number, t: Any) => x + t.testCases.filter((c: Any) => !done.has(c.id)).length, 0);
  const go = () => {
    let made = 0;
    edit((rr, pp) => {
      const folderFor = (epicId: string | null) => {
        if (!byEpic) return folderId;
        const e = pp.epics.find((x: Any) => x.id === epicId);
        const name = e ? `${e.key} ${e.title}` : 'No epic';
        let f = rr.folders.find((x: Any) => x.name === name && !x.parentId);
        if (!f) {
          f = { id: uid(), name, parentId: null };
          rr.folders.push(f);
        }
        return f.id;
      };
      for (const t of pp.tickets.filter((x: Any) => pick[x.id])) {
        for (const c of t.testCases || []) {
          if (done.has(c.id)) continue;
          const steps = (Array.isArray(c.steps) ? c.steps : c.steps ? [c.steps] : []).map(
            (s: string, i: number, all: string[]) => ({
              id: uid(),
              action: s,
              data: '',
              expected: i === all.length - 1 ? c.expected || '' : '',
            }),
          );
          rr.tests.push({
            id: uid(),
            key: nextKey(rr, pp, 't'),
            title: c.title,
            type: c.script ? 'Automated' : 'Manual',
            folderId: folderFor(t.epicId || null),
            priority: c.priority || 'Medium',
            labels: [c.type].filter(Boolean),
            preconditions: c.preconditions || '',
            steps,
            issueIds: [t.id],
            source: { ticketId: t.id, tcId: c.id },
            createdAt: nowIso(),
            createdBy: me(),
          });
          made++;
        }
      }
    });
    closeModal();
    toast(
      `${made} test${made === 1 ? '' : 's'} added to the repository, each linked to its issue.`,
      'ok',
      { title: 'Tests imported' },
    );
  };
  return (
    <Modal
      title="Import test cases from issues"
      wide
      actions={[
        { label: 'Cancel' },
        {
          label: `Import ${n} test${n === 1 ? '' : 's'}`,
          kind: 'primary',
          disabled: !n,
          onClick: go,
        },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Each test case on the picked issues becomes a reusable test in the repository, linked to its
        issue (its steps and expected result carry over). The issues keep their own test cases. Test
        cases imported before are skipped.
      </p>
      <CB
        label="One folder per epic"
        checked={byEpic}
        onChange={(e: Any) => setByEpic(e.target.checked)}
      />
      <div className="split-list">
        {issues.map((t: Any) => (
          <label key={t.id} className={`split-row ${pick[t.id] ? '' : 'off'}`}>
            <CB
              checked={Boolean(pick[t.id])}
              onChange={() => setPick({ ...pick, [t.id]: !pick[t.id] })}
              aria-label={`Import ${t.key}`}
            />
            <TypeIcon type={t.type} />
            <span className="key">{t.key}</span>
            <span className="split-title">{t.title}</span>
            <span className="muted small">
              {t.testCases.filter((c: Any) => !done.has(c.id)).length} test cases
            </span>
          </label>
        ))}
        {!issues.length && (
          <p className="muted small" style={{ padding: 10 }}>
            Every test case is already in the repository.
          </p>
        )}
      </div>
    </Modal>
  );
}
// ---------------------------------------------------------------- reviews (the approval queue)
export function Reviews() {
  useStore();
  const p = P();
  const r = repo(p);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const waiting = r.tests.filter((t: Any) => wfOf(t) === 'Ready for review');
  const back = r.tests.filter((t: Any) => wfOf(t) === 'Needs update');
  const drafts = r.tests.filter((t: Any) => wfOf(t) === 'Draft');
  const act = (t: Any, a: string) => {
    const err = wfAction(t.id, a, notes[t.id] || '');
    if (err) toast(err, 'err');
    else {
      setNotes({ ...notes, [t.id]: '' });
      toast(
        `${t.key}: ${a === 'approve' ? 'approved' : a === 'changes' ? 'sent back for changes' : 'submitted for review'}`,
      );
    }
  };
  const submitted = (t: Any) =>
    [...(t.reviews || [])].reverse().find((x: Any) => x.action === 'submit');
  const row = (t: Any, kind: string) => (
    <div key={t.id} className="wf-row">
      <div className="wf-main">
        <div>
          <button className="link-btn key" onClick={() => openTest(t)}>
            {t.key}
          </button>{' '}
          <b>{t.title}</b> <WfLoz t={t} />{' '}
          <span className="muted small">
            v{t.version || 1} · {t.type} · {t.steps?.length || 0} steps
          </span>
        </div>
        <div className="muted small">
          {kind === 'waiting'
            ? `Submitted by ${submitted(t)?.by || t.updatedBy || t.createdBy || '—'} ${submitted(t) ? ago(submitted(t).at) : ''}`
            : kind === 'back'
              ? `${(t.reviews || []).slice(-1)[0]?.by || 'A reviewer'}: “${(t.reviews || []).slice(-1)[0]?.comment || ''}”`
              : `Created by ${t.createdBy || '—'} ${ago(t.createdAt)}`}
          {(t.issueIds || []).length > 0 && (
            <>
              {' '}
              · covers{' '}
              {(t.issueIds || [])
                .map((id: string) => p.tickets.find((x: Any) => x.id === id)?.key)
                .filter(Boolean)
                .join(', ')}
            </>
          )}
        </div>
      </div>
      <div className="wf-acts">
        {kind === 'waiting' && canReview() && (
          <>
            <TF
              bare
              className="wf-note"
              value={notes[t.id] || ''}
              placeholder="Comment"
              onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })}
            />
            <button className="btn sm primary" onClick={() => act(t, 'approve')}>
              Approve
            </button>
            <button className="btn sm" onClick={() => act(t, 'changes')}>
              Request changes
            </button>
          </>
        )}
        {kind !== 'waiting' && canEdit() && (
          <button className="btn sm" onClick={() => act(t, 'submit')}>
            Submit for review
          </button>
        )}
        <button className="btn sm subtle" onClick={() => openTest(t)}>
          Open
        </button>
      </div>
    </div>
  );
  const st = wfSettings(p);
  return (
    <div className="wf-queue">
      <p className="muted small" style={{ marginTop: 0 }}>
        Tests move Draft → Ready for review → Approved.{' '}
        {st.requireApproval ? (
          <b>Only Approved tests can go into plans and executions.</b>
        ) : (
          'Any active test can go into plans and executions (turn on “Only Approved tests” in Workflow).'
        )}{' '}
        {st.fourEyes ? 'The approver must not be the person who last changed the test.' : ''}
      </p>
      <h4 className="sync-h">Waiting for review ({waiting.length})</h4>
      {waiting.length ? (
        waiting.map((t: Any) => row(t, 'waiting'))
      ) : (
        <p className="muted small">
          Nothing waiting. Tests appear here when someone submits them for review.
        </p>
      )}
      {back.length > 0 && (
        <>
          <h4 className="sync-h">Sent back for changes ({back.length})</h4>
          {back.map((t: Any) => row(t, 'back'))}
        </>
      )}
      {drafts.length > 0 && (
        <>
          <h4 className="sync-h">Drafts ({drafts.length})</h4>
          {drafts.slice(0, 50).map((t: Any) => row(t, 'draft'))}
          {canEdit() && drafts.length > 1 && (
            <button
              className="btn sm subtle"
              onClick={() => {
                drafts.forEach((t: Any) => wfAction(t.id, 'submit'));
                toast(`${drafts.length} drafts submitted for review`);
              }}
            >
              Submit all {drafts.length} drafts for review
            </button>
          )}
        </>
      )}
    </div>
  );
}
export function WorkflowModal() {
  const [v, setV] = useState(() => wfSettings());
  return (
    <Modal
      title="Test review workflow"
      actions={[
        { label: 'Cancel' },
        {
          label: 'Save',
          kind: 'primary',
          onClick: () => {
            edit((rr) => {
              rr.settings = { ...(rr.settings || {}), ...v };
            });
            closeModal();
            toast('Workflow saved');
          },
        },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Like Xray and BrowserStack Test Management: tests are written as Drafts, reviewed, and
        approved before they count. Editing an approved test makes a new version and sends it back
        to review; earlier versions are kept.
      </p>
      <CB
        label={
          <>
            <b>Only Approved tests in plans and executions</b>
            <div className="muted small">
              Drafts and tests waiting for review can’t be planned or run until approved.
            </div>
          </>
        }
        checked={v.requireApproval}
        onChange={(e: Any) => setV({ ...v, requireApproval: e.target.checked })}
      />
      <CB
        label={
          <>
            <b>Four-eyes approval</b>
            <div className="muted small">
              Whoever last changed a test can’t approve it (the owner can).
            </div>
          </>
        }
        checked={v.fourEyes}
        onChange={(e: Any) => setV({ ...v, fourEyes: e.target.checked })}
      />
    </Modal>
  );
}
// ---------------------------------------------------------------- one test
export function openTest(test: Any | null, folderId?: string | null, issueId?: string) {
  openModal(<TestModal test={test} folderId={folderId || null} issueId={issueId} />);
}

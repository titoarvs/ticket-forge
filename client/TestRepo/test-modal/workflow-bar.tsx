'use client';
// The review workflow of a saved test: its state and version, and submit / approve / request
// changes / deprecate / restore, with an optional comment.
import { useState } from 'react';
import { type Any, toast, closeModal, ago } from '../../core';
import { Ico, I } from '../../ui';
import { TF } from '../../fields';
import { canEdit, wfOf, wfAction, WF_CLS, WfLoz, canReview } from '../TestManagement';

const DONE: Record<string, string> = {
  submit: 'submitted for review',
  approve: 'approved',
  changes: 'sent back for changes',
  deprecate: 'deprecated',
  restore: 'restored as a Draft',
};

const isDraft = (state: string) => ['Draft', 'Needs update'].includes(state);

function WorkflowButtons({ state, act }: { state: string; act: (a: string) => void }) {
  const ed = canEdit();
  const review = canReview();
  return (
    <>
      {ed && isDraft(state) && (
        <button className="btn sm primary" onClick={() => act('submit')}>
          Submit for review
        </button>
      )}
      {review && state === 'Ready for review' && (
        <>
          <button className="btn sm primary" onClick={() => act('approve')}>
            Approve
          </button>
          <button className="btn sm" onClick={() => act('changes')}>
            Request changes
          </button>
        </>
      )}
      {review && isDraft(state) && (
        <button
          className="btn sm subtle"
          onClick={() => act('approve')}
          title="Approve without a separate review"
        >
          Approve
        </button>
      )}
      {ed && state !== 'Deprecated' && (
        <button className="btn sm subtle" onClick={() => act('deprecate')}>
          Deprecate
        </button>
      )}
      {ed && state === 'Deprecated' && (
        <button className="btn sm" onClick={() => act('restore')}>
          Restore
        </button>
      )}
    </>
  );
}

export function WorkflowBar({ test, live }: { test: Any; live: Any }) {
  const [note, setNote] = useState('');
  const state = wfOf(live);
  const act = (a: string) => {
    const err = wfAction(test.id, a, note);
    if (err) return toast(err, 'err');
    setNote('');
    toast(`${test.key}: ${DONE[a]}`);
    closeModal();
  };
  const approvedBy =
    live.approvedBy && state === 'Approved'
      ? ` · approved by ${live.approvedBy} ${ago(live.approvedAt)}`
      : '';
  return (
    <div className={`wf-bar ${WF_CLS[state]}`}>
      <WfLoz t={live} />
      <span className="muted small">
        Version {live.version || 1}
        {approvedBy}
      </span>
      <span className="spacer" />
      <WorkflowButtons state={state} act={act} />
      {(canReview() || canEdit()) && state !== 'Deprecated' && (
        <TF
          bare
          className="wf-note"
          value={note}
          placeholder={
            state === 'Ready for review'
              ? 'Review comment (needed to request changes)'
              : 'Comment (optional)'
          }
          onChange={(e) => setNote(e.target.value)}
        />
      )}
    </div>
  );
}

/** The reviewer's comment, while a test waits for the changes they asked for. */
export function ChangesRequested({ live }: { live: Any }) {
  const last = (live.reviews || []).slice(-1)[0];
  if (wfOf(live) !== 'Needs update' || !last?.comment) return null;
  return (
    <div className="warn-banner small" style={{ marginBottom: 10 }}>
      <Ico svg={I.warn} />
      <span>
        <b>{last.by} asked for changes:</b> {last.comment}
      </span>
    </div>
  );
}

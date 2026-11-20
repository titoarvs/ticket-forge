'use client';
// One comment in the activity list, and one history entry.
import { type Any, can, mutate, S, openModal, emit, ago, me, historyText } from '../../core';
import { Ico, I, Avatar, Confirm } from '../../ui';
import { CommentEditor, CommentBody } from '../../CommentEditor';
import { AutoBody } from '../AutoBody';

/** Whether the signed-in person wrote this comment (older comments only have a name). */
const isMine = (c: Any) => (c.authorId ? c.authorId === S.user?.id : c.author === me());

const startEdit = (ev: React.MouseEvent, id: string | null) => {
  ev.preventDefault();
  S.cmtEdit = id;
  emit();
};

function confirmDelete(ev: React.MouseEvent, t: Any, c: Any) {
  ev.preventDefault();
  openModal(
    <Confirm
      title="Delete this comment?"
      label="Delete"
      text="The comment is removed from the issue."
      onYes={() =>
        mutate(() => {
          t.comments = t.comments.filter((x: Any) => x.id !== c.id);
        })
      }
    />,
  );
}

function EditComment({ c }: { c: Any }) {
  return (
    <CommentEditor
      value={c}
      autoFocus
      onCancel={() => {
        S.cmtEdit = null;
        emit();
      }}
      onSave={(v) => {
        S.cmtEdit = null;
        mutate(() => {
          c.body = v.text;
          c.doc = v.doc;
          c.attachments = v.attachments;
          c.editedAt = new Date().toISOString();
        });
      }}
    />
  );
}

function CommentText({ t, c }: { t: Any; c: Any }) {
  if (S.cmtEdit === c.id) return <EditComment c={c} />;
  return (
    <>
      {c.system ? <AutoBody c={c} t={t} /> : <CommentBody c={c} />}
      {!c.system && isMine(c) && can('issue.comment') && (
        <div className="row small" style={{ gap: 10, marginTop: 2 }}>
          <a href="#" onClick={(ev) => startEdit(ev, c.id)}>
            Edit
          </a>
          <a href="#" onClick={(ev) => confirmDelete(ev, t, c)}>
            Delete
          </a>
        </div>
      )}
    </>
  );
}

export function CommentItem({ t, c }: { t: Any; c: Any }) {
  return (
    <div className={`comment ${c.system ? 'auto' : ''}`}>
      {c.system ? (
        <span className="avatar bot" title="Automation">
          <Ico svg={I.bot} />
        </span>
      ) : (
        <Avatar name={c.author} size={32} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div>
          <b>{c.author}</b>
          {c.system && (
            <span className="label-chip" style={{ marginLeft: 6 }}>
              Automated
            </span>
          )}{' '}
          <span className="muted small">
            {ago(c.at)}
            {c.editedAt ? ' · edited' : ''}
          </span>
        </div>
        <CommentText t={t} c={c} />
      </div>
    </div>
  );
}

export function HistoryItem({ h }: { h: Any }) {
  return (
    <div className="hist">
      <Avatar name={h.author} size={24} />
      <div>
        <b>{h.author}</b> {historyText(h)} <span className="muted small">{ago(h.at)}</span>
        {h.from !== undefined && (
          <div className="hist-change">
            <span>{h.from}</span> → <span>{h.to}</span>
          </div>
        )}
      </div>
    </div>
  );
}

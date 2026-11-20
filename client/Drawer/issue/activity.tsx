'use client';
// Activity: comments, history, versions or all of it, newest first, with the comment box.
import { type Any, can, S, emit, saveUi, me } from '../../core';
import { I, Avatar, EmptyState } from '../../ui';
import { saveComment } from '../../actions';
import { CommentEditor } from '../../CommentEditor';
import { VersionHistory } from '../../Versions';
import { CommentItem, HistoryItem } from './comment';

const TABS = [
  ['comments', 'Comments'],
  ['history', 'History'],
  ['versions', 'Versions'],
  ['all', 'All'],
];
const newestFirst = (a: Any, b: Any) => b.at.localeCompare(a.at);

/** What the selected tab lists: comments ('c'), history entries ('h') or both. */
function activityOf(t: Any, tab: string) {
  const comments = [...t.comments].sort(newestFirst).map((c) => ({ kind: 'c', at: c.at, c }));
  const history = [...t.history].sort(newestFirst).map((h) => ({ kind: 'h', at: h.at, h }));
  if (tab === 'history') return history;
  if (tab === 'all') return [...comments, ...history].sort(newestFirst);
  return comments;
}

function Tabs() {
  const pick = (v: string) => {
    S.actTab = v;
    saveUi();
    emit();
  };
  return (
    <div className="seg">
      {TABS.map(([v, l]) => (
        <button
          key={v}
          className={S.actTab === v ? 'on' : ''}
          aria-pressed={S.actTab === v}
          onClick={() => pick(v)}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Composer({ t }: { t: Any }) {
  return (
    <div className="composer" data-tour="composer">
      <Avatar name={me()} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <CommentEditor
          key={t.id}
          compactUntilFocus
          placeholder="Add a comment…"
          onSave={(v) => saveComment(t, v)}
        />
      </div>
    </div>
  );
}

function Empty() {
  if (S.actTab === 'history')
    return (
      <EmptyState compact icon={I.history} tone="neutral" title="No changes yet">
        <p>Edits to this issue are recorded here.</p>
      </EmptyState>
    );
  return (
    <EmptyState compact icon={I.comment} tone="neutral" title="No comments yet">
      <p>Start the conversation about this issue below.</p>
    </EmptyState>
  );
}

function ActivityList({ t }: { t: Any }) {
  const activity = activityOf(t, S.actTab);
  return (
    <>
      {S.actTab !== 'history' && can('issue.comment') && <Composer t={t} />}
      {activity.map((a: Any) =>
        a.kind === 'c' ? (
          <CommentItem key={a.c.id} t={t} c={a.c} />
        ) : (
          <HistoryItem key={a.h.id} h={a.h} />
        ),
      )}
      {!activity.length && <Empty />}
    </>
  );
}

export function ActivitySection({ t }: { t: Any }) {
  return (
    <div className="sec">
      <div className="sec-title">
        <h3>Activity</h3>
      </div>
      <Tabs />
      {S.actTab === 'versions' ? <VersionHistory key={t.id} t={t} /> : <ActivityList t={t} />}
    </div>
  );
}

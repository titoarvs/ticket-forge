'use client';
import { useState, useEffect, memo } from 'react';
import {
  type Any,
  isSub,
  ticket,
  catOf,
  epic,
  statusColor,
  statusOf,
  isBlocked,
  can,
  S,
  emit,
  newTicket,
  mutate,
  toast,
} from '../core';
import { Ico, I, ELoz, TypeIcon } from '../ui';
import { openDrawer } from '../actions';
import { rowDnd } from '../views';
import { rowContextMenu, AssigneeCell, PointsCell, PriorityCell } from '../RowActions';
import { CodeChip } from '../codeStatus';

export const COLLAPSED_W = 44;
/** True on tablets and phones (the width where the issue panel becomes an overlay). */
export function useNarrow() {
  const [n, setN] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 960px)');
    const on = () => setN(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return n;
}
const PRIORITY_TAG: Record<string, [string, string]> = {
  Highest: ['Urgent', 'pt-urgent'],
  High: ['High priority', 'pt-high'],
  Medium: ['Medium', 'pt-medium'],
  Low: ['Low priority', 'pt-low'],
};
const CAT_COLOR: Record<string, string> = {
  todo: 'var(--text-subtlest)',
  inprogress: 'var(--brand)',
  done: '#22c55e',
};
/**
 * One issue card. Memoised: only re-renders when the issue (or its selection, sub-tasks or
 * comments) changes.
 */
export const Card = memo(function Card({
  t,
  showEpic,
  zoneKey,
  active,
  v,
  kidsDone,
  kids,
}: {
  t: Any;
  showEpic: boolean;
  zoneKey: string;
  active: boolean;
  v: string;
  kidsDone: number;
  kids: number;
}) {
  void v; // changes whenever the issue does, so the memo re-renders on edits
  const zone = JSON.parse(zoneKey);
  const parent = isSub(t) ? ticket(t.parentId) : null;
  const cat = catOf(t.status);
  const done = cat === 'done';
  const e = showEpic && !isSub(t) ? epic(t.epicId) : null;
  const pt = PRIORITY_TAG[t.priority];
  const pct = kids ? Math.round((kidsDone / kids) * 100) : 0;
  const tests = t.testCases?.length || 0;
  const passing = tests ? t.testCases.filter((x: Any) => x.status === 'Pass').length : 0;
  const color = statusColor(statusOf(t.status)) || CAT_COLOR[cat];
  return (
    <div
      className={`bcard ${active ? 'active' : ''} ${done ? 'is-done' : ''} ${t.flagged ? 'flagged' : ''}`}
      style={{ ['--pc' as string]: color }}
      role="button"
      tabIndex={0}
      aria-label={`${t.key} ${t.title}`}
      onClick={() => openDrawer('issue', t.id)}
      onContextMenu={(ev) => rowContextMenu(ev, t)}
      onKeyDown={(ev) => {
        if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) {
          ev.preventDefault();
          openDrawer('issue', t.id);
        }
      }}
      {...rowDnd(t, zone)}
    >
      <div className="bcard-tags">
        {t.flagged && (
          <span className="ptag pt-blocked" title="Flagged">
            <Ico svg={I.flag} />
            Flagged
          </span>
        )}
        {pt && <span className={`ptag ${pt[1]}`}>{pt[0]}</span>}
        {e && <ELoz e={e} />}
        {t.labels?.slice(0, 2).map((l: string) => (
          <span key={l} className="label-chip">
            {l}
          </span>
        ))}
        {isBlocked(t) && (
          <span className="ptag pt-blocked" title="Blocked by an open issue">
            <Ico svg={I.flag} />
            Blocked
          </span>
        )}
      </div>
      {parent && (
        <div className="muted small bcard-parent">
          <TypeIcon type={parent.type} /> {parent.key} {parent.title}
        </div>
      )}
      <div className="t">{t.title}</div>
      {kids > 0 && (
        <div className="bcard-prog" title={`${kidsDone} of ${kids} sub-tasks done`}>
          <div className="bcard-prog-h">
            <span>Progress</span>
            <b>{pct === 100 ? 'Done' : `${pct}%`}</b>
          </div>
          <div className="bcard-bar">
            <i style={{ width: `${Math.max(pct, 2)}%` }} />
          </div>
        </div>
      )}
      <div className="foot">
        <AssigneeCell t={t} />
        <TypeIcon type={t.type} />
        <span className={`key ${done ? 'done' : ''}`}>{t.key}</span>
        <span className="right">
          <CodeChip t={t} />
          {t.prs.length > 0 && (
            <span
              className="mini"
              title={`${t.prs.length} pull request${t.prs.length > 1 ? 's' : ''}`}
            >
              <Ico svg={I.pr} />
              {t.prs.length}
            </span>
          )}
          {t.comments?.length > 0 && (
            <span
              className="mini"
              title={`${t.comments.length} comment${t.comments.length > 1 ? 's' : ''}`}
            >
              <Ico svg={I.comment} />
              {t.comments.length}
            </span>
          )}
          {tests > 0 && (
            <span className="mini" title={`${passing} of ${tests} test cases passing`}>
              <Ico svg={I.check} />
              {passing}/{tests}
            </span>
          )}
          {(t.storyPoints != null || can('issue.edit')) && <PointsCell t={t} />}
          <PriorityCell t={t} />
        </span>
      </div>
    </div>
  );
});
/** "+ Create issue" at the bottom of a column: type a summary, Enter to add it in that status (and lane).
 *  The "+" in a column header opens the one in the first open lane (S.boardCreate holds its id). */
export function QuickCreate({ id, status, fields }: { id: string; status: string; fields: Any }) {
  const [local, setLocal] = useState(false);
  const [title, setTitle] = useState('');
  const open = local || S.boardCreate === id;
  const setOpen = (v: boolean) => {
    setLocal(v);
    if (!v && S.boardCreate === id) {
      S.boardCreate = null;
      emit();
    }
  };
  const create = () => {
    if (!title.trim()) {
      setOpen(false);
      return;
    }
    const nt = newTicket({ title: title.trim(), type: 'Story', status, ...fields });
    mutate((p) => p.tickets.push(nt));
    toast(`Created ${nt.key}`);
    setTitle('');
  };
  if (!open)
    return (
      <button className="bcreate" onClick={() => setOpen(true)}>
        <Ico svg={I.plus} />
        Create issue
      </button>
    );
  return (
    <textarea
      className="bcreate-input"
      autoFocus
      rows={2}
      value={title}
      placeholder="What needs to be done?"
      aria-label={`New issue in ${status}`}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => {
        if (!title.trim()) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          create();
        }
        if (e.key === 'Escape') {
          setTitle('');
          setOpen(false);
        }
      }}
    />
  );
}

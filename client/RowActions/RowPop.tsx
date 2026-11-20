'use client';
import { useRef, useState, useLayoutEffect, useEffect } from 'react';
import {
  ticket,
  openSprints,
  type Any,
  isSub,
  S,
  can,
  P,
  epic,
  releases,
  release,
  copyText,
} from '../core';
import { Ico, I, PriorityIcon } from '../ui';
import { openDrawer, duplicateIssue } from '../actions';
import {
  canEdit,
  closePop,
  plural,
  canSprint,
  moveTo,
  assignTo,
  swapPop,
  setFlag,
  issueLink,
  confirmDelete,
  type Pop,
  stop,
} from './move-to';
import {
  StatusList,
  AssigneeList,
  PointsEditor,
  PriorityList,
  EpicList,
  VersionList,
} from './AssigneeList';

function MoreMenu({ ids }: { ids: string[] }) {
  const list = ids.map(ticket).filter(Boolean);
  if (!list.length) return null;
  const one = list.length === 1 ? list[0] : null;
  const edit = canEdit();
  const open = openSprints();
  const openIds = new Set(open.map((s: Any) => s.id));
  const subs = list.every((t: Any) => isSub(t));
  const mine = S.user?.name || '';
  const allFlagged = list.every((t: Any) => t.flagged);
  const act = (fn: () => void) => () => {
    closePop();
    fn();
  };
  return (
    <div className="pop-menu" role="menu">
      {!one && <div className="mh">{plural(list.length, 'issue')} selected</div>}
      {canSprint() && !subs && (
        <>
          <div className="mh">Move to</div>
          <button role="menuitem" onClick={act(() => moveTo(ids, null, 'top'))}>
            <Ico svg={I.up} />
            Top of backlog
          </button>
          <button role="menuitem" onClick={act(() => moveTo(ids, null, 'bottom'))}>
            <Ico svg={I.down} />
            Bottom of backlog
          </button>
          {open
            .filter((s: Any) => !one || one.sprintId !== s.id)
            .map((s: Any) => (
              <button key={s.id} role="menuitem" onClick={act(() => moveTo(ids, s.id, 'bottom'))}>
                <Ico svg={I.calendar} />
                {s.name}
                {s.state === 'active' && <small>Active</small>}
              </button>
            ))}
          {one && openIds.has(one.sprintId) && (
            <button
              role="menuitem"
              onClick={act(() =>
                moveTo(ids, open.find((s: Any) => s.id === one.sprintId).id, 'top'),
              )}
            >
              <Ico svg={I.up} />
              Top of {open.find((s: Any) => s.id === one.sprintId).name}
            </button>
          )}
          <hr />
        </>
      )}
      {edit && (
        <>
          {mine && !(one && one.assignee === mine) && (
            <button role="menuitem" onClick={act(() => assignTo(ids, mine))}>
              <Ico svg={I.user} />
              Assign to me
            </button>
          )}
          {list.some((t: Any) => t.assignee) && (
            <button role="menuitem" onClick={act(() => assignTo(ids, ''))}>
              <Ico svg={I.close} />
              Unassign
            </button>
          )}
          <button role="menuitem" onClick={() => swapPop('assignee')}>
            <Ico svg={I.people} />
            Assign to…
          </button>
          <button role="menuitem" onClick={() => swapPop('status')}>
            <Ico svg={I.board} />
            Change status…
          </button>
          <button role="menuitem" onClick={() => swapPop('points')}>
            <span className="mi-sp">#</span>Story points…
            {one?.storyPoints != null && <small>{one.storyPoints}</small>}
          </button>
          <button role="menuitem" onClick={() => swapPop('priority')}>
            <PriorityIcon p={one?.priority || 'Medium'} />
            Priority…{one && <small>{one.priority}</small>}
          </button>
          {(can('epic.manage') || edit) && !subs && P().epics.length > 0 && (
            <button role="menuitem" onClick={() => swapPop('epic')}>
              <Ico svg={I.epic} />
              Change epic…{one && epic(one.epicId) && <small>{epic(one.epicId).title}</small>}
            </button>
          )}
          {!subs &&
            (can('sprint.manage') || edit) &&
            releases().some((r: Any) => r.status !== 'archived') && (
              <button role="menuitem" onClick={() => swapPop('version')}>
                <Ico svg={I.calendar} />
                Fix version…
                {one && (one.fixVersions || []).length > 0 && (
                  <small>
                    {(one.fixVersions || [])
                      .map((v: string) => release(v)?.name)
                      .filter(Boolean)
                      .join(', ')}
                  </small>
                )}
              </button>
            )}
          <button role="menuitem" onClick={act(() => setFlag(ids, !allFlagged))}>
            <Ico svg={I.flag} />
            {allFlagged ? 'Remove flag' : 'Add flag'}
          </button>
          <hr />
        </>
      )}
      {one && (
        <>
          <button role="menuitem" onClick={act(() => openDrawer('issue', one.id))}>
            <Ico svg={I.expand} />
            Open {one.key}
          </button>
          <button role="menuitem" onClick={act(() => copyText(issueLink(one)))}>
            <Ico svg={I.link} />
            Copy issue link
          </button>
          <button role="menuitem" onClick={act(() => copyText(one.key))}>
            <Ico svg={I.copy} />
            Copy issue key
          </button>
          {can('issue.create') && (
            <button role="menuitem" onClick={act(() => duplicateIssue(one))}>
              <Ico svg={I.copy} />
              Duplicate
            </button>
          )}
        </>
      )}
      {!one && (
        <button
          role="menuitem"
          onClick={act(() => copyText(list.map((t: Any) => t.key).join(', ')))}
        >
          <Ico svg={I.copy} />
          Copy issue keys
        </button>
      )}
      {can('issue.delete') && (
        <>
          <hr />
          <button role="menuitem" className="danger" onClick={act(() => confirmDelete(ids))}>
            <Ico svg={I.trash} />
            Delete{!one ? ` ${plural(list.length, 'issue')}` : ''}
          </button>
        </>
      )}
    </div>
  );
}
/** The one popup for row actions. Render it once on a page that shows issue rows. */
export function RowPop() {
  const pop: Pop | null = S.pop;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!pop || !ref.current) {
      setPos(null);
      return;
    }
    const r = ref.current.getBoundingClientRect();
    const vw = window.innerWidth,
      vh = window.innerHeight;
    const left = Math.max(8, Math.min(pop.x, vw - r.width - 8));
    const below = pop.y + r.height <= vh - 8;
    const top = below ? pop.y : Math.max(8, pop.bottom - r.height);
    setPos({ left, top });
  }, [pop?.at, pop?.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pop) return undefined;
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) closePop();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePop();
      }
    };
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) closePop();
    };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', closePop);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', closePop);
    };
  }, [pop?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pop || !P()) return null;
  const ids = pop.ids.filter((id) => ticket(id));
  if (!ids.length) return null;
  const Body = {
    status: StatusList,
    assignee: AssigneeList,
    points: PointsEditor,
    priority: PriorityList,
    epic: EpicList,
    version: VersionList,
    more: MoreMenu,
  }[pop.kind];
  return (
    <div
      ref={ref}
      className={`row-pop pop-${pop.kind}`}
      role="dialog"
      aria-label={pop.kind === 'more' ? 'Issue actions' : `Change ${pop.kind}`}
      style={{ left: pos?.left ?? pop.x, top: pos?.top ?? pop.y, opacity: pos ? 1 : 0 }}
      onClick={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {ids.length > 1 && pop.kind !== 'more' && pop.kind !== 'points' && (
        <div className="pop-h">{plural(ids.length, 'issue')} selected</div>
      )}
      <Body key={`${pop.kind}${pop.at}`} ids={ids} />
    </div>
  );
}

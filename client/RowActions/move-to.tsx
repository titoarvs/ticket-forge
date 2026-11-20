'use client';
import type { MouseEvent as RMouseEvent } from 'react';
import {
  can,
  S,
  ticket,
  emit,
  type Any,
  toast,
  undo,
  editField,
  mutate,
  setField,
  canMove,
  isSub,
  epic,
  openSprints,
  P,
  openModal,
  deleteIssues,
  sCls,
} from '../core';
import { Confirm, Ico, I, Avatar, PriorityIcon } from '../ui';

type PopKind = 'status' | 'assignee' | 'points' | 'priority' | 'epic' | 'version' | 'more';
export type Pop = {
  kind: PopKind;
  ids: string[];
  x: number;
  y: number;
  bottom: number;
  at: number;
};
export const POINTS = [1, 2, 3, 5, 8, 13, 21];
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const canEdit = () => can('issue.edit');
export const canSprint = () => can('sprint.manage') || can('issue.edit');
/**
 * The issues an action on this row applies to: the whole selection when the row is part of it, else
 * just the row.
 */
const targetIds = (id: string): string[] =>
  S.checked.has(id) && S.checked.size > 1 ? [...S.checked].filter((x: string) => ticket(x)) : [id];
/** Opens the row popup next to a button (or at the mouse, for a right-click). */
export function openPop(
  kind: PopKind,
  ids: string[],
  from: HTMLElement | { x: number; y: number },
) {
  let x: number, y: number, bottom: number;
  if (from instanceof HTMLElement) {
    const r = from.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 4;
    bottom = r.top - 4;
  } else {
    x = from.x;
    y = from.y;
    bottom = from.y;
  }
  S.pop = { kind, ids, x, y, bottom, at: Date.now() } as Pop;
  emit();
}
export function closePop() {
  if (S.pop) {
    S.pop = null;
    emit();
  }
}
export const swapPop = (kind: PopKind) => {
  if (S.pop) {
    S.pop = { ...S.pop, kind };
    emit();
  }
};
export const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
/** Props for a field button inside a draggable, clickable row. */
const cellProps = (label: string, kind: PopKind, t: Any) => ({
  type: 'button' as const,
  draggable: false,
  'aria-label': label,
  'aria-haspopup': 'dialog' as const,
  'aria-expanded': S.pop?.kind === kind && S.pop.ids.includes(t.id),
  onMouseDown: stop,
  onDragStart: (e: Any) => {
    e.preventDefault();
    e.stopPropagation();
  },
  onClick: (e: RMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    openPop(kind, targetIds(t.id), e.currentTarget);
  },
});
// ---------------------------------------------------------------- actions (every one is undoable
// with ⌘Z)
function report(ids: string[], what: string) {
  if (ids.length > 1)
    toast(`${plural(ids.length, 'issue')} ${what}`, 'ok', {
      action: { label: 'Undo', onClick: undo },
    });
}
/**
 * `now`: save at once and put the old value back if the save fails (assignee, story points and
 * priority).
 */
function setFieldFor(ids: string[], field: string, value: Any, what: string, now = false) {
  const list = ids
    .map(ticket)
    .filter((t: Any) => t && JSON.stringify(t[field] ?? null) !== JSON.stringify(value ?? null));
  if (!list.length) return;
  if (now) editField(list, field, value);
  else
    mutate(() => list.forEach((t: Any) => setField(t, field, value)), {
      tag: ids.length === 1 ? `t.${field}${ids[0]}` : '',
    });
  report(
    list.map((t: Any) => t.id),
    what,
  );
}
export function setStatusFor(ids: string[], to: string) {
  const list = ids.map(ticket).filter((t: Any) => t && t.status !== to);
  const ok = list.filter((t: Any) => canMove(t, to));
  if (ok.length) mutate(() => ok.forEach((t: Any) => setField(t, 'status', to)));
  const skipped = list.length - ok.length;
  if (skipped)
    toast(
      `${plural(ok.length, 'issue')} moved to ${to}. ${skipped} skipped: the workflow doesn’t allow moving ${skipped === 1 ? 'it' : 'them'} to ${to} from ${skipped === 1 ? 'its' : 'their'} current status.`,
      'warn',
    );
  else
    report(
      ok.map((t: Any) => t.id),
      `moved to ${to}`,
    );
}
export const assignTo = (ids: string[], name: string) =>
  setFieldFor(ids, 'assignee', name, name ? `assigned to ${name}` : 'unassigned', true);
export const setPoints = (ids: string[], v: number | null) =>
  setFieldFor(
    ids,
    'storyPoints',
    v,
    v === null ? 'estimate cleared' : `estimated at ${v} points`,
    true,
  );
export const setPriority = (ids: string[], v: string) =>
  setFieldFor(ids, 'priority', v, `set to ${v} priority`, true);
export const setFlag = (ids: string[], on: boolean) =>
  setFieldFor(ids, 'flagged', on || undefined, on ? 'flagged' : 'unflagged');
export const setEpic = (ids: string[], epicId: string | null) =>
  setFieldFor(
    ids.filter((id) => !isSub(ticket(id))),
    'epicId',
    epicId,
    epicId ? `moved to ${epic(epicId)?.title}` : 'removed from their epic',
  );
/** In the backlog (no open sprint, or a closed one), as the Backlog group shows it. */
const inBacklog = (t: Any, open: Set<string>) => !isSub(t) && !open.has(t.sprintId);
/**
 * Moves issues to the top or bottom of a sprint or of the backlog (sprintId null), keeping their
 * order.
 */
export function moveTo(ids: string[], sprintId: string | null, where: 'top' | 'bottom') {
  const open = new Set<string>(openSprints().map((s: Any) => s.id));
  const target = sprintId ? P().sprints.find((s: Any) => s.id === sprintId) : null;
  mutate((p) => {
    const set = new Set(ids);
    const moving = p.tickets.filter((t: Any) => set.has(t.id));
    for (const t of moving)
      if ((t.sprintId || null) !== sprintId && (sprintId || open.has(t.sprintId)))
        setField(t, 'sprintId', sprintId);
    const rest = p.tickets.filter((t: Any) => !set.has(t.id));
    const inTarget = (t: Any) =>
      sprintId ? !isSub(t) && t.sprintId === sprintId : inBacklog(t, open);
    let at: number;
    if (where === 'top') {
      at = rest.findIndex(inTarget);
      if (at < 0) at = rest.length;
    } else {
      let last = -1;
      rest.forEach((t: Any, i: number) => {
        if (inTarget(t)) last = i;
      });
      at = last < 0 ? rest.length : last + 1;
    }
    rest.splice(at, 0, ...moving);
    p.tickets = rest;
  });
  const where2 = target ? target.name : 'the backlog';
  toast(
    `${ids.length === 1 ? ticket(ids[0])?.key : plural(ids.length, 'issue')} moved to the ${where} of ${where2}`,
    'ok',
    {
      action: { label: 'Undo', onClick: undo },
    },
  );
}
export const issueLink = (t: Any) =>
  `${location.origin}/p/${P().id}/backlog?issue=${encodeURIComponent(t.id)}`;
export function confirmDelete(ids: string[]) {
  const one = ids.length === 1 ? ticket(ids[0]) : null;
  openModal(
    <Confirm
      title={one ? `Delete ${one.key}?` : `Delete ${plural(ids.length, 'issue')}?`}
      label="Delete"
      text="Their sub-tasks are deleted too. You can undo with ⌘Z."
      onYes={() => {
        let n = 0;
        mutate(() => {
          n = deleteIssues(ids);
        });
        ids.forEach((id) => S.checked.delete(id));
        if (S.drawer && ids.includes(S.drawer.id)) S.drawer = null;
        emit();
        toast(`Deleted ${plural(n, 'issue')}`, 'ok', { action: { label: 'Undo', onClick: undo } });
      }}
    />,
  );
}
// ---------------------------------------------------------------- row cells
export function StatusCell({ t }: { t: Any }) {
  if (!canEdit()) return <span className={`loz ${sCls(t.status)}`}>{t.status}</span>;
  return (
    <button
      className={`loz loz-btn ${sCls(t.status)}`}
      {...cellProps(`Status of ${t.key}: ${t.status}. Change`, 'status', t)}
    >
      {t.status}
      <Ico svg={I.chevron} />
    </button>
  );
}
export function AssigneeCell({ t }: { t: Any }) {
  if (!canEdit())
    return (
      <span title={t.assignee || 'Unassigned'}>
        <Avatar name={t.assignee} />
      </span>
    );
  return (
    <button
      className="cell-btn av-cell"
      title={t.assignee ? `Assignee: ${t.assignee}` : 'Unassigned'}
      {...cellProps(`Assignee of ${t.key}: ${t.assignee || 'Unassigned'}. Change`, 'assignee', t)}
    >
      <Avatar name={t.assignee} />
    </button>
  );
}
export function PointsCell({ t }: { t: Any }) {
  const v = t.storyPoints ?? null;
  if (!canEdit())
    return (
      <span className="sp" title="Story points">
        {v ?? '–'}
      </span>
    );
  return (
    <button
      className={`sp sp-btn ${v === null ? 'none' : ''}`}
      title="Story point estimate"
      {...cellProps(`Story points of ${t.key}: ${v ?? 'none'}. Change`, 'points', t)}
    >
      {v ?? '–'}
    </button>
  );
}
export function PriorityCell({ t }: { t: Any }) {
  if (!canEdit())
    return (
      <span title={`${t.priority} priority`}>
        <PriorityIcon p={t.priority} />
      </span>
    );
  return (
    <button
      className="cell-btn"
      title={`${t.priority} priority`}
      {...cellProps(`Priority of ${t.key}: ${t.priority}. Change`, 'priority', t)}
    >
      <PriorityIcon p={t.priority} />
    </button>
  );
}
export function MoreCell({ t }: { t: Any }) {
  return (
    <button
      className="icon-btn row-more"
      title="More actions (or right-click the row)"
      {...cellProps(`More actions for ${t.key}`, 'more', t)}
    >
      <Ico svg={I.more} />
    </button>
  );
}
/** Right-click on a row: the "…" menu at the mouse. */
export function rowContextMenu(e: RMouseEvent, t: Any) {
  if ((e.target as HTMLElement).closest('input, textarea, a')) return;
  e.preventDefault();
  openPop('more', targetIds(t.id), { x: e.clientX, y: e.clientY });
}

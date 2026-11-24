'use client';
import { type DragEvent, type ReactNode, memo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  can,
  type Any,
  canMove,
  ticket,
  P,
  S,
  peopleNames,
  statusNames,
  filtersActive,
  releases,
  emit,
  TYPES,
  PRIORITIES,
  EMPTY_FILTER,
  epicTickets,
  catOf,
} from '../core';
import { Avatar, I, Ico } from '../ui';
import { moveTicket } from '../actions';
import { TF, SF, MenuItem, opts } from '../fields';
import { VIEW_ICON } from '../Workspace/view-icons';

// ---------------------------------------------------------------- drag & drop
let dragId: string | null = null;
const clearDrop = () =>
  document
    .querySelectorAll('.drop, .drop-before, .no-drop')
    .forEach((n) => n.classList.remove('drop', 'drop-before', 'no-drop'));
const canDrag = () => can('issue.edit') || can('sprint.manage') || can('epic.manage');
/** The status a drop target would give the issue, if any. */
const zoneStatus = (zone: Any) =>
  zone?.status || (zone?.group?.startsWith('s:') ? zone.group.slice(2) : '');
/** Whether the dragged issue may be dropped here (custom workflow transitions). */
const dropOk = (zone: Any) => {
  const st = zoneStatus(zone);
  return !st || !dragId || canMove(ticket(dragId), st);
};
export function rowDnd(t: Any, zone: Any) {
  if (!canDrag()) return {};
  return {
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      dragId = t.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.id);
      e.currentTarget.classList.add('dragging');
      // Grey out the columns and groups this issue can't move to.
      document
        .querySelectorAll<HTMLElement>('[data-drop-status]')
        .forEach((el) => el.classList.toggle('no-drop', !canMove(t, el.dataset.dropStatus || '')));
    },
    onDragEnd: (e: DragEvent<HTMLElement>) => {
      dragId = null;
      e.currentTarget.classList.remove('dragging');
      clearDrop();
    },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragId && dragId !== t.id && dropOk(zone)) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.add('drop-before');
      }
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => e.currentTarget.classList.remove('drop-before'),
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      clearDrop();
      if (dragId) moveTicket(dragId, zone, t.id);
    },
  };
}
export function zoneDnd(zone: Any) {
  return {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragId && dropOk(zone)) {
        e.preventDefault();
        e.currentTarget.classList.add('drop');
      }
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node))
        e.currentTarget.classList.remove('drop');
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      clearDrop();
      if (dragId) moveTicket(dragId, zone);
    },
  };
}
/** The trail to a page: back to the projects, then where you are. */
export function Crumbs({ children }: { children?: ReactNode }) {
  return (
    <div className="crumbs">
      <Link
        className="crumb-back"
        href="/projects"
        aria-label="Back to projects"
        title="All projects"
      >
        <Ico svg={I.left} />
      </Link>
      <Link href="/projects">Projects</Link>
      <span aria-hidden>/</span>
      {children}
    </div>
  );
}
export function Header({
  title,
  right,
  sub,
}: {
  title: string;
  right?: ReactNode;
  sub?: ReactNode;
}) {
  const icon = VIEW_ICON[usePathname().split('/')[3]] || VIEW_ICON.backlog;
  return (
    <>
      <Crumbs>
        <Link href={`/p/${P().id}/summary`}>{P().name}</Link>
      </Crumbs>
      <div className="page-h">
        <Ico svg={icon} size={24} className="page-ic" />
        <h1>{title}</h1>
        {sub}
        <div className="spacer" />
        {right}
      </div>
    </>
  );
}
type FilterProps = {
  status?: boolean;
  group?: { value: string; options: [string, string][]; onChange: (v: string) => void };
};
/**
 * The filter bar redraws only when what it shows changes (its menus are heavy to redraw on every
 * change).
 */
export function FilterBar(props: FilterProps) {
  const sig = [
    JSON.stringify(S.filter),
    props.status !== false,
    props.group?.value,
    peopleNames().join(),
    P()
      .epics.map((e: Any) => `${e.id}${e.title}`)
      .join(),
    statusNames().join(),
    filtersActive(),
    releases()
      .map((r: Any) => r.id + r.name + r.status)
      .join(),
  ].join('|');
  return <FilterBarView {...props} sig={sig} />;
}
const FilterBarView = memo(
  function FilterBarView({ status = true, group }: FilterProps & { sig: string }) {
    const f = S.filter;
    const setF = (k: string, v: string) => {
      S.filter = { ...S.filter, [k]: v };
      emit();
    };
    const people = peopleNames();
    return (
      <div className="toolbar">
        <TF
          search
          sx={{ width: 220 }}
          id="fq"
          placeholder="Search issues"
          value={f.q}
          onChange={(e) => setF('q', e.target.value)}
        />
        {people.length > 0 && (
          <div className="avatars" role="group" aria-label="Filter by assignee">
            {people.slice(0, 6).map((n) => (
              <button
                key={n}
                className={`av-btn ${f.assignee === n ? 'on' : ''}`}
                title={n}
                onClick={() => setF('assignee', f.assignee === n ? '' : n)}
              >
                <Avatar name={n} size={28} />
              </button>
            ))}
          </div>
        )}
        <SF filter aria-label="Epic" value={f.epic} onChange={(e) => setF('epic', e.target.value)}>
          <MenuItem value="">Epic</MenuItem>
          {P().epics.map((e: Any) => (
            <MenuItem key={e.id} value={e.id}>
              {e.title}
            </MenuItem>
          ))}
          <MenuItem value="none">No epic</MenuItem>
        </SF>
        <SF filter aria-label="Type" value={f.type} onChange={(e) => setF('type', e.target.value)}>
          <MenuItem value="">Type</MenuItem>
          {opts([...TYPES, 'Sub-task'])}
        </SF>
        <SF
          filter
          aria-label="Priority"
          value={f.priority}
          onChange={(e) => setF('priority', e.target.value)}
        >
          <MenuItem value="">Priority</MenuItem>
          {opts(PRIORITIES)}
        </SF>
        {status && (
          <SF
            filter
            aria-label="Status"
            value={f.status}
            onChange={(e) => setF('status', e.target.value)}
          >
            <MenuItem value="">Status</MenuItem>
            {opts(statusNames())}
          </SF>
        )}
        {releases().length > 0 && (
          <SF
            filter
            aria-label="Fix version"
            value={f.version || ''}
            onChange={(e) => setF('version', e.target.value)}
          >
            <MenuItem value="">Version</MenuItem>
            {releases()
              .filter((r: Any) => r.status !== 'archived' || f.version === r.id)
              .map((r: Any) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.name}
                </MenuItem>
              ))}
            <MenuItem value="none">No version</MenuItem>
          </SF>
        )}
        {filtersActive() && (
          <button
            className="btn subtle"
            onClick={() => {
              S.filter = EMPTY_FILTER();
              emit();
            }}
          >
            Clear filters
          </button>
        )}
        <div className="spacer" />
        {group && (
          <>
            <span className="muted small">Group by</span>
            <SF filter value={group.value} onChange={(e) => group.onChange(e.target.value)}>
              {group.options.map(([v, l]) => (
                <MenuItem key={v} value={v}>
                  {l}
                </MenuItem>
              ))}
            </SF>
          </>
        )}
      </div>
    );
  },
  (a, b) => a.sig === b.sig,
);
export function epicProgress(e: Any) {
  const ts = epicTickets(e.id);
  const c = (cat: string) => ts.filter((t: Any) => catOf(t.status) === cat).length;
  return { ts, done: c('done'), prog: c('inprogress'), total: ts.length };
}
export function ProgBar({ done, prog, total }: { done: number; prog: number; total: number }) {
  const w = (v: number) => `${total ? (v / total) * 100 : 0}%`;
  return (
    <div
      className="prog"
      title={`${done} done · ${prog} in progress · ${total - done - prog} to do`}
    >
      {done > 0 && <i className="p-done" style={{ width: w(done) }} />}
      {prog > 0 && <i className="p-prog" style={{ width: w(prog) }} />}
    </div>
  );
}
export const Tally = ({ items }: { items: Any[] }) => {
  const c = (cat: string) => items.filter((t) => catOf(t.status) === cat).length;
  return (
    <span className="tally" title="To do · In progress · Done">
      <span className="loz s-todo">{c('todo')}</span>
      <span className="loz s-inprogress">{c('inprogress')}</span>
      <span className="loz s-done">{c('done')}</span>
    </span>
  );
};

'use client';
// Issue row actions, Jira-style. On a backlog row you click the field you want to change (status, assignee, story
// points, priority) and pick from a small popup; "…" (or a right-click on the row) has the rest: move to the top or
// bottom of the backlog or to a sprint, assign to me, flag, epic, copy the link, duplicate, delete. When the row is
// part of a selection, the change applies to every selected issue.
// One popup for the whole page (S.pop), drawn by <RowPop />: rows stay light (plain buttons, no menus inside them),
// so a backlog of thousands of issues still scrolls and updates quickly.
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as RMouseEvent, type KeyboardEvent as RKeyboardEvent } from 'react';
import {
  S, emit, P, ticket, epic, isSub, openSprints, statusNames, allowedStatuses, canMove, sCls, setField, mutate, deleteIssues, peopleNames, me, can,
  toast, openModal, undo, copyText, PRIORITIES, releases, release, editField, type Any,
} from './core';
import { Ico, I, PriorityIcon, Avatar, Swatch, Confirm } from './ui';
import { openDrawer, duplicateIssue } from './actions';

type PopKind = 'status' | 'assignee' | 'points' | 'priority' | 'epic' | 'version' | 'more';
type Pop = { kind: PopKind; ids: string[]; x: number; y: number; bottom: number; at: number };

const POINTS = [1, 2, 3, 5, 8, 13, 21];
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const canEdit = () => can('issue.edit');
const canSprint = () => can('sprint.manage') || can('issue.edit');

/** The issues an action on this row applies to: the whole selection when the row is part of it, else just the row. */
const targetIds = (id: string): string[] => (S.checked.has(id) && S.checked.size > 1 ? [...S.checked].filter((x: string) => ticket(x)) : [id]);

/** Opens the row popup next to a button (or at the mouse, for a right-click). */
export function openPop(kind: PopKind, ids: string[], from: HTMLElement | { x: number; y: number }) {
  let x: number, y: number, bottom: number;
  if (from instanceof HTMLElement) { const r = from.getBoundingClientRect(); x = r.left; y = r.bottom + 4; bottom = r.top - 4; }
  else { x = from.x; y = from.y; bottom = from.y; }
  S.pop = { kind, ids, x, y, bottom, at: Date.now() } as Pop;
  emit();
}
function closePop() { if (S.pop) { S.pop = null; emit(); } }
const swapPop = (kind: PopKind) => { if (S.pop) { S.pop = { ...S.pop, kind }; emit(); } };
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
/** Props for a field button inside a draggable, clickable row. */
const cellProps = (label: string, kind: PopKind, t: Any) => ({
  type: 'button' as const, draggable: false, 'aria-label': label, 'aria-haspopup': 'dialog' as const,
  'aria-expanded': S.pop?.kind === kind && S.pop.ids.includes(t.id),
  onMouseDown: stop, onDragStart: (e: Any) => { e.preventDefault(); e.stopPropagation(); },
  onClick: (e: RMouseEvent<HTMLButtonElement>) => { e.stopPropagation(); openPop(kind, targetIds(t.id), e.currentTarget); },
});

// ---------------------------------------------------------------- actions (every one is undoable with ⌘Z)
function report(ids: string[], what: string) {
  if (ids.length > 1) toast(`${plural(ids.length, 'issue')} ${what}`, 'ok', { action: { label: 'Undo', onClick: undo } });
}
/** `now`: save at once and put the old value back if the save fails (assignee, story points and priority). */
function setFieldFor(ids: string[], field: string, value: Any, what: string, now = false) {
  const list = ids.map(ticket).filter((t: Any) => t && JSON.stringify(t[field] ?? null) !== JSON.stringify(value ?? null));
  if (!list.length) return;
  if (now) editField(list, field, value);
  else mutate(() => list.forEach((t: Any) => setField(t, field, value)), { tag: ids.length === 1 ? `t.${field}${ids[0]}` : '' });
  report(list.map((t: Any) => t.id), what);
}
export function setStatusFor(ids: string[], to: string) {
  const list = ids.map(ticket).filter((t: Any) => t && t.status !== to);
  const ok = list.filter((t: Any) => canMove(t, to));
  if (ok.length) mutate(() => ok.forEach((t: Any) => setField(t, 'status', to)));
  const skipped = list.length - ok.length;
  if (skipped) toast(`${plural(ok.length, 'issue')} moved to ${to}. ${skipped} skipped: the workflow doesn’t allow moving ${skipped === 1 ? 'it' : 'them'} to ${to} from ${skipped === 1 ? 'its' : 'their'} current status.`, 'warn');
  else report(ok.map((t: Any) => t.id), `moved to ${to}`);
}
export const assignTo = (ids: string[], name: string) => setFieldFor(ids, 'assignee', name, name ? `assigned to ${name}` : 'unassigned', true);
export const setPoints = (ids: string[], v: number | null) => setFieldFor(ids, 'storyPoints', v, v === null ? 'estimate cleared' : `estimated at ${v} points`, true);
export const setPriority = (ids: string[], v: string) => setFieldFor(ids, 'priority', v, `set to ${v} priority`, true);
export const setFlag = (ids: string[], on: boolean) => setFieldFor(ids, 'flagged', on || undefined, on ? 'flagged' : 'unflagged');
export const setEpic = (ids: string[], epicId: string | null) => setFieldFor(ids.filter((id) => !isSub(ticket(id))), 'epicId', epicId, epicId ? `moved to ${epic(epicId)?.title}` : 'removed from their epic');

/** In the backlog (no open sprint, or a closed one), as the Backlog group shows it. */
const inBacklog = (t: Any, open: Set<string>) => !isSub(t) && !open.has(t.sprintId);
/** Moves issues to the top or bottom of a sprint or of the backlog (sprintId null), keeping their order. */
export function moveTo(ids: string[], sprintId: string | null, where: 'top' | 'bottom') {
  const open = new Set<string>(openSprints().map((s: Any) => s.id));
  const target = sprintId ? P().sprints.find((s: Any) => s.id === sprintId) : null;
  mutate((p) => {
    const set = new Set(ids);
    const moving = p.tickets.filter((t: Any) => set.has(t.id));
    for (const t of moving) if ((t.sprintId || null) !== sprintId && (sprintId || open.has(t.sprintId))) setField(t, 'sprintId', sprintId);
    const rest = p.tickets.filter((t: Any) => !set.has(t.id));
    const inTarget = (t: Any) => (sprintId ? !isSub(t) && t.sprintId === sprintId : inBacklog(t, open));
    let at: number;
    if (where === 'top') { at = rest.findIndex(inTarget); if (at < 0) at = rest.length; }
    else { let last = -1; rest.forEach((t: Any, i: number) => { if (inTarget(t)) last = i; }); at = last < 0 ? rest.length : last + 1; }
    rest.splice(at, 0, ...moving);
    p.tickets = rest;
  });
  const where2 = target ? target.name : 'the backlog';
  toast(`${ids.length === 1 ? ticket(ids[0])?.key : plural(ids.length, 'issue')} moved to the ${where} of ${where2}`, 'ok', { action: { label: 'Undo', onClick: undo } });
}
const issueLink = (t: Any) => `${location.origin}/p/${P().id}/backlog?issue=${encodeURIComponent(t.id)}`;
function confirmDelete(ids: string[]) {
  const one = ids.length === 1 ? ticket(ids[0]) : null;
  openModal(<Confirm title={one ? `Delete ${one.key}?` : `Delete ${plural(ids.length, 'issue')}?`} label="Delete" text="Their sub-tasks are deleted too. You can undo with ⌘Z."
    onYes={() => { let n = 0; mutate(() => { n = deleteIssues(ids); }); ids.forEach((id) => S.checked.delete(id)); if (S.drawer && ids.includes(S.drawer.id)) S.drawer = null; emit(); toast(`Deleted ${plural(n, 'issue')}`, 'ok', { action: { label: 'Undo', onClick: undo } }); }} />);
}

// ---------------------------------------------------------------- row cells
export function StatusCell({ t }: { t: Any }) {
  if (!canEdit()) return <span className={`loz ${sCls(t.status)}`}>{t.status}</span>;
  return <button className={`loz loz-btn ${sCls(t.status)}`} {...cellProps(`Status of ${t.key}: ${t.status}. Change`, 'status', t)}>{t.status}<Ico svg={I.chevron} /></button>;
}
export function AssigneeCell({ t }: { t: Any }) {
  if (!canEdit()) return <span title={t.assignee || 'Unassigned'}><Avatar name={t.assignee} /></span>;
  return <button className="cell-btn av-cell" title={t.assignee ? `Assignee: ${t.assignee}` : 'Unassigned'} {...cellProps(`Assignee of ${t.key}: ${t.assignee || 'Unassigned'}. Change`, 'assignee', t)}><Avatar name={t.assignee} /></button>;
}
export function PointsCell({ t }: { t: Any }) {
  const v = t.storyPoints ?? null;
  if (!canEdit()) return <span className="sp" title="Story points">{v ?? '–'}</span>;
  return <button className={`sp sp-btn ${v === null ? 'none' : ''}`} title="Story point estimate" {...cellProps(`Story points of ${t.key}: ${v ?? 'none'}. Change`, 'points', t)}>{v ?? '–'}</button>;
}
export function PriorityCell({ t }: { t: Any }) {
  if (!canEdit()) return <span title={`${t.priority} priority`}><PriorityIcon p={t.priority} /></span>;
  return <button className="cell-btn" title={`${t.priority} priority`} {...cellProps(`Priority of ${t.key}: ${t.priority}. Change`, 'priority', t)}><PriorityIcon p={t.priority} /></button>;
}
export function MoreCell({ t }: { t: Any }) {
  return <button className="icon-btn row-more" title="More actions (or right-click the row)" {...cellProps(`More actions for ${t.key}`, 'more', t)}><Ico svg={I.more} /></button>;
}
/** Right-click on a row: the "…" menu at the mouse. */
export function rowContextMenu(e: RMouseEvent, t: Any) {
  if ((e.target as HTMLElement).closest('input, textarea, a')) return;
  e.preventDefault();
  openPop('more', targetIds(t.id), { x: e.clientX, y: e.clientY });
}

// ---------------------------------------------------------------- the popup
function useListKeys(n: number, pick: (i: number) => void) {
  const [active, setActive] = useState(-1);
  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % Math.max(n, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? n - 1 : a - 1)); }
    else if (e.key === 'Enter' && active >= 0 && active < n) { e.preventDefault(); pick(active); }
  };
  return { active, setActive, onKeyDown };
}

function StatusList({ ids }: { ids: string[] }) {
  const list = ids.map(ticket).filter(Boolean);
  const one = list.length === 1 ? list[0] : null;
  const names: string[] = one ? allowedStatuses(one) : statusNames();
  const pick = (n: string) => { closePop(); setStatusFor(ids, n); };
  const keys = useListKeys(names.length, (i) => pick(names[i]));
  return <div className="pop-list" role="listbox" aria-label="Status" tabIndex={-1} onKeyDown={keys.onKeyDown} ref={(el) => el?.focus({ preventScroll: true })}>
    {names.map((n, i) => {
      const blocked = !one && list.every((t: Any) => !canMove(t, n));
      return <button key={n} role="option" aria-selected={one?.status === n} className={`${i === keys.active ? 'on' : ''}`} disabled={blocked} title={blocked ? 'The workflow doesn’t allow these issues to move here' : ''} onMouseEnter={() => keys.setActive(i)} onClick={() => pick(n)}>
        <span className={`loz ${sCls(n)}`}>{n}</span>{one?.status === n && <Ico svg={I.check} className="pop-tick" />}</button>;
    })}
    {one && names.length < statusNames().length && <p className="pop-note">Only the statuses this issue can move to are shown (Project settings → Workflow).</p>}
  </div>;
}

function AssigneeList({ ids }: { ids: string[] }) {
  const [q, setQ] = useState('');
  const one = ids.length === 1 ? ticket(ids[0]) : null;
  const cur = one?.assignee || '';
  const people = peopleNames();
  const mine = S.user?.name || '';
  const qq = q.trim().toLowerCase();
  const opts: [string, string][] = [];
  if (mine && cur !== mine && (!qq || 'assign to me'.includes(qq) || mine.toLowerCase().includes(qq))) opts.push([mine, 'Assign to me']);
  if (!qq || 'unassigned'.includes(qq)) opts.push(['', 'Unassigned']);
  for (const n of people.filter((n) => !qq || n.toLowerCase().includes(qq)).sort((a, b) => a.localeCompare(b))) opts.push([n, n]);
  const pick = (v: string) => { closePop(); assignTo(ids, v); };
  const keys = useListKeys(opts.length, (i) => pick(opts[i][0]));
  useEffect(() => { keys.setActive(qq ? 0 : -1); }, [qq]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="pop-list" role="listbox" aria-label="Assignee" onKeyDown={keys.onKeyDown}>
    <input className="pop-search" autoFocus placeholder="Search people" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
    <div className="pop-scroll">
      {opts.map(([v, label], i) => <button key={`${label}|${v}`} role="option" aria-selected={one ? cur === v && label !== 'Assign to me' : false} className={i === keys.active ? 'on' : ''} onMouseEnter={() => keys.setActive(i)} onClick={() => pick(v)}>
        {label === 'Assign to me' ? <><Avatar name={mine} size={20} /><span>Assign to me</span></> : <><Avatar name={v} size={20} /><span>{label}</span></>}
        {one && cur === v && label !== 'Assign to me' && <Ico svg={I.check} className="pop-tick" />}</button>)}
      {!opts.length && <p className="pop-note">No one matches “{q}”.</p>}
    </div>
  </div>;
}

function PointsEditor({ ids }: { ids: string[] }) {
  const one = ids.length === 1 ? ticket(ids[0]) : null;
  const [v, setV] = useState(one?.storyPoints != null ? String(one.storyPoints) : '');
  // Any positive number (a free value, not a fixed scale). A text box, so a wrong entry can be shown and explained.
  const t = v.trim();
  const bad = t !== '' && !(/^\d+(\.\d+)?$/.test(t) && Number(t) > 0);
  const n = t === '' || bad ? null : Number(t);
  const save = (x: number | null) => { closePop(); setPoints(ids, x); };
  return <div className="pop-points">
    <label className="pop-h" htmlFor="pop-sp">Story point estimate{ids.length > 1 ? ` · ${plural(ids.length, 'issue')}` : ''}</label>
    <div className="row" style={{ gap: 6 }}>
      <input id="pop-sp" className="pop-input" type="text" inputMode="decimal" autoComplete="off" autoFocus value={v} placeholder="None"
        onFocus={(e) => e.target.select()} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!bad) save(n); } }} aria-invalid={bad} aria-describedby={bad ? 'pop-sp-err' : undefined} />
      <button className="btn sm primary" disabled={bad} onClick={() => save(n)}>Save</button>
    </div>
    {bad && <p id="pop-sp-err" className="pop-note err" role="alert">Enter a positive number, for example 13.</p>}
    <div className="sp-quick" role="group" aria-label="Common estimates">{POINTS.map((p) => <button key={p} className={one?.storyPoints === p ? 'on' : ''} onClick={() => save(p)}>{p}</button>)}</div>
    {(one ? one.storyPoints != null : true) && <button className="btn sm subtle" style={{ marginTop: 6 }} onClick={() => save(null)}>Clear estimate</button>}
  </div>;
}

function PriorityList({ ids }: { ids: string[] }) {
  const one = ids.length === 1 ? ticket(ids[0]) : null;
  const pick = (p: string) => { closePop(); setPriority(ids, p); };
  const keys = useListKeys(PRIORITIES.length, (i) => pick(PRIORITIES[i]));
  return <div className="pop-list" role="listbox" aria-label="Priority" tabIndex={-1} onKeyDown={keys.onKeyDown} ref={(el) => el?.focus({ preventScroll: true })}>
    {PRIORITIES.map((p, i) => <button key={p} role="option" aria-selected={one?.priority === p} className={i === keys.active ? 'on' : ''} onMouseEnter={() => keys.setActive(i)} onClick={() => pick(p)}>
      <PriorityIcon p={p} /><span>{p}</span>{one?.priority === p && <Ico svg={I.check} className="pop-tick" />}</button>)}
  </div>;
}

function EpicList({ ids }: { ids: string[] }) {
  const one = ids.length === 1 ? ticket(ids[0]) : null;
  const [q, setQ] = useState('');
  const qq = q.trim().toLowerCase();
  const list = P().epics.filter((e: Any) => !qq || `${e.key} ${e.title}`.toLowerCase().includes(qq));
  const pick = (id: string | null) => { closePop(); setEpic(ids, id); };
  return <div className="pop-list" role="listbox" aria-label="Epic">
    {P().epics.length > 8 && <input className="pop-search" autoFocus placeholder="Search epics" aria-label="Search epics" value={q} onChange={(e) => setQ(e.target.value)} />}
    <div className="pop-scroll">
      {list.map((e: Any) => <button key={e.id} role="option" aria-selected={one?.epicId === e.id} onClick={() => pick(e.id)}><Swatch color={e.color} /><span>{e.title}</span>{one?.epicId === e.id && <Ico svg={I.check} className="pop-tick" />}</button>)}
      <button role="option" aria-selected={one ? !epic(one.epicId) : false} onClick={() => pick(null)}><span className="muted">No epic</span></button>
    </div>
  </div>;
}

/** Fix versions: tick to add, untick to remove (for several issues: added to or removed from all of them). */
function VersionList({ ids }: { ids: string[] }) {
  const list = ids.map(ticket).filter((t: Any) => t && !isSub(t));
  const rel = releases().filter((r: Any) => r.status !== 'archived');
  const has = (rid: string) => list.length > 0 && list.every((t: Any) => (t.fixVersions || []).includes(rid));
  const toggle = (rid: string) => {
    const on = !has(rid);
    const name = release(rid)?.name;
    mutate(() => list.forEach((t: Any) => {
      const cur = t.fixVersions || [];
      const next = on ? [...new Set([...cur, rid])] : cur.filter((v: string) => v !== rid);
      if (JSON.stringify(next) !== JSON.stringify(cur)) setField(t, 'fixVersions', next);
    }));
    if (list.length > 1) toast(`${plural(list.length, 'issue')} ${on ? `added to ${name}` : `removed from ${name}`}`, 'ok', { action: { label: 'Undo', onClick: undo } });
  };
  return <div className="pop-list" role="listbox" aria-label="Fix versions" aria-multiselectable>
    <div className="pop-h">Fix versions</div>
    {rel.length ? rel.map((r: Any) => <button key={r.id} role="option" aria-selected={has(r.id)} onClick={() => toggle(r.id)}>
      <span className="radio-box">{has(r.id) && <Ico svg={I.check} />}</span><span>{r.name}</span>{r.status === 'released' && <small>Released</small>}</button>)
      : <p className="pop-note">No versions yet. Create one on the Releases page.</p>}
  </div>;
}

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
  const act = (fn: () => void) => () => { closePop(); fn(); };
  return <div className="pop-menu" role="menu">
    {!one && <div className="mh">{plural(list.length, 'issue')} selected</div>}
    {canSprint() && !subs && <>
      <div className="mh">Move to</div>
      <button role="menuitem" onClick={act(() => moveTo(ids, null, 'top'))}><Ico svg={I.up} />Top of backlog</button>
      <button role="menuitem" onClick={act(() => moveTo(ids, null, 'bottom'))}><Ico svg={I.down} />Bottom of backlog</button>
      {open.filter((s: Any) => !one || one.sprintId !== s.id).map((s: Any) => <button key={s.id} role="menuitem" onClick={act(() => moveTo(ids, s.id, 'bottom'))}><Ico svg={I.calendar} />{s.name}{s.state === 'active' && <small>Active</small>}</button>)}
      {one && openIds.has(one.sprintId) && <button role="menuitem" onClick={act(() => moveTo(ids, open.find((s: Any) => s.id === one.sprintId).id, 'top'))}><Ico svg={I.up} />Top of {open.find((s: Any) => s.id === one.sprintId).name}</button>}
      <hr />
    </>}
    {edit && <>
      {mine && !(one && one.assignee === mine) && <button role="menuitem" onClick={act(() => assignTo(ids, mine))}><Ico svg={I.user} />Assign to me</button>}
      {list.some((t: Any) => t.assignee) && <button role="menuitem" onClick={act(() => assignTo(ids, ''))}><Ico svg={I.close} />Unassign</button>}
      <button role="menuitem" onClick={() => swapPop('assignee')}><Ico svg={I.people} />Assign to…</button>
      <button role="menuitem" onClick={() => swapPop('status')}><Ico svg={I.board} />Change status…</button>
      <button role="menuitem" onClick={() => swapPop('points')}><span className="mi-sp">#</span>Story points…{one?.storyPoints != null && <small>{one.storyPoints}</small>}</button>
      <button role="menuitem" onClick={() => swapPop('priority')}><PriorityIcon p={one?.priority || 'Medium'} />Priority…{one && <small>{one.priority}</small>}</button>
      {(can('epic.manage') || edit) && !subs && P().epics.length > 0 && <button role="menuitem" onClick={() => swapPop('epic')}><Ico svg={I.epic} />Change epic…{one && epic(one.epicId) && <small>{epic(one.epicId).title}</small>}</button>}
      {!subs && (can('sprint.manage') || edit) && releases().some((r: Any) => r.status !== 'archived') && <button role="menuitem" onClick={() => swapPop('version')}><Ico svg={I.calendar} />Fix version…{one && (one.fixVersions || []).length > 0 && <small>{(one.fixVersions || []).map((v: string) => release(v)?.name).filter(Boolean).join(', ')}</small>}</button>}
      <button role="menuitem" onClick={act(() => setFlag(ids, !allFlagged))}><Ico svg={I.flag} />{allFlagged ? 'Remove flag' : 'Add flag'}</button>
      <hr />
    </>}
    {one && <>
      <button role="menuitem" onClick={act(() => openDrawer('issue', one.id))}><Ico svg={I.expand} />Open {one.key}</button>
      <button role="menuitem" onClick={act(() => copyText(issueLink(one)))}><Ico svg={I.link} />Copy issue link</button>
      <button role="menuitem" onClick={act(() => copyText(one.key))}><Ico svg={I.copy} />Copy issue key</button>
      {can('issue.create') && <button role="menuitem" onClick={act(() => duplicateIssue(one))}><Ico svg={I.copy} />Duplicate</button>}
    </>}
    {!one && <button role="menuitem" onClick={act(() => copyText(list.map((t: Any) => t.key).join(', ')))}><Ico svg={I.copy} />Copy issue keys</button>}
    {can('issue.delete') && <><hr /><button role="menuitem" className="danger" onClick={act(() => confirmDelete(ids))}><Ico svg={I.trash} />Delete{!one ? ` ${plural(list.length, 'issue')}` : ''}</button></>}
  </div>;
}

/** The one popup for row actions. Render it once on a page that shows issue rows. */
export function RowPop() {
  const pop: Pop | null = S.pop;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!pop || !ref.current) { setPos(null); return; }
    const r = ref.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(pop.x, vw - r.width - 8));
    const below = pop.y + r.height <= vh - 8;
    const top = below ? pop.y : Math.max(8, pop.bottom - r.height);
    setPos({ left, top });
  }, [pop?.at, pop?.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pop) return undefined;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) closePop(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } };
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) closePop(); };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', closePop);
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key, true); window.removeEventListener('scroll', away, true); window.removeEventListener('resize', closePop); };
  }, [pop?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pop || !P()) return null;
  const ids = pop.ids.filter((id) => ticket(id));
  if (!ids.length) return null;
  const Body = { status: StatusList, assignee: AssigneeList, points: PointsEditor, priority: PriorityList, epic: EpicList, version: VersionList, more: MoreMenu }[pop.kind];
  return <div ref={ref} className={`row-pop pop-${pop.kind}`} role="dialog" aria-label={pop.kind === 'more' ? 'Issue actions' : `Change ${pop.kind}`}
    style={{ left: pos?.left ?? pop.x, top: pos?.top ?? pop.y, opacity: pos ? 1 : 0 }} onClick={stop} onContextMenu={(e) => e.preventDefault()}>
    {ids.length > 1 && pop.kind !== 'more' && pop.kind !== 'points' && <div className="pop-h">{plural(ids.length, 'issue')} selected</div>}
    <Body key={`${pop.kind}${pop.at}`} ids={ids} />
  </div>;
}

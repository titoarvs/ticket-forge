'use client';
// Board (Jira-style): one column per workflow status, with sticky column headers, column limits, collapsible
// columns, swimlanes by epic or assignee, and quick create. On narrow screens the columns scroll sideways and
// snap one at a time. With custom transitions, columns an issue can't move to are greyed out while dragging.
import { memo, useState } from 'react';
import Link from 'next/link';
import {
  S, emit, P, epic, isSub, ticket, isBlocked, activeSprint, catOf, wCls, statusColor, statusOf, isDone, can, filtered, filtersActive, saveUi, mutate,
  newTicket, toast, openModal, EMPTY_FILTER, type Any,
} from './core';
import { Ico, I, TypeIcon, PriorityIcon, Avatar, ELoz, EmptyState } from './ui';
import { openDrawer, CompleteSprintModal } from './actions';
import { SF, MenuItem } from './fields';
import { Header, FilterBar, daysLeft, rowDnd, zoneDnd } from './views';

const COLLAPSED_W = 44;

const PRIORITY_TAG: Record<string, [string, string]> = { Highest: ['Urgent', 'pt-urgent'], High: ['High priority', 'pt-high'], Medium: ['Medium', 'pt-medium'], Low: ['Low priority', 'pt-low'] };
const CAT_COLOR: Record<string, string> = { todo: 'var(--text-subtlest)', inprogress: 'var(--brand)', done: '#22c55e' };

/** One issue card. Memoised: only re-renders when the issue (or its selection, sub-tasks or comments) changes. */
const Card = memo(function Card({ t, showEpic, zoneKey, active, v, kidsDone, kids }: { t: Any; showEpic: boolean; zoneKey: string; active: boolean; v: string; kidsDone: number; kids: number }) {
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
    <div className={`bcard ${active ? 'active' : ''} ${done ? 'is-done' : ''}`} style={{ ['--pc' as string]: color }} role="button" tabIndex={0} aria-label={`${t.key} ${t.title}`}
      onClick={() => openDrawer('issue', t.id)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDrawer('issue', t.id); } }} {...rowDnd(t, zone)}>
      <div className="bcard-tags">
        {pt && <span className={`ptag ${pt[1]}`}>{pt[0]}</span>}
        {e && <ELoz e={e} />}
        {t.labels?.slice(0, 2).map((l: string) => <span key={l} className="label-chip">{l}</span>)}
        {isBlocked(t) && <span className="ptag pt-blocked" title="Blocked by an open issue"><Ico svg={I.flag} />Blocked</span>}
      </div>
      {parent && <div className="muted small bcard-parent"><TypeIcon type={parent.type} /> {parent.key} {parent.title}</div>}
      <div className="t">{t.title}</div>
      {kids > 0 && <div className="bcard-prog" title={`${kidsDone} of ${kids} sub-tasks done`}>
        <div className="bcard-prog-h"><span>Progress</span><b>{pct === 100 ? 'Done' : `${pct}%`}</b></div>
        <div className="bcard-bar"><i style={{ width: `${Math.max(pct, 2)}%` }} /></div>
      </div>}
      <div className="foot">
        <Avatar name={t.assignee} />
        <TypeIcon type={t.type} /><span className={`key ${done ? 'done' : ''}`}>{t.key}</span>
        <span className="right">
          {t.prs.length > 0 && <span className="mini" title={`${t.prs.length} pull request${t.prs.length > 1 ? 's' : ''}`}><Ico svg={I.pr} />{t.prs.length}</span>}
          {t.comments?.length > 0 && <span className="mini" title={`${t.comments.length} comment${t.comments.length > 1 ? 's' : ''}`}><Ico svg={I.comment} />{t.comments.length}</span>}
          {tests > 0 && <span className="mini" title={`${passing} of ${tests} test cases passing`}><Ico svg={I.check} />{passing}/{tests}</span>}
          {t.storyPoints != null && <span className="sp" title="Story points">{t.storyPoints}</span>}
          <PriorityIcon p={t.priority} />
        </span>
      </div>
    </div>
  );
});

/** "+ Create issue" at the bottom of a column: type a summary, Enter to add it in that status (and lane).
 *  The "+" in a column header opens the one in the first open lane (S.boardCreate holds its id). */
function QuickCreate({ id, status, fields }: { id: string; status: string; fields: Any }) {
  const [local, setLocal] = useState(false);
  const [title, setTitle] = useState('');
  const open = local || S.boardCreate === id;
  const setOpen = (v: boolean) => { setLocal(v); if (!v && S.boardCreate === id) { S.boardCreate = null; emit(); } };
  const create = () => {
    if (!title.trim()) { setOpen(false); return; }
    const nt = newTicket({ title: title.trim(), type: 'Story', status, ...fields });
    mutate((p) => p.tickets.push(nt));
    toast(`Created ${nt.key}`);
    setTitle('');
  };
  if (!open) return <button className="bcreate" onClick={() => setOpen(true)}><Ico svg={I.plus} />Create issue</button>;
  return <textarea className="bcreate-input" autoFocus rows={2} value={title} placeholder="What needs to be done?" aria-label={`New issue in ${status}`}
    onChange={(e) => setTitle(e.target.value)} onBlur={() => { if (!title.trim()) setOpen(false); }}
    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); create(); } if (e.key === 'Escape') { setTitle(''); setOpen(false); } }} />;
}

export function Board() {
  const p = P();
  const act = activeSprint();
  const useSprint = act && !S.boardAll;
  const wf: Any[] = p.workflow;
  const list = filtered(useSprint ? p.tickets.filter((t: Any) => t.sprintId === act.id) : p.tickets);
  const collapsed: Set<string> = S.boardCollapsed;
  const toggleCol = (id: string) => { if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); saveUi(); emit(); };
  const createOk = can('issue.create');
  const group = S.boardGroup;

  // Column widths: collapsed columns are a narrow strip. Phones get one column at a time (see CSS).
  const cols = wf.map((w) => (collapsed.has(w.id) ? `${COLLAPSED_W}px` : 'minmax(264px, 1fr)')).join(' ');
  const colsSm = wf.map((w) => (collapsed.has(w.id) ? `${COLLAPSED_W}px` : 'min(84vw, 320px)')).join(' ');

  const byStatus = (items: Any[]) => { const m = new Map<string, Any[]>(wf.map((w) => [w.name, []])); for (const t of items) m.get(t.status)?.push(t); return m; };
  const all = byStatus(list);
  // Sub-task progress per issue, counted once per render rather than per card.
  const kidCount = new Map<string, [number, number]>();
  for (const k of p.tickets) if (k.parentId) { const c = kidCount.get(k.parentId) || [0, 0]; c[1]++; if (isDone(k)) c[0]++; kidCount.set(k.parentId, c); }

  // Swimlanes.
  type Lane = { id: string; title: React.ReactNode; items: Any[]; zone: Any; fields: Any };
  let lanes: Lane[];
  if (group === 'epic') {
    lanes = [...p.epics.map((e: Any) => ({ id: `e:${e.id}`, title: <><TypeIcon type="Epic" /><span className="key">{e.key}</span> {e.title}</>, items: list.filter((t: Any) => t.epicId === e.id), zone: { epic: e.id }, fields: { epicId: e.id } })),
      { id: 'e:none', title: 'Issues without epic', items: list.filter((t: Any) => !epic(t.epicId)), zone: { epic: null }, fields: {} }];
  } else if (group === 'assignee') {
    const names = [...new Set(list.map((t: Any) => t.assignee).filter(Boolean))].sort() as string[];
    lanes = [...names.map((n) => ({ id: `a:${n}`, title: <><Avatar name={n} /> {n}</>, items: list.filter((t: Any) => t.assignee === n), zone: { assignee: n }, fields: { assignee: n } })),
      { id: 'a:none', title: <><Avatar name="" /> Unassigned</>, items: list.filter((t: Any) => !t.assignee), zone: { assignee: null }, fields: {} }];
  } else lanes = [{ id: 'all', title: null, items: list, zone: {}, fields: {} }];
  lanes = lanes.filter((l) => l.items.length || l.id === 'all');
  const sprintFields = useSprint ? { sprintId: act.id } : {};

  const left = useSprint ? daysLeft(act) : null;
  const noSprint = p.sprints.length > 0 && !act && !S.boardAll;
  const openCreate = (w: Any) => { const l = lanes.find((x) => !S.collapsed.has(`lane:${x.id}`)); if (l) { S.boardCreate = `${l.id}|${w.id}`; emit(); } };
  const allCollapsed = lanes.length > 1 && lanes.every((l) => S.collapsed.has(`lane:${l.id}`));

  return <>
    <Header title={useSprint ? act.name : 'Board'} right={<>
      {p.sprints.length > 0 && <SF filter aria-label="Board scope" value={S.boardAll ? 'all' : 'sprint'} onChange={(e) => { S.boardAll = e.target.value === 'all'; emit(); }}><MenuItem value="sprint">Active sprint</MenuItem><MenuItem value="all">All issues</MenuItem></SF>}
      {useSprint && <><span className="muted small row" style={{ gap: 4 }}><Ico svg={I.clock} />{left === null ? 'No end date' : left >= 0 ? `${left} days remaining` : `${-left} days overdue`}</span>
        {can('sprint.manage') && <button className="btn" onClick={() => openModal(<CompleteSprintModal s={act} />)}>Complete sprint</button>}</>}
    </>} />
    {useSprint && act.goal && <p className="muted board-goal"><Ico svg={I.flag} /> {act.goal}</p>}
    {noSprint ? (
      <EmptyState icon={I.board} title="No active sprint"
        actions={<><Link className="btn primary" href={`/p/${p.id}/backlog`}>Go to backlog</Link><button className="btn" onClick={() => { S.boardAll = true; emit(); }}>Show all issues</button></>}>
        <p>Start a sprint from the backlog to track its issues here, or show every issue on the board.</p></EmptyState>
    ) : <>
      <FilterBar status={false} group={{ value: group, options: [['none', 'None'], ['epic', 'Epic'], ['assignee', 'Assignee']], onChange: (v) => { S.boardGroup = v; saveUi(); emit(); } }} />
      {lanes.length > 1 && <button className="btn subtle sm board-lanes-toggle" onClick={() => { lanes.forEach((l) => (allCollapsed ? S.collapsed.delete(`lane:${l.id}`) : S.collapsed.add(`lane:${l.id}`))); saveUi(); emit(); }}>
        <Ico svg={allCollapsed ? I.expand : I.collapse} />{allCollapsed ? 'Expand all lanes' : 'Collapse all lanes'}</button>}
      <div className="board-wrap" tabIndex={-1}>
        <div className="board" style={{ ['--cols' as string]: cols, ['--cols-sm' as string]: colsSm }}>
          {/* Column headers (sticky) */}
          {wf.map((w) => {
            const n = all.get(w.name)!.length;
            const over = w.wip && n > w.wip;
            const c = collapsed.has(w.id);
            return <div key={`h-${w.id}`} className={`bcol-h ${c ? 'collapsed' : ''} ${over ? 'over' : ''}`} data-drop-status={w.name} {...zoneDnd({ status: w.name })}>
              {c ? <button className="bcol-strip" onClick={() => toggleCol(w.id)} title={`Expand ${w.name}`} aria-label={`Expand column ${w.name} (${n} issues)`}>
                <span className={`bcol-n ${over ? 'over' : ''}`}>{n}</span></button> : <>
                <span className={`dot-cat ${wCls(w)}`} /><span className="bcol-name" title={w.name}>{w.name}</span>
                <span className={`bcol-count ${over ? 'over' : ''}`} title={w.wip ? `${n} issues · column limit ${w.wip}` : `${n} issues`}>({n}{w.wip ? <span className="muted"> / {w.wip}</span> : null})</span>
                {w.category === 'done' && <Ico svg={I.check} className="bcol-done" />}
                <button className="icon-btn bcol-collapse" onClick={() => toggleCol(w.id)} title="Collapse column" aria-label={`Collapse column ${w.name}`}><Ico svg={I.chevron} /></button>
                {createOk && lanes.some((l) => !S.collapsed.has(`lane:${l.id}`)) && <button className="icon-btn bcol-add" title={`Create issue in ${w.name}`} aria-label={`Create issue in ${w.name}`}
                  onClick={() => openCreate(w)}><Ico svg={I.plus} /></button>}</>}
            </div>;
          })}

          {lanes.map((l, li) => {
            const closed = S.collapsed.has(`lane:${l.id}`);
            const m = byStatus(l.items);
            return [
              l.title && <div key={`lh-${l.id}`} className={`lane-h ${closed ? 'closed' : ''}`}>
                <button className="lane-toggle" aria-expanded={!closed} onClick={() => { if (closed) S.collapsed.delete(`lane:${l.id}`); else S.collapsed.add(`lane:${l.id}`); saveUi(); emit(); }}>
                  <Ico svg={I.chevron} />{l.title}<span className="muted small">{l.items.length} issue{l.items.length === 1 ? '' : 's'}</span></button></div>,
              ...(closed ? [] : wf.map((w, wi) => {
                const zone = { status: w.name, ...l.zone };
                const items = m.get(w.name)!;
                const c = collapsed.has(w.id);
                const zk = JSON.stringify(zone);
                return <div key={`${l.id}-${w.id}`} className={`bcol ${c ? 'collapsed' : ''} ${wi === 0 ? 'first' : ''} ${li === lanes.length - 1 ? 'last' : ''}`} data-drop-status={w.name} {...zoneDnd(zone)}>
                  {c && <button className="bcol-strip body" onClick={() => toggleCol(w.id)} title={`Expand ${w.name}`} aria-label={`Expand column ${w.name}`}>
                    <span className="bcol-vname">{w.name}</span>{items.length > 0 && <span className="bcol-n">{items.length}</span>}</button>}
                  {!c && items.map((t: Any) => <Card key={t.id} t={t} kidsDone={kidCount.get(t.id)?.[0] || 0} kids={kidCount.get(t.id)?.[1] || 0} showEpic={group !== 'epic'} zoneKey={zk} active={S.drawer?.id === t.id} v={`${t.updatedAt}|${t.status}|${t.title}|${t.assignee}|${t.storyPoints}|${t.priority}|${t.epicId}|${t.prs.length}|${(t.links || []).length}|${(t.labels || []).join()}|${(t.comments || []).length}|${(t.testCases || []).map((x: Any) => x.status).join()}`} />)}
                  {!c && createOk && <QuickCreate id={`${l.id}|${w.id}`} status={w.name} fields={{ ...sprintFields, ...l.fields }} />}
                </div>;
              })),
            ];
          })}
        </div>
      </div>
      {!list.length && (filtersActive()
        ? <EmptyState compact icon={I.search} tone="neutral" title="No issues match your filters" actions={<button className="btn" onClick={() => { S.filter = EMPTY_FILTER(); emit(); }}>Clear filters</button>} />
        : <EmptyState compact icon={I.board} tone="neutral" title={useSprint ? 'No issues in this sprint yet' : 'No issues yet'}
          actions={<Link className="btn" href={`/p/${p.id}/backlog`}>Go to backlog</Link>}><p>{useSprint ? 'Drag issues into the sprint from the backlog, or create one in a column.' : 'Create issues in the backlog or in a column to see them here.'}</p></EmptyState>)}
    </>}
  </>;
}

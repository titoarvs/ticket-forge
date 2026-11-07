'use client';
// Project views: Summary, Backlog, Board, Epics, Reports, Test cases, Test automation, Source, Settings.
import { useState, type DragEvent, type ReactNode } from 'react';
import Link from 'next/link';
import {
  S, emit, P, ago, fmtDate, TYPES, PRIORITIES, TC_TYPES, TC_STATUS, CATEGORIES, epic, sprint, isSub, childrenOf, epicTickets, noEpic,
  activeSprint, openSprints, tcKey, spSum, statusNames, catOf, isDone, tCls, filtered, filtersActive, can, peopleNames, ticket, isBlocked,
  saveUi, EMPTY_FILTER, mutate, setField, deleteIssues, historyText, openModal, toast, uid, logEvent, api, type Any,
} from './core';
import { Ico, I, TypeIcon, PriorityIcon, Avatar, ELoz, StatusLoz, Swatch, Confirm, Spinner, AutoTextarea } from './ui';
import {
  openDrawer, moveTicket, inlineCreate, createSprint, deleteSprint, SprintModal, CompleteSprintModal, NewWithClaudeModal, RegroupModal,
  addEpic, bulkTests, runTests, installBrowser, ScriptModal,
} from './actions';
import { TF, TA, SF, CB, RB, DateF, PeopleF, MenuItem, opts } from './fields';

// ---------------------------------------------------------------- drag & drop
let dragId: string | null = null;
const clearDrop = () => document.querySelectorAll('.drop, .drop-before').forEach((n) => n.classList.remove('drop', 'drop-before'));
const canDrag = () => can('issue.edit') || can('sprint.manage') || can('epic.manage');
function rowDnd(t: Any, zone: Any) {
  if (!canDrag()) return {};
  return {
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => { dragId = t.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); e.currentTarget.classList.add('dragging'); },
    onDragEnd: (e: DragEvent<HTMLElement>) => { dragId = null; e.currentTarget.classList.remove('dragging'); clearDrop(); },
    onDragOver: (e: DragEvent<HTMLElement>) => { if (dragId && dragId !== t.id) { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('drop-before'); } },
    onDragLeave: (e: DragEvent<HTMLElement>) => e.currentTarget.classList.remove('drop-before'),
    onDrop: (e: DragEvent<HTMLElement>) => { e.preventDefault(); e.stopPropagation(); clearDrop(); if (dragId) moveTicket(dragId, zone, t.id); },
  };
}
function zoneDnd(zone: Any) {
  return {
    onDragOver: (e: DragEvent<HTMLElement>) => { if (dragId) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
    onDragLeave: (e: DragEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) e.currentTarget.classList.remove('drop'); },
    onDrop: (e: DragEvent<HTMLElement>) => { e.preventDefault(); clearDrop(); if (dragId) moveTicket(dragId, zone); },
  };
}

// ---------------------------------------------------------------- shared pieces
export function Header({ title, right, sub }: { title: string; right?: ReactNode; sub?: ReactNode }) {
  return <>
    <div className="crumbs"><Link href="/">Projects</Link><span>/</span><Link href={`/p/${P().id}/summary`}>{P().name}</Link></div>
    <div className="page-h"><h1>{title}</h1>{sub}<div className="spacer" />{right}</div>
  </>;
}
function FilterBar({ status = true, group }: { status?: boolean; group?: { value: string; options: [string, string][]; onChange: (v: string) => void } }) {
  const f = S.filter;
  const setF = (k: string, v: string) => { S.filter = { ...S.filter, [k]: v }; emit(); };
  const people = peopleNames();
  return (
    <div className="toolbar">
      <TF search sx={{ width: 220 }} id="fq" placeholder="Search issues" value={f.q} onChange={(e) => setF('q', e.target.value)} />
      {people.length > 0 && <div className="avatars" role="group" aria-label="Filter by assignee">{people.slice(0, 6).map((n) => (
        <button key={n} className={`av-btn ${f.assignee === n ? 'on' : ''}`} title={n} onClick={() => setF('assignee', f.assignee === n ? '' : n)}><Avatar name={n} size={28} /></button>))}</div>}
      <SF filter aria-label="Epic" value={f.epic} onChange={(e) => setF('epic', e.target.value)}><MenuItem value="">Epic</MenuItem>{P().epics.map((e: Any) => <MenuItem key={e.id} value={e.id}>{e.title}</MenuItem>)}<MenuItem value="none">No epic</MenuItem></SF>
      <SF filter aria-label="Type" value={f.type} onChange={(e) => setF('type', e.target.value)}><MenuItem value="">Type</MenuItem>{opts([...TYPES, 'Sub-task'])}</SF>
      <SF filter aria-label="Priority" value={f.priority} onChange={(e) => setF('priority', e.target.value)}><MenuItem value="">Priority</MenuItem>{opts(PRIORITIES)}</SF>
      {status && <SF filter aria-label="Status" value={f.status} onChange={(e) => setF('status', e.target.value)}><MenuItem value="">Status</MenuItem>{opts(statusNames())}</SF>}
      {filtersActive() && <button className="btn subtle" onClick={() => { S.filter = EMPTY_FILTER(); emit(); }}>Clear filters</button>}
      <div className="spacer" />
      {group && <><span className="muted small">Group by</span><SF filter value={group.value} onChange={(e) => group.onChange(e.target.value)}>{group.options.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}</SF></>}
    </div>
  );
}
export function epicProgress(e: Any) {
  const ts = epicTickets(e.id);
  const c = (cat: string) => ts.filter((t: Any) => catOf(t.status) === cat).length;
  return { ts, done: c('done'), prog: c('inprogress'), total: ts.length };
}
export function ProgBar({ done, prog, total }: { done: number; prog: number; total: number }) {
  const w = (v: number) => `${total ? (v / total) * 100 : 0}%`;
  return <div className="prog" title={`${done} done · ${prog} in progress · ${total - done - prog} to do`}>{done > 0 && <i className="p-done" style={{ width: w(done) }} />}{prog > 0 && <i className="p-prog" style={{ width: w(prog) }} />}</div>;
}
const Tally = ({ items }: { items: Any[] }) => {
  const c = (cat: string) => items.filter((t) => catOf(t.status) === cat).length;
  return <span className="tally" title="To do · In progress · Done"><span className="loz s-todo">{c('todo')}</span><span className="loz s-inprogress">{c('inprogress')}</span><span className="loz s-done">{c('done')}</span></span>;
};
const daysLeft = (s: Any) => {
  if (!s?.endDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${s.endDate}T00:00:00`).getTime() - today.getTime()) / 86400000);
};
const PlainList = ({ l }: { l: string[] }) => (l?.length ? <ul className="plain-list">{l.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="muted">None.</p>);

// ---------------------------------------------------------------- summary
function Stack({ parts, total }: { parts: [string, number, string][]; total: number }) {
  return <>
    <div className="stack" role="img" aria-label={parts.map(([l, v]) => `${l}: ${v}`).join(', ')}>{parts.filter(([, v]) => v).map(([l, v, c]) => <i key={l} className={c} style={{ width: `${(v / total) * 100}%` }} title={`${l}: ${v} (${Math.round((v / total) * 100)}%)`} />)}</div>
    <div className="legend">{parts.map(([l, v, c]) => <span key={l}><i className={c} />{l} <b>{v}</b></span>)}</div>
  </>;
}
const Tile = ({ icon, value, label, color }: { icon: string; value: ReactNode; label: ReactNode; color?: string }) => <div className="tile"><span className="ic" style={{ color }}><Ico svg={icon} /></span><div><b>{value}</b><span>{label}</span></div></div>;

export function Summary() {
  const p = P();
  const ts = p.tickets.filter((t: Any) => !isSub(t));
  const n = ts.length || 1;
  const by = (k: string, v: string) => ts.filter((t: Any) => t[k] === v).length;
  const cat = (c: string) => ts.filter((t: Any) => catOf(t.status) === c).length;
  const done = cat('done');
  const tcs = p.tickets.flatMap((t: Any) => t.testCases);
  const tcBy = (s: string) => tcs.filter((x: Any) => x.status === s).length;
  const act = activeSprint();
  const maxP = Math.max(1, ...PRIORITIES.map((x) => by('priority', x)));
  const recent = p.tickets.flatMap((t: Any) => t.history.map((h: Any) => ({ ...h, t }))).sort((a: Any, b: Any) => b.at.localeCompare(a.at)).slice(0, 8);
  return <>
    <Header title="Summary" />
    <div className="tiles">
      <Tile icon={I.backlog} value={ts.length} label={`issues in ${p.epics.length} epics`} />
      <Tile icon={I.check} value={<>{done} <span className="muted small">({Math.round((done / n) * 100)}%)</span></>} label="issues done" />
      <Tile icon={I.calendar} value={act ? act.name : 'No active sprint'} label={act ? `${Math.max(0, daysLeft(act) ?? 0)} days left · ${act.goal || 'no goal'}` : `${p.sprints.length} sprints planned`} />
      <Tile icon={I.test} value={`${tcBy('Pass')} / ${tcs.length}`} label={`tests passing · ${tcs.filter((x: Any) => x.script).length} automated`} />
    </div>
    <div className="cards">
      <div className="card"><h3>Status overview</h3><p className="sub">Issues by workflow category · {spSum(ts.filter(isDone))} of {spSum(ts)} story points done.</p>
        {ts.length ? <Stack total={ts.length} parts={[['To do', cat('todo'), 'c-todo'], ['In progress', cat('inprogress'), 'c-prog'], ['Done', done, 'c-done']]} /> : <p className="muted">No issues yet.</p>}</div>
      <div className="card"><h3>Test results</h3><p className="sub">Latest result of every test case (manual or automated).</p>
        {tcs.length ? <Stack total={tcs.length} parts={[['Not run', tcBy('Not run'), 'c-todo'], ['Pass', tcBy('Pass'), 'c-done'], ['Fail', tcBy('Fail'), 'c-fail'], ['Blocked', tcBy('Blocked'), 'c-blocked']]} /> : <p className="muted">No test cases yet.</p>}</div>
      <div className="card"><h3>Priority breakdown</h3><p className="sub">How many issues sit at each priority.</p>
        {PRIORITIES.map((x) => <div key={x} className="barrow" title={`${x}: ${by('priority', x)}`}><span className="lbl"><PriorityIcon p={x} />{x}</span><div className="bar"><i style={{ width: `${(by('priority', x) / maxP) * 100}%` }} /></div><span className="num">{by('priority', x)}</span></div>)}</div>
      <div className="card"><h3>Recent activity</h3><p className="sub">Latest changes across the project.</p>
        {recent.length ? recent.map((h: Any) => (
          <div key={`${h.t.id}-${h.id}`} className="act-mini" onClick={() => openDrawer('issue', h.t.id)}><Avatar name={h.author} size={20} /><span><b>{h.author}</b> {historyText(h)} <span className="key">{h.t.key}</span> <span className="muted small">{ago(h.at)}</span></span></div>
        )) : <p className="muted">No activity yet.</p>}</div>
      <div className="card wide"><h3>Epic progress</h3><p className="sub">Done and in-progress issues per epic.</p>
        {p.epics.length ? <table className="tbl"><tbody>{p.epics.map((e: Any) => { const pr = epicProgress(e); return (
          <tr key={e.id} className="click" onClick={() => openDrawer('epic', e.id)}><td style={{ width: '40%' }}><ELoz e={e} /></td><td><ProgBar {...pr} /></td><td className="num muted" style={{ width: 110 }}>{pr.done} of {pr.total} done</td></tr>); })}</tbody></table> : <p className="muted">No epics yet.</p>}</div>
      <div className="card wide"><h3>About this project</h3><p className="sub">From the source document{p.sourceName ? ` · ${p.sourceName}` : ''} · <Link href={`/p/${p.id}/settings`}>Edit</Link></p>
        <p style={{ margin: '0 0 16px', whiteSpace: 'pre-wrap' }}>{p.summary || <span className="muted">No summary.</span>}</p>
        <div className="grid2"><div><h3 style={{ fontSize: 14 }}>Assumptions</h3><PlainList l={p.assumptions} /></div><div><h3 style={{ fontSize: 14 }}>Open questions</h3><PlainList l={p.openQuestions} /></div></div></div>
    </div>
  </>;
}

// ---------------------------------------------------------------- backlog
function backlogGroups() {
  const p = P();
  const list = filtered(p.tickets).filter((t: Any) => !isSub(t) || S.filter.type === 'Sub-task');
  if (S.groupBy === 'status') return statusNames().map((s) => ({ id: `s:${s}`, kind: 'status', title: s, items: list.filter((t: Any) => t.status === s) }));
  if (S.groupBy === 'none') return [{ id: 'all', kind: 'none', title: 'All issues', items: list }];
  if (S.groupBy === 'epic') {
    const groups: Any[] = p.epics.map((e: Any) => ({ id: `e:${e.id}`, kind: 'epic', epic: e, title: e.title, items: list.filter((t: Any) => t.epicId === e.id) }));
    groups.push({ id: 'e:none', kind: 'epic', title: 'Issues without epic', items: list.filter((t: Any) => !epic(t.epicId)) });
    return groups.filter((g) => g.items.length || (!filtersActive() && g.epic));
  }
  const sp = [...openSprints()].sort((a: Any, b: Any) => (a.state === 'active' ? -1 : b.state === 'active' ? 1 : 0));
  const inOpen = (t: Any) => sp.some((s: Any) => s.id === t.sprintId);
  const groups: Any[] = sp.map((s: Any) => ({ id: `sp:${s.id}`, kind: 'sprint', sprint: s, title: s.name, items: list.filter((t: Any) => t.sprintId === s.id) }));
  groups.push({ id: 'sp:none', kind: 'sprint', title: 'Backlog', items: list.filter((t: Any) => !inOpen(t) && !(sprint(t.sprintId)?.state === 'closed' && isDone(t))) });
  return groups;
}
const showChecks = () => can('issue.edit') || can('issue.delete') || can('sprint.manage') || can('test.run');

export function IssueRow({ t, showEpic = true, zone, compact = false }: { t: Any; showEpic?: boolean; zone?: Any; compact?: boolean }) {
  const e = epic(t.epicId);
  const kids = isSub(t) ? [] : childrenOf(t);
  const active = S.drawer?.kind === 'issue' && S.drawer.id === t.id;
  return (
    <div className={`irow ${active ? 'active' : ''}`} onClick={() => openDrawer('issue', t.id)} {...(zone && !compact ? rowDnd(t, zone) : {})}>
      {!compact && showChecks() && <CB aria-label={`Select ${t.key}`} checked={S.checked.has(t.id)} onClick={(ev) => ev.stopPropagation()}
        onChange={(ev) => { if (ev.target.checked) S.checked.add(t.id); else S.checked.delete(t.id); emit(); }} />}
      <TypeIcon type={t.type} /><span className="key">{t.key}</span>
      <span className="sum" title={t.title}>{t.title}</span>
      <span className="right">
        {isBlocked(t) && <span className="flag" title="Blocked by an open issue"><Ico svg={I.flag} />Blocked</span>}
        {!compact && <span className="lbls">{t.labels.slice(0, 2).map((l: string) => <span key={l} className="label-chip">{l}</span>)}</span>}
        {kids.length > 0 && <span className="mini" title={`${kids.filter(isDone).length} of ${kids.length} sub-tasks done`}><Ico svg={I.subtask} />{kids.filter(isDone).length}/{kids.length}</span>}
        {t.prs.length > 0 && <span className="mini" title={`${t.prs.length} pull request(s)`}><Ico svg={I.pr} />{t.prs.length}</span>}
        {showEpic && e && <ELoz e={e} />}
        <StatusLoz s={t.status} />
        <Avatar name={t.assignee} />
        <span className="sp" title="Story points">{t.storyPoints ?? '–'}</span>
        <PriorityIcon p={t.priority} />
      </span>
    </div>
  );
}

function InlineCreate({ group }: { group: string }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('Story');
  if (S.inlineCreate !== group) return <button className="inline-create" onClick={() => { S.inlineCreate = group; emit(); }}><Ico svg={I.plus} />Create issue</button>;
  const submit = () => { inlineCreate(group, title, type); setTitle(''); };
  return (
    <div className="inline-form">
      <SF bare aria-label="Issue type" value={type} onChange={(e) => setType(e.target.value)}>{opts(TYPES)}</SF>
      <TF bare autoFocus placeholder="What needs to be done?" autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape') { S.inlineCreate = null; emit(); } }} />
      <button className="btn sm primary" onClick={submit}>Create</button>
      <button className="btn sm subtle" onClick={() => { S.inlineCreate = null; emit(); }}>Cancel</button>
    </div>
  );
}

function BulkBar() {
  const p = P();
  const ids = [...S.checked].filter((id: string) => ticket(id)) as string[];
  if (!ids.length) return null;
  const bulkSet = (field: string, value: Any, label: string) => {
    mutate(() => ids.forEach((id) => { const t = ticket(id); if (t) setField(t, field, value); }));
    S.checked.clear(); emit(); toast(`${ids.length} issues ${label}`);
  };
  return (
    <div className="bulk">{ids.length} selected
      {can('sprint.manage') && <SF filter value="" onChange={(e) => e.target.value && bulkSet('sprintId', e.target.value === '__none' ? null : e.target.value, `moved to ${p.sprints.find((s: Any) => s.id === e.target.value)?.name || 'the backlog'}`)}>
        <MenuItem value="">Move to sprint…</MenuItem>{openSprints().map((s: Any) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}<MenuItem value="__none">Backlog</MenuItem></SF>}
      {(can('epic.manage') || can('issue.edit')) && <SF filter value="" onChange={(e) => e.target.value && bulkSet('epicId', e.target.value === '__none' ? null : e.target.value, `moved to ${epic(e.target.value)?.title || 'No epic'}`)}>
        <MenuItem value="">Move to epic…</MenuItem>{p.epics.map((x: Any) => <MenuItem key={x.id} value={x.id}>{x.title}</MenuItem>)}<MenuItem value="__none">No epic</MenuItem></SF>}
      {can('issue.edit') && <>
        <SF filter value="" onChange={(e) => e.target.value && bulkSet('status', e.target.value, `set to ${e.target.value}`)}><MenuItem value="">Set status…</MenuItem>{opts(statusNames())}</SF>
        <SF filter value="" onChange={(e) => e.target.value && bulkSet('assignee', e.target.value === '__none' ? '' : e.target.value, e.target.value === '__none' ? 'unassigned' : `assigned to ${e.target.value}`)}>
          <MenuItem value="">Assign to…</MenuItem>{opts(peopleNames())}<MenuItem value="__none">Unassigned</MenuItem></SF>
      </>}
      {can('ai.use') && can('issue.edit') && <button className="btn sm ai" onClick={bulkTests}><Ico svg={I.sparkle} />Write test cases</button>}
      {can('test.run') && <button className="btn sm" onClick={() => runTests(p.tickets.filter((x: Any) => S.checked.has(x.id)).flatMap((x: Any) => x.testCases.map((tc: Any) => ({ t: x, tc }))))}><Ico svg={I.play} />Run tests</button>}
      {can('issue.delete') && <button className="btn sm danger-subtle" onClick={() => openModal(<Confirm title={`Delete ${ids.length} issues?`} label="Delete" text="Their sub-tasks are deleted too. You can undo with ⌘Z."
        onYes={() => { let n = 0; mutate(() => { n = deleteIssues(ids); }); S.checked.clear(); emit(); toast(`Deleted ${n} issues`); }} />)}><Ico svg={I.trash} />Delete</button>}
      <div className="spacer" /><button className="btn sm subtle" onClick={() => { S.checked.clear(); emit(); }}>Clear selection</button>
    </div>
  );
}

export function Backlog() {
  const groups = backlogGroups();
  const act = activeSprint();
  const toggle = (id: string) => { if (S.collapsed.has(id)) S.collapsed.delete(id); else S.collapsed.add(id); saveUi(); emit(); };
  return <>
    <Header title="Backlog" right={can('ai.use') && can('issue.create') && <button className="btn ai" onClick={() => openModal(<NewWithClaudeModal />)}><Ico svg={I.sparkle} />Write issue with Claude</button>} />
    <FilterBar group={{ value: S.groupBy, options: [['sprint', 'Sprint'], ['epic', 'Epic'], ['status', 'Status'], ['none', 'None']], onChange: (v) => { S.groupBy = v; saveUi(); emit(); } }} />
    <BulkBar />
    {groups.length ? groups.map((g: Any) => {
      const closed = S.collapsed.has(g.id);
      const s = g.sprint;
      return (
        <div key={g.id} className={`section ${g.kind === 'sprint' && !s ? 'backlog-sec' : ''}`} {...zoneDnd({ group: g.id })}>
          <div className={`sec-h ${closed ? 'closed' : ''}`} onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a, select')) toggle(g.id); }}>
            <Ico svg={I.chevron} />
            {g.kind === 'status' ? <StatusLoz s={g.title} /> : g.epic ? <><TypeIcon type="Epic" /><Swatch color={g.epic.color} /><b>{g.title}</b></>
              : s ? <><b>{s.name}</b>{s.state === 'active' && <span className="loz s-inprogress">Active</span>}</> : <b>{g.title}</b>}
            <span className="meta">
              {s && (s.startDate ? `${fmtDate(s.startDate)} – ${fmtDate(s.endDate)} · ` : can('sprint.manage') ? <><a href="#" onClick={(e) => { e.preventDefault(); openModal(<SprintModal s={s} mode="edit" />); }}>Add dates</a> · </> : null)}
              {g.items.length} issue{g.items.length === 1 ? '' : 's'} · {spSum(g.items)} pts
            </span>
            <span className="sec-actions">
              <Tally items={g.items} />
              {g.epic && <button className="btn sm subtle" onClick={() => openDrawer('epic', g.epic.id)}>Details</button>}
              {s && can('sprint.manage') && <>
                {s.state === 'active' ? <button className="btn sm" onClick={() => openModal(<CompleteSprintModal s={s} />)}>Complete sprint</button>
                  : <button className={`btn sm ${act ? '' : 'primary'}`} disabled={Boolean(act)} title={act ? 'Complete the active sprint first' : ''} onClick={() => openModal(<SprintModal s={s} mode="start" />)}>Start sprint</button>}
                <button className="icon-btn" title="Edit sprint" aria-label="Edit sprint" onClick={() => openModal(<SprintModal s={s} mode="edit" />)}><Ico svg={I.pencil} /></button>
                <button className="icon-btn" title="Delete sprint" aria-label="Delete sprint" onClick={() => deleteSprint(s)}><Ico svg={I.trash} /></button>
              </>}
              {g.kind === 'sprint' && !s && can('sprint.manage') && <button className="btn sm" onClick={createSprint}>Create sprint</button>}
            </span>
          </div>
          {s?.goal && !closed && <div className="sprint-goal">{s.goal}</div>}
          {!closed && <>
            {g.items.length ? <div className="rows">{g.items.map((t: Any) => <IssueRow key={t.id} t={t} showEpic={g.kind !== 'epic'} zone={{ group: g.id }} />)}</div>
              : <div className="drop-hint">{s ? 'Plan this sprint by dragging issues here from the backlog.' : 'No issues. Drag issues here or create one.'}</div>}
            {can('issue.create') && <InlineCreate group={g.id} />}
          </>}
        </div>
      );
    }) : <div className="empty"><h3>No issues match</h3><p>Try clearing your filters.</p></div>}
    {S.groupBy === 'epic' && !filtersActive() && can('epic.manage') && <button className="inline-create" onClick={addEpic}><Ico svg={I.plus} />Create epic</button>}
  </>;
}

// ---------------------------------------------------------------- board
export function Board() {
  const p = P();
  const act = activeSprint();
  const useSprint = act && !S.boardAll;
  const statuses = statusNames();
  const list = filtered(useSprint ? p.tickets.filter((t: Any) => t.sprintId === act.id) : p.tickets);
  const Card = ({ t, showEpic, zone }: { t: Any; showEpic: boolean; zone: Any }) => {
    const parent = isSub(t) ? ticket(t.parentId) : null;
    return (
      <div className={`bcard ${S.drawer?.id === t.id ? 'active' : ''}`} onClick={() => openDrawer('issue', t.id)} {...rowDnd(t, zone)}>
        {parent && <div className="muted small"><TypeIcon type={parent.type} /> {parent.key} {parent.title.slice(0, 40)}</div>}
        <div className="t">{t.title}</div>
        {showEpic && epic(t.epicId) && !isSub(t) && <div><ELoz e={epic(t.epicId)} /></div>}
        <div className="foot"><TypeIcon type={t.type} /><span className="key">{t.key}</span>{isBlocked(t) && <span className="flag" title="Blocked"><Ico svg={I.flag} /></span>}
          {t.prs.length > 0 && <span className="mini"><Ico svg={I.pr} />{t.prs.length}</span>}
          <span className="right"><span className="sp">{t.storyPoints ?? '–'}</span><PriorityIcon p={t.priority} /><Avatar name={t.assignee} /></span></div>
      </div>
    );
  };
  const cols = (items: Any[], laneEpic: string | null | undefined, showEpic: boolean) => statuses.map((s) => {
    const zone = { status: s, ...(laneEpic !== undefined ? { epic: laneEpic } : {}) };
    const cs = items.filter((t) => t.status === s);
    return (
      <div key={`${laneEpic ?? 'all'}-${s}`} className="col" {...zoneDnd(zone)}>
        <div className="col-h"><span className={`dot-cat s-${catOf(s)}`} />{s} <span className="muted">{cs.length}</span></div>
        {cs.map((t) => <Card key={t.id} t={t} showEpic={showEpic} zone={zone} />)}
      </div>
    );
  });
  let body: ReactNode;
  if (S.boardGroup === 'epic') {
    const lanes = [...p.epics.map((e: Any) => ({ e, items: list.filter((t: Any) => t.epicId === e.id) })), { e: null, items: list.filter((t: Any) => !epic(t.epicId)) }].filter((l) => l.items.length);
    body = lanes.map((l: Any) => [<div key={`h-${l.e?.id || 'none'}`} className="lane-h">{l.e && <TypeIcon type="Epic" />}{l.e?.title || 'Issues without epic'} <span className="muted small">{l.items.length} issues</span></div>, ...cols(l.items, l.e?.id || null, false)]);
  } else body = cols(list, undefined, true);
  const left = useSprint ? daysLeft(act) : null;
  const noSprint = p.sprints.length > 0 && !act && !S.boardAll;
  return <>
    <Header title={useSprint ? act.name : 'Board'} right={<>
      {p.sprints.length > 0 && <SF filter aria-label="Board scope" value={S.boardAll ? 'all' : 'sprint'} onChange={(e) => { S.boardAll = e.target.value === 'all'; emit(); }}><MenuItem value="sprint">Active sprint</MenuItem><MenuItem value="all">All issues</MenuItem></SF>}
      {useSprint && <><span className="muted small row" style={{ gap: 4 }}><Ico svg={I.clock} />{left === null ? 'No end date' : left >= 0 ? `${left} days remaining` : `${-left} days overdue`}</span>
        {can('sprint.manage') && <button className="btn" onClick={() => openModal(<CompleteSprintModal s={act} />)}>Complete sprint</button>}</>}
    </>} />
    {useSprint && act.goal && <p className="muted" style={{ margin: '-8px 0 12px' }}><Ico svg={I.flag} /> {act.goal}</p>}
    {noSprint ? (
      <div className="empty"><Ico svg={I.board} size={48} style={{ color: 'var(--brand)' }} /><h3>No active sprint</h3><p>Start a sprint from the backlog to see its issues here.</p>
        <div className="row" style={{ justifyContent: 'center' }}><Link className="btn primary" href={`/p/${p.id}/backlog`}>Go to backlog</Link><button className="btn" onClick={() => { S.boardAll = true; emit(); }}>Show all issues</button></div></div>
    ) : <>
      <FilterBar status={false} group={{ value: S.boardGroup, options: [['none', 'None'], ['epic', 'Epic']], onChange: (v) => { S.boardGroup = v; saveUi(); emit(); } }} />
      <div style={{ overflowX: 'auto' }}><div className="board" style={{ gridTemplateColumns: `repeat(${statuses.length}, minmax(220px, 1fr))` }}>{body}</div></div>
      {!list.length && <div className="empty"><h3>No issues to show</h3><p>Create issues in the backlog or clear your filters.</p></div>}
    </>}
  </>;
}

// ---------------------------------------------------------------- epics
export function Epics() {
  const p = P();
  return <>
    <Header title="Epics" right={can('epic.manage') && <>
      {can('ai.use') && <button className="btn ai" onClick={() => openModal(<RegroupModal />)}><Ico svg={I.sparkle} />Re-organize with Claude</button>}
      <button className="btn primary" onClick={addEpic}><Ico svg={I.plus} />Create epic</button></>} />
    {p.epics.length ? <>
      <table className="tbl"><thead><tr><th>Epic</th><th>Progress</th><th className="num">Done</th><th className="num">Issues</th><th className="num">Story points</th><th className="num">Test cases</th></tr></thead><tbody>
        {p.epics.map((e: Any) => {
          const pr = epicProgress(e);
          return (
            <tr key={e.id} className="click" onClick={() => openDrawer('epic', e.id)}>
              <td><span className="row" style={{ flexWrap: 'nowrap' }}><TypeIcon type="Epic" /><span className="key">{e.key}</span><Swatch color={e.color} /><b style={{ fontWeight: 500 }}>{e.title}</b></span>
                {e.description && <div className="muted small" style={{ margin: '2px 0 0 24px', maxWidth: 560, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description}</div>}</td>
              <td style={{ width: 200 }}><ProgBar {...pr} /></td>
              <td className="num">{pr.total ? Math.round((pr.done / pr.total) * 100) : 0}%</td>
              <td className="num">{pr.total}</td><td className="num">{spSum(pr.ts)}</td><td className="num">{pr.ts.reduce((s: number, t: Any) => s + t.testCases.length, 0)}</td>
            </tr>
          );
        })}
      </tbody></table>
      {noEpic().length > 0 && <p className="muted small" style={{ marginTop: 12 }}>{noEpic().length} issues have no epic. <a href="#" onClick={(e) => { e.preventDefault(); S.filter = { ...EMPTY_FILTER(), epic: 'none' }; S.groupBy = 'epic'; S.nav(`/p/${p.id}/backlog`); }}>View them in the backlog</a></p>}
    </> : <div className="empty"><Ico svg={I.epic} size={48} style={{ color: '#904ee2' }} /><h3>No epics yet</h3><p>Epics group related issues into larger pieces of work.</p>{can('epic.manage') && <button className="btn primary" onClick={addEpic}>Create epic</button>}</div>}
  </>;
}

// ---------------------------------------------------------------- test cases
export function testRows() {
  const f = S.tcFilter;
  const qq = f.q.trim().toLowerCase();
  const rows: { t: Any; tc: Any; i: number }[] = [];
  for (const t of P().tickets.filter((x: Any) => !S.filter.epic || x.epicId === S.filter.epic)) {
    t.testCases.forEach((tc: Any, i: number) => {
      if (f.status && tc.status !== f.status) return;
      if (f.type && tc.type !== f.type) return;
      if (qq && ![tc.title, tc.expected, tcKey(t, i), t.key, t.title].join(' ').toLowerCase().includes(qq)) return;
      rows.push({ t, tc, i });
    });
  }
  return rows;
}
const RunLoz = ({ tc }: { tc: Any }) => (tc.lastRun ? <span className={`loz ${tCls(tc.lastRun.status)}`} title={`Automated run ${ago(tc.lastRun.at)} · ${(tc.lastRun.durationMs / 1000).toFixed(1)}s`}><Ico svg={I.bot} /> {tc.lastRun.status}</span> : null);
export function setTcStatus(t: Any, tc: Any, v: string) {
  mutate(() => { tc.status = v; logEvent(t, `marked ${tcKey(t, t.testCases.indexOf(tc))} as ${v}`); });
}
const TcStatusSelect = ({ t, tc }: { t: Any; tc: Any }) => (
  <SF loz className={`loz ${tCls(tc.status)}`} aria-label="Result" value={tc.status} disabled={!can('test.run') && !can('issue.edit')}
    onClick={(e) => e.stopPropagation()} onChange={(e) => setTcStatus(t, tc, e.target.value)}>{opts(TC_STATUS)}</SF>
);
function openTest(t: Any, tc: Any) {
  openDrawer('issue', t.id);
  S.openTc.add(tc.id); emit();
  setTimeout(() => document.getElementById(`tc-${tc.id}`)?.scrollIntoView({ block: 'center' }), 50);
}

export function Tests() {
  const p = P();
  const f = S.tcFilter;
  const setF = (k: string, v: string) => { S.tcFilter = { ...S.tcFilter, [k]: v }; emit(); };
  const rows = testRows();
  const all = p.tickets.flatMap((t: Any) => t.testCases);
  const c = (s: string) => all.filter((x: Any) => x.status === s).length;
  return <>
    <Header title="Test cases" right={can('test.run') && <button className="btn" disabled={!rows.length} onClick={() => runTests(rows)}><Ico svg={I.play} />Run {rows.length} automated</button>} />
    <div className="tiles">
      <Tile icon={I.test} value={all.length} label={`test cases · ${all.filter((x: Any) => x.script).length} automated`} />
      <Tile icon={I.check} value={c('Pass')} label="passed" color="#22a06b" />
      <Tile icon={I.close} value={c('Fail')} label="failed" color="var(--danger)" />
      <Tile icon={I.backlog} value={c('Not run') + c('Blocked')} label="not run or blocked" />
    </div>
    <div className="toolbar">
      <TF search sx={{ width: 220 }} id="tq" placeholder="Search test cases" value={f.q} onChange={(e) => setF('q', e.target.value)} />
      <SF filter aria-label="Epic" value={S.filter.epic} onChange={(e) => { S.filter = { ...S.filter, epic: e.target.value }; emit(); }}><MenuItem value="">Epic</MenuItem>{p.epics.map((e: Any) => <MenuItem key={e.id} value={e.id}>{e.title}</MenuItem>)}</SF>
      <SF filter aria-label="Result" value={f.status} onChange={(e) => setF('status', e.target.value)}><MenuItem value="">Result</MenuItem>{opts(TC_STATUS)}</SF>
      <SF filter aria-label="Test type" value={f.type} onChange={(e) => setF('type', e.target.value)}><MenuItem value="">Test type</MenuItem>{opts(TC_TYPES)}</SF>
      <div className="spacer" /><span className="muted small">{rows.length} shown</span>
    </div>
    {rows.length ? <table className="tbl"><thead><tr><th>Key</th><th>Test case</th><th>Issue</th><th>Type</th><th>Covers</th><th>Automation</th><th>Result</th></tr></thead><tbody>
      {rows.map(({ t, tc, i }) => (
        <tr key={tc.id} className="click" onClick={() => openTest(t, tc)}>
          <td className="key">{tcKey(t, i)}</td><td>{tc.title}</td>
          <td><span className="row" style={{ flexWrap: 'nowrap' }}><TypeIcon type={t.type} /><span className="key">{t.key}</span></span></td>
          <td className="muted">{tc.type}</td>
          <td className="muted">{(tc.acRef || []).map((n: number) => `AC${n}`).join(', ') || '–'}</td>
          <td>{tc.lastRun ? <RunLoz tc={tc} /> : tc.script ? <span className="muted small"><Ico svg={I.bot} /> Script ready</span> : <span className="muted small">Manual</span>}</td>
          <td><TcStatusSelect t={t} tc={tc} /></td>
        </tr>
      ))}
    </tbody></table> : <div className="empty"><h3>No test cases found</h3><p>{all.length ? 'Try changing the filters.' : 'Open an issue and use “Regenerate test cases”, or select issues in the backlog and choose “Write test cases”.'}</p></div>}
  </>;
}

// ---------------------------------------------------------------- reports
function VelocityChart({ sprints }: { sprints: Any[] }) {
  if (!sprints.length) return <p className="muted">Complete a sprint to see velocity.</p>;
  const W = 640, H = 240, L = 40, B = 36, T = 12;
  const max = Math.max(1, ...sprints.flatMap((s) => [s.committedPoints || 0, s.completedPoints || 0]));
  const step = Math.ceil(max / 4), top = step * 4;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const gw = (W - L - 8) / sprints.length;
  const bw = Math.min(28, gw / 3);
  const bar = (v: number, x: number, cls: string, label: string, name: string) => <path key={cls} d={`M${x},${y(0)} V${y(v) + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${y(0)} Z`} className={cls}><title>{`${name} · ${label}: ${v} points`}</title></path>;
  return <>
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Velocity: commitment versus completed story points per sprint">
      {[0, 1, 2, 3, 4].map((i) => <g key={i}><line x1={L} x2={W - 4} y1={y(i * step)} y2={y(i * step)} className="gridline" /><text x={L - 6} y={y(i * step) + 4} textAnchor="end" className="axis">{i * step}</text></g>)}
      {sprints.map((s, i) => { const cx = L + gw * i + gw / 2; return (
        <g key={s.id}>{bar(s.committedPoints || 0, cx - bw - 1, 'series-1', 'Commitment', s.name)}{bar(s.completedPoints || 0, cx + 1, 'series-2', 'Completed', s.name)}
          <text x={cx} y={H - B + 18} textAnchor="middle" className="axis">{s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name}</text></g>); })}
    </svg>
    <div className="legend"><span><i className="series-1-bg" />Commitment</span><span><i className="series-2-bg" />Completed</span></div>
  </>;
}
function Burndown({ s }: { s: Any }) {
  if (!s?.startDate || !s?.endDate) return <p className="muted">Start a sprint with start and end dates to see its burndown.</p>;
  const issues = P().tickets.filter((t: Any) => t.sprintId === s.id && !isSub(t));
  const total = s.committedPoints ?? spSum(issues);
  const doneAt = (t: Any) => {
    if (!isDone(t)) return null;
    const h = [...t.history].reverse().find((x: Any) => x.field === 'status' && catOf(x.to) === 'done');
    return Date.parse(h?.at || t.updatedAt);
  };
  const start = new Date(`${s.startDate}T00:00:00`), end = new Date(`${s.endDate}T00:00:00`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
  const stopAt = Math.min(Date.now(), s.completedAt ? Date.parse(s.completedAt) : Infinity);
  const pts: { d: number; v: number }[] = [];
  for (let d = 0; d <= days; d++) {
    if (start.getTime() + d * 86400000 > stopAt) break;
    const dayEnd = start.getTime() + (d + 1) * 86400000 - 1;
    pts.push({ d, v: total - spSum(issues.filter((t: Any) => { const a = doneAt(t); return a && a <= dayEnd; })) });
  }
  const W = 640, H = 240, L = 40, B = 36, T = 12;
  const top = Math.max(4, Math.ceil(total / 4) * 4);
  const x = (d: number) => L + (W - L - 12) * (d / days);
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const ticks = Array.from({ length: days + 1 }, (_, d) => d).filter((d) => d === 0 || d === days || d % Math.ceil(days / 6) === 0);
  return <>
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Burndown for ${s.name}`}>
      {[0, 1, 2, 3, 4].map((i) => <g key={i}><line x1={L} x2={W - 4} y1={y((top / 4) * i)} y2={y((top / 4) * i)} className="gridline" /><text x={L - 6} y={y((top / 4) * i) + 4} textAnchor="end" className="axis">{(top / 4) * i}</text></g>)}
      {ticks.map((d) => <text key={d} x={x(d)} y={H - B + 18} textAnchor="middle" className="axis">{fmtDate(start.getTime() + d * 86400000)}</text>)}
      <line x1={x(0)} y1={y(total)} x2={x(days)} y2={y(0)} className="guide" />
      <path d={pts.map((p2, i) => `${i ? 'L' : 'M'}${x(p2.d)},${y(p2.v)}`).join(' ')} className="series-1-line" />
      {pts.map((p2) => <circle key={p2.d} cx={x(p2.d)} cy={y(p2.v)} r={4} className="series-1 ring"><title>{`${fmtDate(start.getTime() + p2.d * 86400000)}: ${p2.v} points remaining`}</title></circle>)}
    </svg>
    <div className="legend"><span><i className="series-1-bg" />Remaining story points</span><span><i className="guide-key" />Guideline</span></div>
  </>;
}
export function Reports() {
  const p = P();
  const closed = p.sprints.filter((s: Any) => s.state === 'closed').slice(-7);
  const target = activeSprint() || closed[closed.length - 1];
  const avg = closed.length ? Math.round(closed.reduce((s: number, x: Any) => s + (x.completedPoints || 0), 0) / closed.length) : 0;
  return <>
    <Header title="Reports" />
    <div className="cards">
      <div className="card wide"><h3>Velocity</h3><p className="sub">Story points committed at sprint start versus completed, for the last {closed.length} completed sprints{closed.length ? ` · average ${avg} points` : ''}.</p><VelocityChart sprints={closed} /></div>
      <div className="card wide"><h3>Burndown{target ? ` · ${target.name}` : ''}</h3><p className="sub">Story points remaining each day of the sprint against an even guideline.</p><Burndown s={target} /></div>
      <div className="card wide"><h3>Sprint report</h3><p className="sub">Every sprint in this project.</p>
        {p.sprints.length ? <table className="tbl"><thead><tr><th>Sprint</th><th>State</th><th>Dates</th><th className="num">Issues</th><th className="num">Committed</th><th className="num">Completed</th></tr></thead><tbody>
          {p.sprints.map((s: Any) => (
            <tr key={s.id}><td><b style={{ fontWeight: 500 }}>{s.name}</b>{s.goal && <div className="muted small">{s.goal}</div>}</td>
              <td><span className={`loz ${s.state === 'active' ? 's-inprogress' : s.state === 'closed' ? 's-done' : 's-todo'}`}>{s.state === 'future' ? 'Planned' : s.state}</span></td>
              <td className="muted">{s.startDate ? `${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}` : '–'}</td>
              <td className="num">{p.tickets.filter((t: Any) => t.sprintId === s.id && !isSub(t)).length}</td>
              <td className="num">{s.committedPoints ?? '–'}</td><td className="num">{s.completedPoints ?? '–'}</td></tr>
          ))}</tbody></table> : <p className="muted">No sprints yet. Create one from the backlog.</p>}</div>
    </div>
  </>;
}

// ---------------------------------------------------------------- test automation
export function automationItems(scope: string) {
  const act = activeSprint();
  const out: { t: Any; tc: Any; i: number }[] = [];
  for (const t of P().tickets) {
    if (scope === 'sprint' && (!act || t.sprintId !== act.id)) continue;
    if (scope.startsWith('epic:') && t.epicId !== scope.slice(5)) continue;
    t.testCases.forEach((tc: Any, i: number) => {
      if (scope === 'failed' && tc.lastRun?.status !== 'Fail') return;
      if (scope === 'notrun' && tc.lastRun) return;
      if (scope === 'automated' && !tc.script) return;
      out.push({ t, tc, i });
    });
  }
  return out;
}
export function Automation() {
  const p = P();
  const eng = S.engine, run = S.autoRun, act = activeSprint();
  const items = automationItems(S.autoScope);
  const all = p.tickets.flatMap((t: Any) => t.testCases);
  const ran = all.filter((x: Any) => x.lastRun);
  return <>
    <Header title="Test automation" right={can('test.run') && (run?.running ? <button className="btn danger" onClick={() => run.ctrl?.abort()}><Ico svg={I.stop} />Stop</button>
      : <button className="btn primary" disabled={!items.length || !eng?.browser} onClick={() => runTests(items, { regenerate: S.autoRegen })}><Ico svg={I.play} />Run {items.length} test{items.length === 1 ? '' : 's'}</button>)} />
    <div className="tiles">
      <Tile icon={I.bot} value={`${all.filter((x: Any) => x.script).length} / ${all.length}`} label="test cases automated" />
      <Tile icon={I.check} value={ran.filter((x: Any) => x.lastRun.status === 'Pass').length} label="passed last run" color="#22a06b" />
      <Tile icon={I.close} value={ran.filter((x: Any) => x.lastRun.status === 'Fail').length} label="failed last run" color="var(--danger)" />
      <Tile icon={I.clock} value={ran.length ? ago(ran.map((x: Any) => x.lastRun.at).sort().pop()) : 'Never'} label="last automated run" />
    </div>
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="grid2" style={{ alignItems: 'end' }}>
        <label className="field" style={{ margin: 0 }}><span>Application URL — where the tests run</span>
          <TF value={p.automation.baseUrl || ''} disabled={!can('project.settings')} placeholder="e.g. http://localhost:3000 or https://staging.example.com"
            onChange={(e) => mutate((pp) => { pp.automation.baseUrl = e.target.value.trim(); }, { tag: 'baseUrl' })} /></label>
        <div className="small">{eng ? (eng.browser ? <span className="row" style={{ gap: 6 }}><span className="dot ok" />Playwright {eng.version} with Chromium is ready.</span>
          : <><span className="row" style={{ gap: 6 }}><span className="dot bad" />{eng.installed ? 'Chromium is not installed yet.' : <>Playwright is not installed. Run <code>npm install</code>.</>}</span>
            {eng.installed && can('users.manage') && <button className="btn sm" style={{ marginTop: 6 }} onClick={installBrowser}>Install Chromium</button>}</>) : <span className="muted">Checking test engine…</span>}</div>
      </div>
      <p className="muted small" style={{ margin: '12px 0 0' }}>Claude writes a Playwright script for each test case from its steps, the issue&apos;s acceptance criteria and a snapshot of the page. Scripts run on this machine in a headless Chromium; you can read and edit every script. Results update each test case.</p>
      <div className="row" style={{ marginTop: 10, gap: 16 }}>
        <span className="small" style={{ fontWeight: 600, color: 'var(--text-subtle)' }}>When a test fails</span>
        <CB label="Comment on the issue" disabled={!can('project.settings')} checked={p.automation.onFail?.comment !== false}
          onChange={(e: Any) => mutate((pp) => { pp.automation.onFail = { ...(pp.automation.onFail || {}), comment: e.target.checked }; })} />
        <CB label="Notify the assignee (in-app and email)" disabled={!can('project.settings')} checked={p.automation.onFail?.notify !== false}
          onChange={(e: Any) => mutate((pp) => { pp.automation.onFail = { ...(pp.automation.onFail || {}), notify: e.target.checked }; })} />
      </div>
    </div>
    <div className="toolbar">
      <span className="muted small">Run</span>
      <SF filter aria-label="Which tests" value={S.autoScope} onChange={(e) => { S.autoScope = e.target.value; emit(); }}>
        <MenuItem value="all">All test cases</MenuItem><MenuItem value="automated">Tests with scripts</MenuItem><MenuItem value="notrun">Never run</MenuItem><MenuItem value="failed">Failed last run</MenuItem>
        {act && <MenuItem value="sprint">Active sprint ({act.name})</MenuItem>}
        {p.epics.map((e: Any) => <MenuItem key={e.id} value={`epic:${e.id}`}>Epic: {e.title}</MenuItem>)}
      </SF>
      {can('ai.use') && <label className="check small"><CB checked={S.autoRegen} onChange={(e) => { S.autoRegen = e.target.checked; emit(); }} /> Rewrite existing scripts with Claude</label>}
    </div>
    {run && <div className="progress-box" style={{ margin: '0 0 16px' }}>
      {run.running && <div className="pbar"><i /></div>}
      <div className="row small" style={{ marginBottom: 6 }}><b>{run.running ? 'Running' : 'Finished'}</b><span className="muted">{run.done} of {run.total} run · {run.pass} passed · {run.fail} failed</span></div>
      <ul className="log">{run.log.slice(-8).map((l: Any, i: number) => (
        <li key={i} className={l.level || ''}>{l.level === 'err' || l.level === 'warn' ? <Ico svg={I.warn} /> : l.level === 'pass' ? <Ico svg={I.check} className="ok" /> : l.level === 'fail' ? <Ico svg={I.close} style={{ color: 'var(--danger)' }} /> : l.level === 'info' || !run.running ? <Ico svg={I.check} className="muted" /> : <Spinner />}<span>{l.message}</span></li>))}</ul>
    </div>}
    {items.length ? <table className="tbl"><thead><tr><th>Key</th><th>Test case</th><th>Issue</th><th>Script</th><th>Last run</th><th className="num">Duration</th><th /></tr></thead><tbody>
      {items.map(({ t, tc, i }) => {
        const running = run?.running && run.current === tc.id;
        return [
          <tr key={tc.id} className="click" onClick={() => openTest(t, tc)}>
            <td className="key">{tcKey(t, i)}</td><td>{tc.title}</td>
            <td><span className="row" style={{ flexWrap: 'nowrap' }}><TypeIcon type={t.type} /><span className="key">{t.key}</span></span></td>
            <td>{tc.script ? <button className="btn sm subtle" onClick={(e) => { e.stopPropagation(); openModal(<ScriptModal tid={t.id} tcid={tc.id} />); }}><Ico svg={I.bot} />View</button> : <span className="muted small">Not written</span>}</td>
            <td>{running ? <span className="row small" style={{ gap: 6 }}><Spinner />Running</span> : tc.lastRun ? <><RunLoz tc={tc} /> <span className="muted small">{ago(tc.lastRun.at)}</span></> : <span className="muted small">Never</span>}</td>
            <td className="num muted">{tc.lastRun ? `${(tc.lastRun.durationMs / 1000).toFixed(1)}s` : '–'}</td>
            <td style={{ textAlign: 'right' }}>{can('test.run') && <button className="icon-btn" title="Run this test" disabled={run?.running} onClick={(e) => { e.stopPropagation(); runTests([{ t, tc }]); }}><Ico svg={I.play} /></button>}</td>
          </tr>,
          tc.lastRun?.status === 'Fail' && <tr key={`${tc.id}-err`} className="err-row"><td /><td colSpan={6}><div className="err-box">{tc.lastRun.error.split('\n').slice(0, 4).join('\n')}</div>
            {tc.lastRun.screenshot && <a href={tc.lastRun.screenshot} target="_blank" rel="noopener noreferrer" className="small"><Ico svg={I.external} /> Screenshot</a>}</td></tr>,
        ];
      })}
    </tbody></table> : <div className="empty"><h3>No test cases in this selection</h3><p>Pick a different set above, or add test cases to your issues.</p></div>}
  </>;
}

// ---------------------------------------------------------------- source & settings
export function Source() {
  const p = P();
  return <>
    <Header title="Source document" />
    {p.sourceText ? <><p className="muted" style={{ marginTop: -8 }}><Ico svg={I.doc} /> {p.sourceName} · {p.sourceText.split(/\s+/).length.toLocaleString()} words</p><div className="source">{p.sourceText}</div></>
      : <div className="empty"><h3>No source document</h3><p>This project was created without a document.</p></div>}
  </>;
}

/** An input that commits on blur (used where every keystroke would cascade, e.g. renames). */
function CommitInput({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <TF key={value} defaultValue={value} onBlur={(e) => { if (e.target.value.trim() !== value) onCommit(e.target.value.trim()); }}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} {...rest} />;
}
const lines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean);

export function Settings() {
  const p = P();
  const ed = can('project.settings');
  const counts = (name: string) => p.tickets.filter((t: Any) => t.status === name).length;
  const assigned = (name: string) => p.tickets.filter((t: Any) => t.assignee === name).length;
  const set = (k: string, v: Any) => mutate((pp) => { pp[k] = v; }, { tag: `p.${k}` });
  const rekey = (key: string) => mutate((pp) => {
    const old = pp.key;
    pp.key = key;
    for (const x of [...pp.tickets, ...pp.epics]) if (x.key?.startsWith(`${old}-`)) x.key = `${key}-${x.key.slice(old.length + 1)}`;
  });
  const renameMember = (m: Any, val: string) => mutate((pp) => {
    if (!val) return;
    for (const t of pp.tickets) { if (t.assignee === m.name) t.assignee = val; if (t.reporter === m.name) t.reporter = val; }
    m.name = val;
  });
  const renameStatus = (i: number, name: string) => {
    if (!name || p.workflow.some((x: Any, j: number) => j !== i && x.name.toLowerCase() === name.toLowerCase())) { toast('Status names must be unique and not empty.', 'err'); emit(); return; }
    const w = p.workflow[i];
    mutate((pp) => { pp.tickets.forEach((t: Any) => { if (t.status === w.name) t.status = name; }); w.name = name; });
  };
  const delStatus = (i: number) => {
    const w = p.workflow[i];
    const rest = p.workflow.filter((x: Any) => x !== w);
    const to = rest.find((x: Any) => x.category === w.category) || rest[0];
    const n = counts(w.name);
    openModal(<Confirm title={`Delete status “${w.name}”?`} label="Delete status" text={n ? `${n} issues move to “${to.name}”.` : 'No issues use this status.'}
      onYes={() => mutate((pp) => { pp.tickets.forEach((x: Any) => { if (x.status === w.name) setField(x, 'status', to.name); }); pp.workflow = rest; })} />);
  };
  const others = p.members.filter((m: Any) => !S.people.some((u: Any) => u.name === m.name));
  return <>
    <Header title="Project settings" />
    <div style={{ maxWidth: 820 }}>
      <h2 className="set-h">Details</h2>
      <div className="grid2">
        <label className="field"><span>Name</span><TF disabled={!ed} value={p.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="field"><span>Key — prefix for issue keys</span><CommitInput disabled={!ed} value={p.key} onCommit={(v) => { const k = v.replace(/[^a-z0-9]/gi, '').toUpperCase(); if (k) rekey(k); }} /></label>
      </div>
      <label className="field"><span>Summary</span><TA disabled={!ed} value={p.summary} onChange={(e) => set('summary', e.target.value)} /></label>
      <div className="grid2">
        <label className="field"><span>Assumptions — one per line</span><TA disabled={!ed} key={`a-${p.assumptions?.length}`} defaultValue={(p.assumptions || []).join('\n')} onBlur={(e) => set('assumptions', lines(e.target.value))} /></label>
        <label className="field"><span>Open questions — one per line</span><TA disabled={!ed} key={`q-${p.openQuestions?.length}`} defaultValue={(p.openQuestions || []).join('\n')} onBlur={(e) => set('openQuestions', lines(e.target.value))} /></label>
      </div>

      <h2 className="set-h"><Ico svg={I.people} /> People</h2>
      <p className="muted small">Users with access to this project come from Administration (invites, roles and project access). You can also add people without an account so they can be assigned issues.</p>
      <table className="tbl"><thead><tr><th /><th>Name</th><th>Email</th><th>Role</th><th className="num">Assigned</th><th /></tr></thead><tbody>
        {S.people.map((u: Any) => <tr key={u.id}><td style={{ width: 36 }}><Avatar name={u.name} /></td><td>{u.name}{u.id === S.user?.id && <span className="muted small"> (you)</span>}</td><td className="muted">{u.email}</td><td><span className="label-chip">{u.role}</span></td><td className="num">{assigned(u.name)}</td><td /></tr>)}
        {others.map((m: Any) => (
          <tr key={m.id}><td style={{ width: 36 }}><Avatar name={m.name} /></td>
            <td><CommitInput disabled={!ed} value={m.name} aria-label="Name" onCommit={(v) => renameMember(m, v)} /></td>
            <td><CommitInput disabled={!ed} value={m.email || ''} placeholder="No account" aria-label="Email" onCommit={(v) => mutate(() => { m.email = v; })} /></td>
            <td><CommitInput disabled={!ed} value={m.role || ''} placeholder="e.g. Contractor" aria-label="Role" onCommit={(v) => mutate(() => { m.role = v; })} /></td>
            <td className="num">{assigned(m.name)}</td>
            <td style={{ textAlign: 'right' }}>{ed && <button className="icon-btn" title="Remove" onClick={() => mutate((pp) => { pp.tickets.forEach((x: Any) => { if (x.assignee === m.name) setField(x, 'assignee', ''); }); pp.members = pp.members.filter((x: Any) => x.id !== m.id); })}><Ico svg={I.trash} /></button>}</td></tr>
        ))}
      </tbody></table>
      <div className="row" style={{ marginTop: 4 }}>
        {ed && <button className="inline-create" style={{ width: 'auto' }} onClick={() => mutate((pp) => pp.members.push({ id: uid(), name: `Person ${pp.members.length + 1}`, email: '', role: '' }))}><Ico svg={I.plus} />Add person without an account</button>}
        {can('users.manage') && <Link className="btn sm" href="/admin/invites"><Ico svg={I.people} />Invite users</Link>}
      </div>

      <h2 className="set-h"><Ico svg={I.board} /> Workflow</h2>
      <p className="muted small">The statuses issues move through, in board order. The category sets the colour and what counts as done for progress, sprints and reports.</p>
      <table className="tbl"><thead><tr><th>Status</th><th>Category</th><th className="num">Issues</th><th /></tr></thead><tbody>
        {p.workflow.map((w: Any, i: number) => (
          <tr key={w.id}><td><CommitInput disabled={!ed} value={w.name} aria-label="Status name" onCommit={(v) => renameStatus(i, v)} /></td>
            <td><SF disabled={!ed} aria-label="Category" value={w.category} onChange={(e) => mutate(() => { w.category = e.target.value; })}>{CATEGORIES.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}</SF></td>
            <td className="num">{counts(w.name)}</td>
            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{ed && <>
              <button className="icon-btn" disabled={i === 0} title="Move up" onClick={() => mutate((pp) => { const l = pp.workflow; [l[i], l[i - 1]] = [l[i - 1], l[i]]; })}><Ico svg={I.up} /></button>
              <button className="icon-btn" disabled={i === p.workflow.length - 1} title="Move down" onClick={() => mutate((pp) => { const l = pp.workflow; [l[i], l[i + 1]] = [l[i + 1], l[i]]; })}><Ico svg={I.down} /></button>
              <button className="icon-btn" disabled={p.workflow.length < 2} title="Delete status" onClick={() => delStatus(i)}><Ico svg={I.trash} /></button></>}</td></tr>
        ))}
      </tbody></table>
      {ed && <button className="inline-create" style={{ width: 'auto' }} onClick={() => mutate((pp) => { let n = 'New status', k = 1; while (pp.workflow.some((w: Any) => w.name === n)) n = `New status ${++k}`; pp.workflow.splice(pp.workflow.length - 1, 0, { id: uid(), name: n, category: 'inprogress' }); })}><Ico svg={I.plus} />Add status</button>}

      {can('project.delete') && <div className="danger-zone"><h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Delete project</h3><p className="muted" style={{ margin: '0 0 12px' }}>Permanently removes this project and all of its epics, issues, sprints and test cases.</p>
        <button className="btn danger" onClick={() => openModal(<Confirm title="Delete project?" label="Delete" text={`“${p.name}” and all of its issues will be permanently deleted. This can’t be undone.`}
          onYes={async () => { try { await api(`/api/projects/${p.id}`, { method: 'DELETE' }); S.project = null; S.base = null; emit(); toast('Project deleted'); S.nav('/'); } catch (e: Any) { toast(e.message, 'err'); } }} />)}>Delete project</button></div>}
    </div>
  </>;
}

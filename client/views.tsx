'use client';
// Project views: Summary, Backlog, Board, Epics, Reports, Test cases, Test automation, Source, Settings.
import { useState, type DragEvent, type ReactNode } from 'react';
import Link from 'next/link';
import {
  S, emit, P, ago, fmtDate, TYPES, PRIORITIES, TC_TYPES, TC_STATUS, CATEGORIES, epic, sprint, isSub, childrenOf, epicTickets, noEpic,
  activeSprint, openSprints, tcKey, spSum, statusNames, allowedStatuses, sCls, catOf, isDone, tCls, filtered, filtersActive, can, peopleNames, ticket, isBlocked,
  saveUi, EMPTY_FILTER, mutate, setField, canMove, deleteIssues, historyText, openModal, setMenu, toast, uid, logEvent, api, type Any,
} from './core';
import { Ico, I, TypeIcon, PriorityIcon, Avatar, ELoz, StatusLoz, Swatch, LayerChip, Confirm, Spinner, AutoTextarea, EmptyState, Modal, Menu } from './ui';
import {
  openDrawer, moveTicket, inlineCreate, createSprint, deleteSprint, SprintModal, CompleteSprintModal, NewWithClaudeModal, RegroupModal,
  addEpic, bulkTests, runTests, installBrowser, ScriptModal, openCreateIssue,
} from './actions';
import { TF, TA, SF, CB, RB, DateF, PeopleF, MenuItem, opts } from './fields';
import { AppSetup } from './AppSetup';
import { RunSettingsCard } from './RepoSync';
import { FeatureModal } from './FeatureModal';
import { RemoteBrowser } from './RemoteBrowser';
import { epicRange } from './Timeline';
import { openFbd, openWriteFbd, downloadFbdDocx, writeMissingFbds, fbdBusy, openDoc, openWriteDoc, downloadDocDocx, docBusy, writeMissingDocs } from './Fbd';
import { openPsd, openWritePsd, downloadPsd, writeMissingPsds, psdBusy } from './Psd';
import { ItemText } from './ListEditor';

// ---------------------------------------------------------------- drag & drop
let dragId: string | null = null;
const clearDrop = () => document.querySelectorAll('.drop, .drop-before, .no-drop').forEach((n) => n.classList.remove('drop', 'drop-before', 'no-drop'));
const canDrag = () => can('issue.edit') || can('sprint.manage') || can('epic.manage');
/** The status a drop target would give the issue, if any. */
const zoneStatus = (zone: Any) => zone?.status || (zone?.group?.startsWith('s:') ? zone.group.slice(2) : '');
/** Whether the dragged issue may be dropped here (custom workflow transitions). */
const dropOk = (zone: Any) => { const st = zoneStatus(zone); return !st || !dragId || canMove(ticket(dragId), st); };
export function rowDnd(t: Any, zone: Any) {
  if (!canDrag()) return {};
  return {
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      dragId = t.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); e.currentTarget.classList.add('dragging');
      // Grey out the columns and groups this issue can't move to.
      document.querySelectorAll<HTMLElement>('[data-drop-status]').forEach((el) => el.classList.toggle('no-drop', !canMove(t, el.dataset.dropStatus || '')));
    },
    onDragEnd: (e: DragEvent<HTMLElement>) => { dragId = null; e.currentTarget.classList.remove('dragging'); clearDrop(); },
    onDragOver: (e: DragEvent<HTMLElement>) => { if (dragId && dragId !== t.id && dropOk(zone)) { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('drop-before'); } },
    onDragLeave: (e: DragEvent<HTMLElement>) => e.currentTarget.classList.remove('drop-before'),
    onDrop: (e: DragEvent<HTMLElement>) => { e.preventDefault(); e.stopPropagation(); clearDrop(); if (dragId) moveTicket(dragId, zone, t.id); },
  };
}
export function zoneDnd(zone: Any) {
  return {
    onDragOver: (e: DragEvent<HTMLElement>) => { if (dragId && dropOk(zone)) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
    onDragLeave: (e: DragEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) e.currentTarget.classList.remove('drop'); },
    onDrop: (e: DragEvent<HTMLElement>) => { e.preventDefault(); clearDrop(); if (dragId) moveTicket(dragId, zone); },
  };
}

export function Header({ title, right, sub }: { title: string; right?: ReactNode; sub?: ReactNode }) {
  return <>
    <div className="crumbs"><Link href="/">Projects</Link><span>/</span><Link href={`/p/${P().id}/summary`}>{P().name}</Link></div>
    <div className="page-h"><h1>{title}</h1>{sub}<div className="spacer" />{right}</div>
  </>;
}

export function FilterBar({ status = true, group }: { status?: boolean; group?: { value: string; options: [string, string][]; onChange: (v: string) => void } }) {
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
export const daysLeft = (s: Any) => {
  if (!s?.endDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${s.endDate}T00:00:00`).getTime() - today.getTime()) / 86400000);
};
/** Assumptions / open questions, readable: codes as tags, the first few with "Show all". */
function ReadList({ l }: { l: string[] }) {
  const [all, setAll] = useState(false);
  if (!l?.length) return <p className="muted">None.</p>;
  const shown = all ? l : l.slice(0, 6);
  return <><ol className="li-list read">{shown.map((x, i) => <li key={i}><span className="li-n">{i + 1}</span><div className="li-body"><ItemText s={x} /></div></li>)}</ol>
    {l.length > 6 && <button className="btn sm subtle" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${l.length}`}</button>}</>;
}

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
        {ts.length ? <Stack total={ts.length} parts={[['To do', cat('todo'), 'c-todo'], ['In progress', cat('inprogress'), 'c-prog'], ['Done', done, 'c-done']]} />
          : <EmptyState compact icon={I.backlog} tone="neutral" title="No issues yet" actions={can('issue.create') && <button className="btn" onClick={() => openCreateIssue()}><Ico svg={I.plus} />Create issue</button>} />}</div>
      <div className="card"><h3>Test results</h3><p className="sub">Latest result of every test case (manual or automated).</p>
        {tcs.length ? <Stack total={tcs.length} parts={[['Not run', tcBy('Not run'), 'c-todo'], ['Pass', tcBy('Pass'), 'c-done'], ['Fail', tcBy('Fail'), 'c-fail'], ['Blocked', tcBy('Blocked'), 'c-blocked']]} /> : <p className="muted">No test cases yet.</p>}</div>
      <div className="card"><h3>Priority breakdown</h3><p className="sub">How many issues sit at each priority.</p>
        {PRIORITIES.map((x) => <div key={x} className="barrow" title={`${x}: ${by('priority', x)}`}><span className="lbl"><PriorityIcon p={x} />{x}</span><div className="bar"><i style={{ width: `${(by('priority', x) / maxP) * 100}%` }} /></div><span className="num">{by('priority', x)}</span></div>)}</div>
      <div className="card"><h3>Recent activity</h3><p className="sub">Latest changes across the project.</p>
        {recent.length ? recent.map((h: Any) => (
          <div key={`${h.t.id}-${h.id}`} className="act-mini" onClick={() => openDrawer('issue', h.t.id)}><Avatar name={h.author} size={20} /><span><b>{h.author}</b> {historyText(h)} <span className="key">{h.t.key}</span> <span className="muted small">{ago(h.at)}</span></span></div>
        )) : <EmptyState compact icon={I.history} tone="neutral" title="No activity yet"><p>Changes to issues show up here.</p></EmptyState>}</div>
      <div className="card wide"><h3>Epic progress</h3><p className="sub">Done and in-progress issues per epic.</p>
        {p.epics.length ? <table className="tbl"><tbody>{p.epics.map((e: Any) => { const pr = epicProgress(e); return (
          <tr key={e.id} className="click" onClick={() => openDrawer('epic', e.id)}><td style={{ width: '40%' }}><ELoz e={e} /></td><td><ProgBar {...pr} /></td><td className="num muted" style={{ width: 110 }}>{pr.done} of {pr.total} done</td></tr>); })}</tbody></table> : <p className="muted">No epics yet.</p>}</div>
      <div className="card wide"><h3>About this project</h3>
        {p.description ? <p className="sub" style={{ whiteSpace: 'pre-wrap', color: 'var(--text)', fontSize: 14 }}>{p.description}</p>
          : <p className="sub">No project description yet. {can('project.settings') && <Link href={`/p/${p.id}/settings`} onClick={() => { S.setTab = 'details'; }}>Write one</Link>}</p>}</div>
      {(p.summary || p.assumptions?.length > 0 || p.openQuestions?.length > 0) && <div className="card wide"><h3>{p.sourceName ? <>Initial feature <span className="muted" style={{ fontWeight: 400 }}>· {p.sourceName}</span></> : 'Assumptions and open questions'}</h3>
        <p className="sub">{p.sourceName ? 'From the document this project was created from' : 'Recorded for this project'} · <Link href={`/p/${p.id}/settings`} onClick={() => { S.setTab = 'details'; }}>Edit</Link>{(p.sources || []).length > 0 && <> · <Link href={`/p/${p.id}/source`}>{p.sources.length} more document{p.sources.length === 1 ? '' : 's'}</Link></>}</p>
        {p.summary && <p style={{ margin: '0 0 16px', whiteSpace: 'pre-wrap' }}>{p.summary}</p>}
        <div className="grid2"><div><h3 style={{ fontSize: 14 }}>Assumptions <span className="count">{(p.assumptions || []).length}</span></h3><ReadList l={p.assumptions} /></div>
          <div><h3 style={{ fontSize: 14 }}>Open questions <span className="count">{(p.openQuestions || []).length}</span></h3><ReadList l={p.openQuestions} /></div></div></div>}
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
        {!compact && can('issue.edit') ? <RowStatus t={t} /> : <StatusLoz s={t.status} />}
        {!compact && can('issue.edit') ? <RowAssignee t={t} /> : <Avatar name={t.assignee} />}
        {!compact && <LayerChip layer={t.layer} short />}
        <span className="sp" title="Story points">{t.storyPoints ?? '–'}</span>
        <PriorityIcon p={t.priority} />
      </span>
    </div>
  );
}

/** Status lozenge that opens a menu of the statuses this issue may move to (respects custom workflow transitions). */
const RowStatus = ({ t }: { t: Any }) => (
  <SF loz className={`loz ${sCls(t.status)}`} aria-label={`Status of ${t.key}`} value={t.status}
    onClick={(e: Any) => e.stopPropagation()} onMouseDown={(e: Any) => e.stopPropagation()} draggable={false}
    onChange={(e: Any) => { if (e.target.value !== t.status) mutate(() => setField(t, 'status', e.target.value), { tag: `t.status${t.id}` }); }}>
    {opts(allowedStatuses(t))}
  </SF>
);

/** Assignee avatar that opens a menu of project people (plus Unassigned). */
const avatarSelect = { '&&': {
  width: 'auto', minWidth: 0,
  '& .MuiOutlinedInput-root': { height: 'auto', borderRadius: '50%' },
  '& .MuiSelect-select': { padding: '0 !important', minHeight: '0 !important', display: 'flex' },
  '& .MuiSelect-icon': { display: 'none' },
} };
function RowAssignee({ t }: { t: Any }) {
  const people = peopleNames();
  const list = t.assignee && !people.includes(t.assignee) ? [t.assignee, ...people] : people;
  const set = (v: string) => { if (v !== (t.assignee || '')) mutate(() => setField(t, 'assignee', v), { tag: `t.assignee${t.id}` }); };
  return (
    <SF bare sx={avatarSelect} aria-label={`Assignee of ${t.key}`} value={t.assignee || ''} renderValue={() => <Avatar name={t.assignee} />}
      onClick={(e: Any) => e.stopPropagation()} onMouseDown={(e: Any) => e.stopPropagation()} draggable={false} onChange={(e: Any) => set(e.target.value)}>
      <MenuItem value=""><Avatar size={20} /><span style={{ marginLeft: 8 }}>Unassigned</span></MenuItem>
      {list.map((n) => <MenuItem key={n} value={n}><Avatar name={n} size={20} /><span style={{ marginLeft: 8 }}>{n}</span></MenuItem>)}
    </SF>
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
  // With custom transitions, only issues allowed to move to that status change; the rest are reported.
  const bulkStatus = (to: string) => {
    const ok = ids.filter((id) => canMove(ticket(id), to));
    const skipped = ids.length - ok.length;
    if (ok.length) mutate(() => ok.forEach((id) => setField(ticket(id), 'status', to)));
    S.checked.clear(); emit();
    toast(skipped ? `${ok.length} issue${ok.length === 1 ? '' : 's'} set to ${to}. ${skipped} skipped: the workflow doesn’t allow moving ${skipped === 1 ? 'it' : 'them'} to ${to} from ${skipped === 1 ? 'its' : 'their'} current status.` : `${ok.length} issues set to ${to}`, skipped ? 'err' : undefined);
  };
  return (
    <div className="bulk">{ids.length} selected
      {can('sprint.manage') && <SF filter value="" onChange={(e) => e.target.value && bulkSet('sprintId', e.target.value === '__none' ? null : e.target.value, `moved to ${p.sprints.find((s: Any) => s.id === e.target.value)?.name || 'the backlog'}`)}>
        <MenuItem value="">Move to sprint…</MenuItem>{openSprints().map((s: Any) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}<MenuItem value="__none">Backlog</MenuItem></SF>}
      {(can('epic.manage') || can('issue.edit')) && <SF filter value="" onChange={(e) => e.target.value && bulkSet('epicId', e.target.value === '__none' ? null : e.target.value, `moved to ${epic(e.target.value)?.title || 'No epic'}`)}>
        <MenuItem value="">Move to epic…</MenuItem>{p.epics.map((x: Any) => <MenuItem key={x.id} value={x.id}>{x.title}</MenuItem>)}<MenuItem value="__none">No epic</MenuItem></SF>}
      {can('issue.edit') && <>
        <SF filter value="" onChange={(e) => e.target.value && bulkStatus(e.target.value)}><MenuItem value="">Set status…</MenuItem>{opts(statusNames())}</SF>
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
    <Header title="Backlog" right={can('ai.use') && can('issue.create') && <>
      <button className="btn ai" onClick={() => openModal(<FeatureModal />)} title="Plan new epics and issues from a description or document"><Ico svg={I.plus} />Add feature with AI</button>
      <button className="btn ai" onClick={() => openModal(<NewWithClaudeModal />)}><Ico svg={I.sparkle} />Write issue with AI</button></>} />
    <FilterBar group={{ value: S.groupBy, options: [['sprint', 'Sprint'], ['epic', 'Epic'], ['status', 'Status'], ['none', 'None']], onChange: (v) => { S.groupBy = v; saveUi(); emit(); } }} />
    <BulkBar />
    {groups.length ? groups.map((g: Any) => {
      const closed = S.collapsed.has(g.id);
      const s = g.sprint;
      return (
        <div key={g.id} className={`section ${g.kind === 'sprint' && !s ? 'backlog-sec' : ''}`} data-drop-status={g.kind === 'status' ? g.title : undefined} {...zoneDnd({ group: g.id })}>
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
    }) : filtersActive()
      ? <EmptyState compact icon={I.search} tone="neutral" title="No issues match your filters" actions={<button className="btn" onClick={() => { S.filter = EMPTY_FILTER(); emit(); }}>Clear filters</button>}><p>Try a different search, or clear the filters to see every issue.</p></EmptyState>
      : <EmptyState icon={I.backlog} title="Your backlog is empty" actions={can('issue.create') && <button className="btn primary" onClick={() => openCreateIssue()}><Ico svg={I.plus} />Create issue</button>}>
        <p>Create issues one by one, or start a project from a requirements document and Claude writes them for you.</p></EmptyState>}
    {S.groupBy === 'epic' && !filtersActive() && can('epic.manage') && <button className="inline-create" onClick={addEpic}><Ico svg={I.plus} />Create epic</button>}
  </>;
}

// ---------------------------------------------------------------- epics
/** Every AI action on the Epics page in one menu: planning, then the per-epic documents in workflow order. */
function EpicsAiMenu() {
  const p = P();
  if (!can('ai.use')) return null;
  const plan = can('issue.create'), manage = can('epic.manage');
  if (!plan && !manage) return null;
  const missing = (k: string) => p.epics.filter((x: Any) => !x[k]).length;
  const doc = (k: string, label: string, run: () => void) => {
    const n = missing(k);
    return <button disabled={!n} onClick={run}><Ico svg={I.doc} />{label}<small>{n ? `${n} missing` : 'all written'}</small></button>;
  };
  return (
    <Menu id="epics-ai" button={<button className="btn ai" aria-haspopup="menu" aria-expanded={S.menu === 'epics-ai'} onClick={() => setMenu('epics-ai')}><Ico svg={I.sparkle} />AI actions<Ico svg={I.chevron} /></button>}>
      {plan && <><div className="mh">Plan</div>
        <button onClick={() => openModal(<FeatureModal />)}><Ico svg={I.plus} />Add feature<small>New epics and issues</small></button></>}
      {manage && <>
        <button onClick={() => openModal(<RegroupModal />)}><Ico svg={I.sparkle} />Re-organize epics<small>Regroup issues</small></button>
        {p.epics.length > 0 && <><hr /><div className="mh">Write for epics without one</div>
          {doc('psd', 'Problem Statements', writeMissingPsds)}
          {doc('fbd', 'Feature Briefs', writeMissingFbds)}
          {doc('ard', 'Architecture Records', () => writeMissingDocs('ard'))}</>}
      </>}
    </Menu>
  );
}

export function Epics() {
  const p = P();
  return <>
    <Header title="Epics" right={<>
      <EpicsAiMenu />
      {can('epic.manage') && <button className="btn primary" onClick={addEpic}><Ico svg={I.plus} />Create epic</button>}
      <Link className="btn" href={`/p/${p.id}/timeline`}><Ico svg={I.calendar} />Timeline</Link></>} />
    {p.epics.length ? <>
      <table className="tbl"><thead><tr><th>Epic</th><th>Dates</th><th>Problem Statement</th><th>Feature Brief</th><th>Architecture Record</th><th>Progress</th><th className="num">Done</th><th className="num">Issues</th><th className="num">Story points</th><th className="num">Test cases</th></tr></thead><tbody>
        {p.epics.map((e: Any) => {
          const pr = epicProgress(e);
          return (
            <tr key={e.id} className="click" onClick={() => openDrawer('epic', e.id)}>
              <td><span className="row" style={{ flexWrap: 'nowrap' }}><TypeIcon type="Epic" /><span className="key">{e.key}</span><Swatch color={e.color} /><b style={{ fontWeight: 500 }}>{e.title}</b></span>
                {e.description && <div className="muted small" style={{ margin: '2px 0 0 24px', maxWidth: 560, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description}</div>}</td>
              <td className="small" style={{ whiteSpace: 'nowrap' }}>{(() => { const r = epicRange(e); return r ? <span className={r.derived ? 'muted' : ''} title={r.derived ? 'Estimated from its issues’ sprints' : undefined}>{fmtDate(`${r.start}T00:00:00`)} – {fmtDate(`${r.end}T00:00:00`)}</span> : <span className="muted">–</span>; })()}</td>
              <td className="small" style={{ whiteSpace: 'nowrap' }} onClick={(ev) => ev.stopPropagation()}>{psdBusy(e.id) ? <span className="muted"><Spinner /> Writing…</span>
                : e.psd ? <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><button className="link-btn psd-link" onClick={() => openPsd(e)}>{e.psd.version || 'v1.0'} · {e.psd.status || 'Draft'}</button>
                  {can('export') && <button className="icon-btn" title="Download .docx" aria-label={`Download the Problem Statement for ${e.title}`} onClick={() => downloadPsd(e)}><Ico svg={I.download} /></button>}</span>
                : can('ai.use') && can('epic.manage') ? <button className="link-btn psd-link" onClick={() => openWritePsd(e)}>Write with AI</button> : <span className="muted">–</span>}</td>
              <td className="small" style={{ whiteSpace: 'nowrap' }} onClick={(ev) => ev.stopPropagation()}>{fbdBusy(e.id) ? <span className="muted"><Spinner /> Writing…</span>
                : e.fbd ? <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><button className="link-btn psd-link" onClick={() => openFbd(e)}>{e.fbd.version || 'v1.0'} · {e.fbd.status || 'Draft'}</button>
                  {can('export') && <button className="icon-btn" title="Download .docx" aria-label={`Download the Feature Brief for ${e.title}`} onClick={() => downloadFbdDocx(e)}><Ico svg={I.download} /></button>}</span>
                : can('ai.use') && can('epic.manage') ? <button className="link-btn psd-link" onClick={() => openWriteFbd(e)}>Write with AI</button> : <span className="muted">–</span>}</td>
              <td className="small" style={{ whiteSpace: 'nowrap' }} onClick={(ev) => ev.stopPropagation()}>{docBusy('ard', e.id) ? <span className="muted"><Spinner /> Writing…</span>
                : e.ard ? <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><button className="link-btn psd-link" onClick={() => openDoc('ard', e)}>{e.ard.version || 'v1.0'} · {e.ard.status || 'Draft'}</button>
                  {can('export') && <button className="icon-btn" title="Download .docx" aria-label={`Download the Architecture Record Design for ${e.title}`} onClick={() => downloadDocDocx('ard', e)}><Ico svg={I.download} /></button>}</span>
                : can('ai.use') && can('epic.manage') ? <button className="link-btn psd-link" onClick={() => openWriteDoc('ard', e)}>Write with AI</button> : <span className="muted">–</span>}</td>
              <td style={{ width: 200 }}><ProgBar {...pr} /></td>
              <td className="num">{pr.total ? Math.round((pr.done / pr.total) * 100) : 0}%</td>
              <td className="num">{pr.total}</td><td className="num">{spSum(pr.ts)}</td><td className="num">{pr.ts.reduce((s: number, t: Any) => s + t.testCases.length, 0)}</td>
            </tr>
          );
        })}
      </tbody></table>
      {noEpic().length > 0 && <p className="muted small" style={{ marginTop: 12 }}>{noEpic().length} issues have no epic. <a href="#" onClick={(e) => { e.preventDefault(); S.filter = { ...EMPTY_FILTER(), epic: 'none' }; S.groupBy = 'epic'; S.nav(`/p/${p.id}/backlog`); }}>View them in the backlog</a></p>}
    </> : <EmptyState icon={I.epic} tone="epic" title="No epics yet" actions={can('epic.manage') && <button className="btn primary" onClick={addEpic}><Ico svg={I.plus} />Create epic</button>}>
      <p>Epics group related issues into larger pieces of work, so you can track progress feature by feature.</p></EmptyState>}
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
const RunLoz = ({ tc }: { tc: Any }) => (tc.lastRun ? <span className={`loz ${tCls(tc.lastRun.status)}`} title={`Automated run ${ago(tc.lastRun.at)} · ${(tc.lastRun.durationMs / 1000).toFixed(1)}s${tc.lastRun.attempts > 1 ? ` · passed on attempt ${tc.lastRun.attempts}` : ''}`}><Ico svg={I.bot} /> {tc.lastRun.status}{tc.lastRun.flaky ? ' · flaky' : ''}</span> : null);
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

const tcGroup = () => { try { return localStorage.getItem('tf.tcGroup') || 'feature'; } catch { return 'feature'; } };
type TcRow = { t: Any; tc: Any; i: number };
/** Pass / fail / not run counts for a set of test cases, as small lozenges. */
function TcCounts({ list }: { list: TcRow[] }) {
  const n = (s: string) => list.filter((x) => x.tc.status === s).length;
  const pass = n('Pass'), fail = n('Fail'), blocked = n('Blocked'), notRun = list.length - pass - fail - blocked;
  const auto = list.filter((x) => x.tc.script).length;
  return <span className="res-counts small">
    {pass > 0 && <span className="loz t-pass">{pass} passed</span>}{fail > 0 && <span className="loz t-fail">{fail} failed</span>}
    {blocked > 0 && <span className={`loz ${tCls('Blocked')}`}>{blocked} blocked</span>}{notRun > 0 && <span className="loz">{notRun} not run</span>}
    <span className="muted">{auto}/{list.length} automated</span></span>;
}
/** Test cases organized by feature (epic) and issue. Issues start collapsed unless a search or filter is on. */
function TestsGrouped({ rows, byFeature, filtered }: { rows: TcRow[]; byFeature: boolean; filtered: boolean }) {
  const p = P();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const issues = new Map<string, { t: Any; list: TcRow[] }>();
  for (const r of rows) { const g = issues.get(r.t.id); if (g) g.list.push(r); else issues.set(r.t.id, { t: r.t, list: [r] }); }
  const features: { key: string; epic: Any; issues: { t: Any; list: TcRow[] }[] }[] = [];
  if (byFeature) {
    for (const e of [...p.epics, null]) {
      const its = [...issues.values()].filter((g) => (e ? g.t.epicId === e.id : !p.epics.some((x: Any) => x.id === g.t.epicId)));
      if (its.length) features.push({ key: e ? e.id : 'none', epic: e, issues: its });
    }
  } else features.push({ key: 'all', epic: undefined, issues: [...issues.values()] });
  const isOpen = (k: string, dflt: boolean) => open[k] ?? dflt;
  const toggle = (k: string, dflt: boolean) => setOpen({ ...open, [k]: !isOpen(k, dflt) });
  const issueBlock = ({ t, list }: { t: Any; list: TcRow[] }) => {
    const dflt = filtered || list.some((x) => x.tc.status === 'Fail');
    const o = isOpen(`i:${t.id}`, dflt);
    return (
      <div key={t.id} className={`tg-issue ${list.some((x) => x.tc.status === 'Fail') ? 'has-fail' : ''}`}>
        <div className="res-head">
          <button type="button" className={`as-h ${o ? '' : 'closed'}`} aria-expanded={o} onClick={() => toggle(`i:${t.id}`, dflt)}>
            <Ico svg={I.chevron} /><TypeIcon type={t.type} /><span className="key">{t.key}</span><span className="res-title">{t.title}</span>
            <span className={`loz ${sCls(t.status)} tg-status`}>{t.status}</span></button>
          <TcCounts list={list} />
          <button className="icon-btn" title="Open the issue" aria-label={`Open ${t.key}`} onClick={() => openDrawer('issue', t.id)}><Ico svg={I.external} /></button>
          {can('test.run') && <button className="icon-btn" title={`Run ${list.length} test${list.length > 1 ? 's' : ''}`} aria-label={`Run ${t.key} tests`} onClick={() => runTests(list)}><Ico svg={I.play} /></button>}
        </div>
        {o && <table className="tbl res-tbl"><thead><tr><th>Key</th><th>Test case</th><th>Type</th><th>Covers</th><th>Automation</th><th>Result</th></tr></thead><tbody>
          {list.map(({ t, tc, i }) => (
            <tr key={tc.id} className="click" onClick={() => openTest(t, tc)}>
              <td className="key">{tcKey(t, i)}</td><td>{tc.title}</td>
              <td className="muted">{tc.type}</td>
              <td className="muted">{(tc.acRef || []).map((n: number) => `AC${n}`).join(', ') || '–'}</td>
              <td>{tc.lastRun ? <RunLoz tc={tc} /> : tc.script ? <span className="muted small"><Ico svg={I.bot} /> Script ready</span> : <span className="muted small">Manual</span>}</td>
              <td><TcStatusSelect t={t} tc={tc} /></td>
            </tr>))}
        </tbody></table>}
      </div>);
  };
  const allKeys = features.flatMap((f) => [`f:${f.key}`, ...f.issues.map((g) => `i:${g.t.id}`)]);
  const expandAll = (v: boolean) => setOpen(Object.fromEntries(allKeys.map((k) => [k, v])));
  return <>
    <div className="row tg-tools"><span className="muted small">{byFeature ? `${features.length} feature${features.length === 1 ? '' : 's'} · ` : ''}{issues.size} issue{issues.size === 1 ? '' : 's'} · {rows.length} test case{rows.length === 1 ? '' : 's'}</span>
      <span className="spacer" /><button className="btn sm subtle" onClick={() => expandAll(true)}>Expand all</button><button className="btn sm subtle" onClick={() => expandAll(false)}>Collapse all</button></div>
    {features.map((f) => {
      if (!byFeature) return <div key="all">{f.issues.map(issueBlock)}</div>;
      const list = f.issues.flatMap((g) => g.list);
      const o = isOpen(`f:${f.key}`, true);
      return (
        <section key={f.key} className="tg-feature">
          <div className="tg-feature-h">
            <button type="button" className={`as-h ${o ? '' : 'closed'}`} aria-expanded={o} onClick={() => toggle(`f:${f.key}`, true)}>
              <Ico svg={I.chevron} />{f.epic ? <><Swatch color={f.epic.color} /><span className="key">{f.epic.key}</span><b>{f.epic.title}</b></> : <b>No feature</b>}
              <span className="muted small">{f.issues.length} issue{f.issues.length === 1 ? '' : 's'}</span></button>
            <TcCounts list={list} />
            {f.epic && <button className="btn sm subtle" onClick={() => openDrawer('epic', f.epic.id)}>Open feature</button>}
            {can('test.run') && <button className="btn sm" onClick={() => runTests(list)}><Ico svg={I.play} />Run {list.length}</button>}
          </div>
          {o && <div className="tg-issues">{f.issues.map(issueBlock)}</div>}
        </section>);
    })}
  </>;
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
      <SF filter aria-label="Group by" value={tcGroup()} onChange={(e) => { try { localStorage.setItem('tf.tcGroup', e.target.value); } catch { /* private mode */ } emit(); }}>
        <MenuItem value="feature">Group by feature</MenuItem><MenuItem value="issue">Group by issue</MenuItem><MenuItem value="none">No grouping</MenuItem></SF>
    </div>
    {rows.length && tcGroup() !== 'none' ? <TestsGrouped rows={rows} byFeature={tcGroup() === 'feature'} filtered={Boolean(f.q.trim() || f.status || f.type)} />
    : rows.length ? <table className="tbl"><thead><tr><th>Key</th><th>Test case</th><th>Issue</th><th>Type</th><th>Covers</th><th>Automation</th><th>Result</th></tr></thead><tbody>
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
    </tbody></table> : all.length
      ? <EmptyState compact icon={I.search} tone="neutral" title="No test cases match your filters"
        actions={<button className="btn" onClick={() => { S.tcFilter = { q: '', status: '', type: '' }; emit(); }}>Clear filters</button>} />
      : <EmptyState icon={I.test} tone="success" title="No test cases yet" actions={<Link className="btn primary" href={`/p/${p.id}/backlog`}>Go to backlog</Link>}>
        <p>Select issues in the backlog and choose <b>Write test cases</b>, or open an issue and use <b>Regenerate test cases</b>. Claude plans them from the acceptance criteria.</p></EmptyState>}
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
          ))}</tbody></table> : <EmptyState compact icon={I.chart} tone="neutral" title="No sprints yet"
            actions={<Link className="btn" href={`/p/${p.id}/backlog`}>Go to backlog</Link>}><p>Create and complete sprints in the backlog to see velocity here.</p></EmptyState>}</div>
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

/** Results tab: test cases grouped under their issue, with counts, search and a Run button per issue. */
function ResultsList({ items, run }: { items: { t: Any; tc: Any; i: number }[]; run: Any }) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const needle = q.trim().toLowerCase();
  const shown = needle ? items.filter(({ t, tc, i }) => `${tcKey(t, i)} ${tc.title} ${t.key} ${t.title}`.toLowerCase().includes(needle)) : items;
  const groups: { t: Any; list: { t: Any; tc: Any; i: number }[] }[] = [];
  for (const it of shown) { const g = groups.find((x) => x.t.id === it.t.id); if (g) g.list.push(it); else groups.push({ t: it.t, list: [it] }); }
  // Many issues: start collapsed, except issues with failing tests (and when searching, everything that matches).
  const many = groups.length > 8 && !needle;
  const failing = (list: Any[]) => list.some((x) => x.tc.lastRun && x.tc.lastRun.status !== 'Pass');
  const isClosedG = (g: Any) => closed[g.t.id] ?? (many && !failing(g.list) && !g.list.some((x: Any) => run?.running && run.current === x.tc.id));
  const allClosed = groups.length > 0 && groups.every(isClosedG);
  if (!items.length) return <EmptyState compact icon={I.bot} tone="neutral" title="No test cases in this selection"
    actions={S.autoScope !== 'all' && <button className="btn" onClick={() => { S.autoScope = 'all'; emit(); }}>Show all test cases</button>}>
    <p>{S.autoScope === 'all' ? 'Add test cases to your issues first: select issues in the backlog and choose Write test cases.' : 'Pick a different set above.'}</p></EmptyState>;
  return <>
    <div className="toolbar results-tools">
      <TF value={q} placeholder={`Search ${items.length} test cases or issues`} onChange={(e) => setQ(e.target.value)} sx={{ flex: 1, maxWidth: 420 }} aria-label="Search test cases" />
      <span className="muted small">{groups.length} issue{groups.length === 1 ? '' : 's'} · {shown.length} test case{shown.length === 1 ? '' : 's'}</span>
      <button className="btn sm subtle" style={{ marginLeft: 'auto' }} onClick={() => setClosed(allClosed ? {} : Object.fromEntries(groups.map((g) => [g.t.id, true])))}>{allClosed ? 'Expand all' : 'Collapse all'}</button>
    </div>
    {!shown.length && <p className="muted small">No test case matches “{q}”.</p>}
    {groups.map(({ t, list }) => {
      const pass = list.filter((x) => x.tc.lastRun?.status === 'Pass').length;
      const fail = list.filter((x) => x.tc.lastRun && x.tc.lastRun.status !== 'Pass').length;
      const never = list.length - pass - fail;
      const scripted = list.filter((x) => x.tc.script).length;
      const isClosed = isClosedG({ t, list });
      return (
        <section key={t.id} className={`res-group ${fail ? 'has-fail' : ''}`}>
          <div className="res-head">
            <button type="button" className={`as-h ${isClosed ? 'closed' : ''}`} aria-expanded={!isClosed} onClick={() => setClosed({ ...closed, [t.id]: !isClosed })}>
              <Ico svg={I.chevron} /><TypeIcon type={t.type} /><span className="key">{t.key}</span><b className="res-title">{t.title}</b></button>
            <span className="res-counts small">
              {pass > 0 && <span className="loz t-pass">{pass} passed</span>}
              {fail > 0 && <span className="loz t-fail">{fail} failed</span>}
              {never > 0 && <span className="loz">{never} not run</span>}
              <span className="muted">{scripted}/{list.length} scripted</span>
            </span>
            <button className="btn sm subtle" onClick={() => openDrawer('issue', t.id)}>Open issue</button>
            {can('test.run') && <button className="btn sm" disabled={run?.running} onClick={() => runTests(list.map(({ t: tt, tc }) => ({ t: tt, tc })))}><Ico svg={I.play} />Run {list.length}</button>}
          </div>
          {!isClosed && <table className="tbl res-tbl"><thead><tr><th>Key</th><th>Test case</th><th>Script</th><th>Last run</th><th className="num">Duration</th><th /></tr></thead><tbody>
            {list.map(({ t, tc, i }) => {
              const running = run?.running && run.current === tc.id;
        return [
          <tr key={tc.id} className="click" onClick={() => openTest(t, tc)}>
            <td className="key">{tcKey(t, i)}</td><td>{tc.title}</td>
            <td>{tc.script ? <button className="btn sm subtle" onClick={(e) => { e.stopPropagation(); openModal(<ScriptModal tid={t.id} tcid={tc.id} />); }}><Ico svg={I.bot} />View</button> : <span className="muted small">Not written</span>}</td>
            <td>{running ? <span className="row small" style={{ gap: 6 }}><Spinner />Running</span> : tc.lastRun ? <><RunLoz tc={tc} /> <span className="muted small">{ago(tc.lastRun.at)}</span></> : <span className="muted small">Never</span>}</td>
            <td className="num muted">{tc.lastRun ? `${(tc.lastRun.durationMs / 1000).toFixed(1)}s` : '–'}</td>
            <td style={{ textAlign: 'right' }}>{can('test.run') && <button className="icon-btn" title="Run this test" disabled={run?.running} onClick={(e) => { e.stopPropagation(); runTests([{ t, tc }]); }}><Ico svg={I.play} /></button>}</td>
          </tr>,
          tc.lastRun?.status === 'Fail' && <tr key={`${tc.id}-err`} className="err-row"><td /><td colSpan={5}><div className="err-box">{tc.lastRun.error.split('\n').slice(0, 4).join('\n')}</div>
            {tc.lastRun.screenshot && <button type="button" className="shot-thumb sm" onClick={() => openModal(<ShotModal url={tc.lastRun.screenshot} title={`${tcKey(t, i)} ${tc.title}`} error={tc.lastRun.error} at={tc.lastRun.at} />)}>
              <img src={tc.lastRun.screenshot} alt={`Screenshot of the failed test ${tc.title}`} loading="lazy" /></button>}</td></tr>,
        ];
            })}
          </tbody></table>}
        </section>);
    })}
  </>;
}

const AUTO_TABS: [string, string, string][] = [['results', 'Results', I.play], ['failures', 'Failures', I.warn], ['setup', 'App setup', I.doc], ['settings', 'Settings', I.settings]];

export function Automation() {
  const p = P();
  const eng = S.engine, run = S.autoRun, act = activeSprint();
  const tab = AUTO_TABS.some(([k]) => k === S.autoTab) ? S.autoTab : 'results';
  const setTab = (k: string) => { S.autoTab = k; saveUi(); emit(); };
  const failing = p.tickets.reduce((n: number, t: Any) => n + t.testCases.filter((x: Any) => x.lastRun && x.lastRun.status !== 'Pass').length, 0);
  const items = automationItems(S.autoScope);
  const all = p.tickets.flatMap((t: Any) => t.testCases);
  const ran = all.filter((x: Any) => x.lastRun);
  return <>
    <Header title="Test automation" right={can('test.run') && (run?.running ? <button className="btn danger" onClick={() => run.ctrl?.abort()}><Ico svg={I.stop} />Stop</button>
      : <button className="btn primary" disabled={!items.length || !eng?.browser} onClick={() => runTests(items, { regenerate: S.autoRegen })}><Ico svg={I.play} />Run {items.length} test{items.length === 1 ? '' : 's'}</button>)} />
    <div className="tabbar auto-tabs" role="tablist" aria-label="Test automation">{AUTO_TABS.map(([k, label, icon]) => (
      <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
        <Ico svg={icon} />{label}{k === 'failures' && failing > 0 ? <span className="count bad">{failing}</span> : k === 'setup' ? <span className="count">{(p.automation.app?.pages || []).length}</span> : null}
      </button>))}</div>
    {tab === 'results' && <>
    {!p.automation.baseUrl && <div className="warn-banner" style={{ marginBottom: 12 }}><Ico svg={I.warn} /><span>Set the application URL so tests know where to run.</span>
      <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setTab('settings')}>Open Settings</button></div>}
    <div className="tiles">
      <Tile icon={I.bot} value={`${all.filter((x: Any) => x.script).length} / ${all.length}`} label="test cases automated" />
      <Tile icon={I.check} value={ran.filter((x: Any) => x.lastRun.status === 'Pass').length} label="passed last run" color="#22a06b" />
      <Tile icon={I.close} value={ran.filter((x: Any) => x.lastRun.status === 'Fail').length} label="failed last run" color="var(--danger)" />
      <Tile icon={I.clock} value={ran.length ? ago(ran.map((x: Any) => x.lastRun.at).sort().pop()) : 'Never'} label="last automated run" />
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
    <ResultsList items={items} run={run} />
    </>}
    {tab === 'failures' && <Failures />}
    {tab === 'setup' && <AppSetup />}
    {tab === 'settings' && <>
    <RunSettingsCard />
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="grid2" style={{ alignItems: 'end' }}>
        <label className="field" style={{ margin: 0 }}><span>Application URL — where the tests run</span>
          <TF value={p.automation.baseUrl || ''} disabled={!can('project.settings')} placeholder="e.g. http://localhost:3000 or https://staging.example.com"
            onChange={(e) => mutate((pp) => { pp.automation.baseUrl = e.target.value.trim(); }, { tag: 'baseUrl' })} /></label>
        <div className="small">{eng ? (eng.browser ? <span className="row" style={{ gap: 6 }}><span className="dot ok" />Ready: {eng.label} (Playwright {eng.version}).</span>
          : eng.serverless ? <span className="row" style={{ gap: 6, flexWrap: 'nowrap', alignItems: 'flex-start' }}><span className="dot bad" style={{ marginTop: 5 }} />
              <span>This server can’t run a browser (serverless hosting such as Vercel). {can('users.manage') ? 'Connect a remote browser below.' : 'Ask an administrator to connect a remote browser.'}</span></span>
          : <><span className="row" style={{ gap: 6 }}><span className="dot bad" />{eng.installed ? 'No test browser yet: Chromium isn’t installed, and Chrome or Edge wasn’t found.' : <>Playwright is not installed. Run <code>npm install</code>.</>}</span>
            {eng.installed && can('users.manage') && <button className="btn sm" style={{ marginTop: 6 }} onClick={installBrowser}>Install Chromium</button>}</>) : <span className="muted">Checking test engine…</span>}</div>
      </div>
      <p className="muted small" style={{ margin: '12px 0 0' }}>The AI writes a Playwright script for each test case from its steps, the issue&apos;s acceptance criteria, the App setup and snapshots of the app&apos;s pages, using your Claude account or, when that isn’t set up, the AI APIs connected in Administration. Scripts run headless in the test browser; you can read and edit every script. Results update each test case.</p>
      <div className="row" style={{ marginTop: 10, gap: 16 }}>
        <span className="small" style={{ fontWeight: 600, color: 'var(--text-subtle)' }}>When a test fails</span>
        <CB label="Comment on the issue" disabled={!can('project.settings')} checked={p.automation.onFail?.comment !== false}
          onChange={(e: Any) => mutate((pp) => { pp.automation.onFail = { ...(pp.automation.onFail || {}), comment: e.target.checked }; })} />
        <CB label="Notify the assignee (in-app and email)" disabled={!can('project.settings')} checked={p.automation.onFail?.notify !== false}
          onChange={(e: Any) => mutate((pp) => { pp.automation.onFail = { ...(pp.automation.onFail || {}), notify: e.target.checked }; })} />
      </div>
      <div className="row" style={{ marginTop: 4, gap: 16 }}>
        <span className="small" style={{ fontWeight: 600, color: 'var(--text-subtle)' }}>When all of an issue’s tests pass</span>
        <CB label="Comment on the issue" disabled={!can('project.settings')} checked={p.automation.onPass?.comment !== false}
          onChange={(e: Any) => mutate((pp) => { pp.automation.onPass = { ...(pp.automation.onPass || {}), comment: e.target.checked }; })} />
      </div>
      {can('users.manage') && <RemoteBrowser />}
    </div>
    </>}
  </>;
}

// ---------------------------------------------------------------- source & settings
/** An input that commits on blur (used where every keystroke would cascade, e.g. renames). */
export function CommitInput({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <TF key={value} defaultValue={value} onBlur={(e) => { if (e.target.value.trim() !== value) onCommit(e.target.value.trim()); }}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} {...rest} />;
}
export const lines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean);


// ---------------------------------------------------------------- failures (Test automation → Failures)
/** A failed test's screenshot, large. */
export function ShotModal({ url, title, error, at }: { url: string; title: string; error?: string; at?: string }) {
  return (
    <Modal title={title} wide actions={[{ label: 'Close' }]} left={<a className="btn subtle" href={url} target="_blank" rel="noopener noreferrer"><Ico svg={I.external} />Open full size</a>}>
      {at && <p className="muted small" style={{ marginTop: 0 }}>Failed {ago(at)} · {new Date(at).toLocaleString()}</p>}
      <a href={url} target="_blank" rel="noopener noreferrer" className="shot-big"><img src={url} alt={`Screenshot: ${title}`} /></a>
      {error && <pre className="err-box" style={{ marginTop: 12 }}>{error.split('\n').slice(0, 12).join('\n')}</pre>}
    </Modal>
  );
}

function FailureCard({ t, tc, i }: { t: Any; tc: Any; i: number }) {
  const p = P();
  const r = tc.lastRun;
  const [hist, setHist] = useState<Any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const title = `${tcKey(t, i)} ${tc.title}`;
  const loadHistory = async () => {
    if (hist) { setHist(null); return; }
    setLoading(true);
    try { setHist((await api(`/api/projects/${p.id}/screenshots?tc=${encodeURIComponent(tc.id)}`)).filter((x: Any) => x.url !== r.screenshot)); }
    catch (e: Any) { toast(e.message, 'err'); } finally { setLoading(false); }
  };
  return (
    <div className="fail-card">
      {r.screenshot
        ? <button type="button" className="shot-thumb" onClick={() => openModal(<ShotModal url={r.screenshot} title={title} error={r.error} at={r.at} />)}><img src={r.screenshot} alt={`Screenshot of the failed test ${tc.title}`} loading="lazy" /></button>
        : <div className="shot-thumb none"><Ico svg={I.warn} /><span className="small muted">No screenshot</span></div>}
      <div className="fail-body">
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><RunLoz tc={tc} /><span className="key">{tcKey(t, i)}</span><span className="muted small" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{ago(r.at)}</span></div>
        <b className="fail-title" title={tc.title}>{tc.title}</b>
        <button type="button" className="link-btn small fail-issue" onClick={() => openDrawer('issue', t.id)}><TypeIcon type={t.type} /> {t.key} {t.title}</button>
        {r.error && <pre className="err-box">{r.error.split('\n').slice(0, 5).join('\n')}</pre>}
        <div className="row" style={{ gap: 6, marginTop: 'auto' }}>
          {can('test.run') && <button className="btn sm" disabled={S.autoRun?.running} onClick={() => runTests([{ t, tc }])}><Ico svg={I.play} />Run again</button>}
          {tc.script && <button className="btn sm subtle" onClick={() => openModal(<ScriptModal tid={t.id} tcid={tc.id} />)}><Ico svg={I.bot} />Script</button>}
          <button className="btn sm subtle" style={{ marginLeft: 'auto' }} disabled={loading} onClick={loadHistory}>{loading ? <Spinner /> : hist ? 'Hide history' : 'Earlier failures'}</button>
        </div>
        {hist && (hist.length
          ? <div className="shot-strip">{hist.map((h) => (
              <button key={h.id} type="button" className="shot-thumb xs" title={`Failed ${new Date(h.created_at).toLocaleString()}`}
                onClick={() => openModal(<ShotModal url={h.url} title={title} error={h.error} at={h.created_at} />)}><img src={h.url} alt={`Earlier failure, ${new Date(h.created_at).toLocaleString()}`} loading="lazy" /></button>))}</div>
          : <p className="muted small" style={{ margin: '6px 0 0' }}>No earlier failures saved.</p>)}
      </div>
    </div>
  );
}

function Failures() {
  const p = P();
  const fails = p.tickets.flatMap((t: Any) => t.testCases.map((tc: Any, i: number) => ({ t, tc, i })))
    .filter((x: Any) => x.tc.lastRun && x.tc.lastRun.status !== 'Pass')
    .sort((a: Any, b: Any) => String(b.tc.lastRun.at).localeCompare(String(a.tc.lastRun.at)));
  if (!fails.length) {
    return <EmptyState icon={I.check} tone="success" title="No failing tests"><p>Tests that fail show up here with a screenshot of the page at the moment they failed.</p></EmptyState>;
  }
  return <>
    <p className="muted small" style={{ marginTop: 0 }}>{fails.length} test{fails.length === 1 ? '' : 's'} failed on the last run. Screenshots are saved in the database for people with access to this project (the last 5 per test).</p>
    <div className="fail-grid">{fails.map(({ t, tc, i }: Any) => <FailureCard key={tc.id} t={t} tc={tc} i={i} />)}</div>
  </>;
}

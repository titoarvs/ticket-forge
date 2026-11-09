'use client';
// Issue and epic detail panels.
import { useState } from 'react';
import {
  S, emit, P, ago, fmtDate, allowedStatuses, TYPES, PRIORITIES, TC_TYPES, TC_STATUS, LINK_TYPES, COLORS, epic, sprint, ticket, isSub, childrenOf, tcKey, spSum,
  statusNames, isDone, catOf, sCls, tCls, me, can, peopleNames, mutate, setField, logChange, logEvent, addMember, removeLink, addLink,
  clone, uid, newTest, historyText, openModal, toast, saveUi, setMenu, type Any,
} from './core';
import { Ico, I, TypeIcon, PriorityIcon, Avatar, StatusLoz, Swatch, Menu, AutoTextarea, Confirm, EmptyState } from './ui';
import {
  openDrawer, runTicketAi, AskModal, duplicateIssue, confirmDeleteIssue, convertToSubtask, createSubtask, linkPr, refreshPr,
  saveComment, runTests, DeleteEpicModal, CreateIssueModal, NewWithClaudeModal,
} from './actions';
import { epicProgress, ProgBar, setTcStatus, ShotModal } from './views';
import { epicRange, setEpicDates } from './Timeline';
import { CommentEditor, CommentBody } from './CommentEditor';
import { PsdSection } from './Psd';
import { codeReady, openCode } from './DevCode';
import { TF, TA, SF, CB, RB, DateF, PeopleF, MenuItem, opts } from './fields';

const prCls = (s: string) => ({ Open: 'pr-open', Merged: 'pr-merged', Declined: 'pr-declined', Draft: 'pr-draft' } as Any)[s] || 'pr-open';
const close = () => { S.drawer = null; S.full = false; emit(); };

function Head({ crumb, menu }: { crumb: React.ReactNode; menu: React.ReactNode }) {
  return (
    <div className="dr-head"><div className="dr-crumb">{crumb}</div><div className="spacer" />
      <Menu id="drawer" button={<button className="icon-btn" title="More actions" aria-label="More actions" onClick={() => setMenu('drawer')}><Ico svg={I.more} /></button>}>{menu}</Menu>
      <button className="icon-btn" title={S.full ? 'Collapse' : 'Expand'} aria-label={S.full ? 'Collapse' : 'Expand'} onClick={() => { S.full = !S.full; emit(); }}><Ico svg={S.full ? I.collapse : I.expand} /></button>
      <button className="icon-btn" title="Close (Esc)" aria-label="Close" onClick={close}><Ico svg={I.close} /></button>
    </div>
  );
}
const Crumb = ({ type, keyText, onClick }: { type: string; keyText: string; onClick?: () => void }) => (
  <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><TypeIcon type={type} />{onClick ? <a className="key link" onClick={onClick}>{keyText}</a> : <span className="key">{keyText}</span>}</span>
);

export function Drawer() {
  const t = S.drawer?.kind === 'issue' ? ticket(S.drawer.id) : null;
  const e = S.drawer?.kind === 'epic' ? epic(S.drawer.id) : null;
  if (!t && !e) return null;
  return <>
    {S.full && <div className="drawer-blanket" onClick={close} />}
    <aside className={`drawer ${S.full ? 'full' : ''} ${S.drawerW ? 'sized' : ''}`} style={S.drawerW ? { ['--drawer-w' as string]: `${S.drawerW}px` } : undefined}>
      {!S.full && <ResizeHandle />}
      {t ? <IssuePanel key={t.id} t={t} /> : <EpicPanel key={e.id} e={e} />}</aside>
  </>;
}

const DRAWER_MIN = 380;
/** Widest the panel may be: leave room for the list beside it. */
const drawerMax = (el: HTMLElement) => Math.max(DRAWER_MIN, (el.parentElement?.clientWidth || window.innerWidth) - 360);
const setDrawerW = (w: number | null) => { S.drawerW = w; saveUi(); emit(); };

/** Drag the panel's left edge to resize it; double-click resets. Arrow keys work too when it has focus. */
function ResizeHandle() {
  const start = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const handle = ev.currentTarget, aside = handle.parentElement as HTMLElement;
    const right = aside.getBoundingClientRect().right, max = drawerMax(aside);
    let w = aside.offsetWidth;
    handle.setPointerCapture(ev.pointerId);
    document.body.classList.add('resizing-x');
    aside.classList.add('sized');
    const move = (e: PointerEvent) => { w = Math.round(Math.min(max, Math.max(DRAWER_MIN, right - e.clientX))); aside.style.setProperty('--drawer-w', `${w}px`); };
    const end = () => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end);
      document.body.classList.remove('resizing-x');
      setDrawerW(w);
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  };
  const key = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    ev.preventDefault();
    const aside = ev.currentTarget.parentElement as HTMLElement;
    const step = ev.shiftKey ? 80 : 20;
    setDrawerW(Math.min(drawerMax(aside), Math.max(DRAWER_MIN, aside.offsetWidth + (ev.key === 'ArrowLeft' ? step : -step))));
  };
  return <div className="drawer-resize" role="separator" aria-orientation="vertical" aria-label="Resize panel" tabIndex={0}
    title="Drag to resize · double-click to reset" onPointerDown={start} onDoubleClick={() => setDrawerW(null)} onKeyDown={key} />;
}

// ---------------------------------------------------------------- issue
function IssuePanel({ t }: { t: Any }) {
  const p = P();
  const edit = can('issue.edit');
  const parent = isSub(t) ? ticket(t.parentId) : null;
  const e = epic((parent || t).epicId);
  const kids = isSub(t) ? [] : childrenOf(t);
  const uncovered = t.acceptanceCriteria.map((_: Any, i: number) => i + 1).filter((n: number) => !t.testCases.some((tc: Any) => (tc.acRef || []).includes(n)));
  const sprints = p.sprints.filter((s: Any) => s.state !== 'closed' || s.id === t.sprintId);
  const linkGroups = Object.keys(LINK_TYPES).map((type) => ({ type, items: t.links.filter((l: Any) => l.type === type && ticket(l.targetId)) })).filter((g) => g.items.length);
  const field = (k: string, v: Any) => mutate(() => setField(t, k, v), { tag: `t.${k}${t.id}` });
  const setAc = (i: number, v: string) => mutate(() => { const old = clone(t.acceptanceCriteria); t.acceptanceCriteria[i] = v; logChange(t, 'acceptanceCriteria', old, t.acceptanceCriteria); }, { tag: `ac${i}${t.id}` });
  const [sub, setSub] = useState('');
  const [link, setLink] = useState({ type: 'blocks', target: '' });
  const [pr, setPr] = useState('');
  const [prBusy, setPrBusy] = useState(false);

  const comments = [...t.comments].sort((a, b) => b.at.localeCompare(a.at));
  const history = [...t.history].sort((a, b) => b.at.localeCompare(a.at));
  const activity = S.actTab === 'history' ? history.map((h) => ({ kind: 'h', at: h.at, h }))
    : S.actTab === 'all' ? [...comments.map((c) => ({ kind: 'c', at: c.at, c })), ...history.map((h) => ({ kind: 'h', at: h.at, h }))].sort((a, b) => b.at.localeCompare(a.at))
      : comments.map((c) => ({ kind: 'c', at: c.at, c }));

  return <>
    <Head crumb={<>
      {e && <><Crumb type="Epic" keyText={e.key} onClick={() => openDrawer('epic', e.id)} /><span className="sep">/</span></>}
      {parent && <><Crumb type={parent.type} keyText={parent.key} onClick={() => openDrawer('issue', parent.id)} /><span className="sep">/</span></>}
      <Crumb type={t.type} keyText={t.key} />
    </>} menu={<>
      {can('issue.create') && <button onClick={() => duplicateIssue(t)}><Ico svg={I.copy} />Duplicate</button>}
      <button onClick={() => { navigator.clipboard?.writeText(t.key); toast(`Copied ${t.key}`); }}><Ico svg={I.copy} />Copy key</button>
      {edit && !isSub(t) && <button onClick={() => convertToSubtask(t)}><Ico svg={I.subtask} />Convert to sub-task…</button>}
      {can('issue.delete') && <><hr /><button style={{ color: 'var(--danger)' }} onClick={() => confirmDeleteIssue(t)}><Ico svg={I.trash} />Delete</button></>}
    </>} />
    <div className="dr-scroll">
      <TA title rows={1} aria-label="Summary" disabled={!edit} value={t.title} onChange={(ev) => field('title', ev.target.value.replace(/\n/g, ' '))} />
      <div className="dr-actions">
        <SF tone={catOf(t.status)} aria-label="Status" disabled={!edit} value={t.status} onChange={(ev) => field('status', ev.target.value)}>{opts(allowedStatuses(t))}</SF>
        {can('ai.use') && edit && <>
          <button className="btn ai" title="Improve the whole issue" onClick={() => runTicketAi(t, 'enhance')}><Ico svg={I.sparkle} />Enhance</button>
          <Menu id="ai" left button={<button className="btn ai" onClick={() => setMenu('ai')}><Ico svg={I.sparkle} />More Claude actions<Ico svg={I.chevron} /></button>}>
            <div className="mh">Claude</div>
            <button onClick={() => runTicketAi(t, 'ac')}>Improve acceptance criteria</button>
            <button onClick={() => runTicketAi(t, 'tests')}>Regenerate test cases</button>
            {!isSub(t) && <button onClick={() => runTicketAi(t, 'split')}>Split into smaller issues</button>}<hr />
            <button onClick={() => openModal(<AskModal t={t} />)}>Ask Claude to change this issue…</button>
          </Menu></>}
        {t.testCases.length > 0 && can('test.run') && <button className="btn" disabled={S.autoRun?.running} title="Run this issue's test cases in a browser" onClick={() => runTests(t.testCases.map((tc: Any) => ({ t, tc })))}><Ico svg={I.play} />Run tests</button>}
      </div>
      <div className="dr-cols">
        <div className="dr-main">
          <div className="sec"><div className="sec-title"><h3>Description</h3></div>
            <TA ghost disabled={!edit} value={t.description} placeholder="Add a description…" onChange={(ev) => field('description', ev.target.value)} /></div>
          <div className="sec"><div className="sec-title"><h3>User story</h3></div>
            <TA ghost disabled={!edit} value={t.userStory} placeholder="As a …, I want …, so that …" onChange={(ev) => field('userStory', ev.target.value)} /></div>

          <div className="sec"><div className="sec-title"><h3>Acceptance criteria</h3><span className="count">{t.acceptanceCriteria.length}</span>
            {edit && <div className="tools">
              <button className="btn sm subtle" onClick={() => mutate(() => { t.acceptanceCriteria.push(''); logChange(t, 'acceptanceCriteria', 0, 1); })}><Ico svg={I.plus} />Add</button>
              <button className="btn sm subtle" onClick={() => mutate(() => { t.acceptanceCriteria.push('Given , when , then '); logChange(t, 'acceptanceCriteria', 0, 1); })}><Ico svg={I.plus} />Given / When / Then</button></div>}</div>
            {t.acceptanceCriteria.map((a: string, i: number) => (
              <div key={i} className="ac"><span className="ac-n">AC{i + 1}</span>
                <TA ghost rows={1} style={{ minHeight: 32 }} disabled={!edit} value={a} onChange={(ev) => setAc(i, ev.target.value)} />
                {edit && <span className="ops">
                  <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => mutate(() => { const l = t.acceptanceCriteria; [l[i], l[i - 1]] = [l[i - 1], l[i]]; })}><Ico svg={I.up} /></button>
                  <button className="icon-btn" title="Move down" disabled={i === t.acceptanceCriteria.length - 1} onClick={() => mutate(() => { const l = t.acceptanceCriteria; [l[i], l[i + 1]] = [l[i + 1], l[i]]; })}><Ico svg={I.down} /></button>
                  <button className="icon-btn" title="Remove" onClick={() => mutate(() => { t.acceptanceCriteria.splice(i, 1); logChange(t, 'acceptanceCriteria', 1, 0); })}><Ico svg={I.trash} /></button></span>}
              </div>
            ))}
            {!t.acceptanceCriteria.length && <p className="muted small">No acceptance criteria yet.</p>}
          </div>

          {!isSub(t) && <div className="sec"><div className="sec-title"><Ico svg={I.subtask} /><h3>Child issues</h3><span className="count">{kids.length}</span>
            {can('issue.create') && <div className="tools"><button className="btn sm subtle" onClick={() => { S.subForm = true; emit(); }}><Ico svg={I.plus} />Add child issue</button></div>}</div>
            {kids.length > 0 && <>
              <div className="row small muted" style={{ marginBottom: 6, flexWrap: 'nowrap' }}><ProgBar done={kids.filter(isDone).length} prog={kids.filter((k: Any) => catOf(k.status) === 'inprogress').length} total={kids.length} />
                <span style={{ whiteSpace: 'nowrap' }}>{Math.round((kids.filter(isDone).length / kids.length) * 100)}% done</span></div>
              <div className="rows">{kids.map((k: Any) => <div key={k.id} className="irow" onClick={() => openDrawer('issue', k.id)}><TypeIcon type={k.type} /><span className="key">{k.key}</span><span className="sum">{k.title}</span><span className="right"><Avatar name={k.assignee} /><StatusLoz s={k.status} /></span></div>)}</div></>}
            {S.subForm && <div className="inline-form"><span style={{ padding: '0 4px' }}><TypeIcon type="Sub-task" /></span>
              <TF bare autoFocus placeholder="What needs to be done?" autoComplete="off" value={sub} onChange={(ev) => setSub(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); createSubtask(t, sub); setSub(''); } if (ev.key === 'Escape') { S.subForm = false; emit(); } }} />
              <button className="btn sm primary" onClick={() => { createSubtask(t, sub); setSub(''); }}>Create</button><button className="btn sm subtle" onClick={() => { S.subForm = false; emit(); }}>Cancel</button></div>}
            {!kids.length && !S.subForm && <p className="muted small">Break this issue into smaller pieces of work.</p>}
          </div>}

          <div className="sec"><div className="sec-title"><Ico svg={I.link} /><h3>Linked issues</h3><span className="count">{t.links.length}</span>
            {edit && <div className="tools"><button className="btn sm subtle" onClick={() => { S.linkForm = true; emit(); }}><Ico svg={I.plus} />Link issue</button></div>}</div>
            {linkGroups.map((g) => <div key={g.type}><div className="link-type">{g.type}</div><div className="rows">{g.items.map((l: Any) => { const o = ticket(l.targetId); return (
              <div key={l.id} className="irow" onClick={() => openDrawer('issue', o.id)}><TypeIcon type={o.type} /><span className="key">{o.key}</span><span className="sum">{o.title}</span>
                <span className="right"><StatusLoz s={o.status} /><PriorityIcon p={o.priority} />{edit && <button className="icon-btn" title="Remove link" onClick={(ev) => { ev.stopPropagation(); mutate(() => removeLink(t, l.id)); }}><Ico svg={I.close} /></button>}</span></div>); })}</div></div>)}
            {S.linkForm && <div className="inline-form" style={{ flexWrap: 'wrap' }}>
              <SF bare aria-label="Link type" value={link.type} onChange={(ev) => setLink({ ...link, type: ev.target.value })}>{opts(Object.keys(LINK_TYPES))}</SF>
              <SF bare aria-label="Issue" style={{ flex: 1, minWidth: 200 }} value={link.target} onChange={(ev) => setLink({ ...link, target: ev.target.value })}><MenuItem value="">Choose an issue…</MenuItem>
                {p.tickets.filter((x: Any) => x.id !== t.id).map((o: Any) => <MenuItem key={o.id} value={o.id}>{o.key} — {o.title.slice(0, 70)}</MenuItem>)}</SF>
              <button className="btn sm primary" onClick={() => {
                const target = ticket(link.target);
                if (!target) return toast('Choose an issue to link.', 'err');
                let ok = false;
                mutate(() => { ok = addLink(t, link.type, target); });
                S.linkForm = false; emit();
                toast(ok ? `${t.key} ${link.type} ${target.key}` : 'That link already exists.', ok ? 'ok' : 'err');
              }}>Link</button><button className="btn sm subtle" onClick={() => { S.linkForm = false; emit(); }}>Cancel</button></div>}
            {!t.links.length && !S.linkForm && <p className="muted small">Show which issues block, duplicate or relate to this one.</p>}
          </div>

          <div className="sec"><div className="sec-title"><TypeIcon type="Test" /><h3>Test cases</h3><span className="count">{t.testCases.length}</span>
            <div className="tools">
              {edit && <button className="btn sm subtle" onClick={() => { const n = newTest(); S.openTc.add(n.id); mutate(() => { t.testCases.push(n); logEvent(t, 'added a test case'); }); }}><Ico svg={I.plus} />Add</button>}
              <button className="btn sm subtle" onClick={() => { t.testCases.forEach((x: Any) => S.openTc.add(x.id)); emit(); }}>Expand all</button>
              <button className="btn sm subtle" onClick={() => { t.testCases.forEach((x: Any) => S.openTc.delete(x.id)); emit(); }}>Collapse all</button></div></div>
            {uncovered.length > 0 && t.testCases.length > 0 && <div className="warn-banner"><Ico svg={I.warn} /><span>Not covered by any test case: {uncovered.map((n: number) => `AC${n}`).join(', ')}</span></div>}
            {t.testCases.map((tc: Any, i: number) => <TestCase key={tc.id} t={t} tc={tc} i={i} />)}
            {!t.testCases.length && <p className="muted small">No test cases yet. Use “Regenerate test cases” to let Claude write them.</p>}
          </div>

          <div className="sec"><div className="sec-title"><Ico svg={I.pr} /><h3>Development</h3><span className="count">{t.prs.length}</span>
            {edit && <div className="tools">
              {can('ai.use') && (codeReady() ? <button className="btn sm ai" onClick={() => openCode(t)} title="Claude Code implements this issue in its own branch; you review the diff, then it opens the pull request"><Ico svg={I.sparkle} />Write code with AI</button>
                : can('project.settings') && <a className="btn sm subtle" href={`/p/${P().id}/settings`} onClick={() => { S.setTab = 'code'; }} title="Set up the local repository to write code with AI">Set up code with AI</a>)}
              <button className="btn sm subtle" onClick={() => { S.prForm = true; emit(); }}><Ico svg={I.plus} />Link pull request</button></div>}</div>
            {t.prs.map((r: Any) => (
              <div key={r.id} className="pr-row"><Ico svg={I.pr} /><div className="pr-main"><a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>
                <div className="muted small">{r.provider} · {r.repo}{r.number ? ` #${r.number}` : ''}{r.branch ? ` · ${r.branch} → ${r.base || ''}` : ''}{r.author ? ` · ${r.author}` : ''}{r.checkedAt ? ` · checked ${ago(r.checkedAt)}` : ''}</div></div>
                <span className={`loz ${prCls(r.status)}`}>{r.status}</span>
                {edit && <><button className="icon-btn" title="Refresh status" onClick={() => refreshPr(t, r.id)}><Ico svg={I.refresh} /></button>
                  <button className="icon-btn" title="Unlink" onClick={() => mutate(() => { t.prs = t.prs.filter((x: Any) => x.id !== r.id); logEvent(t, `unlinked pull request ${r.title}`); })}><Ico svg={I.close} /></button></>}
              </div>
            ))}
            {S.prForm && <div className="inline-form">
              <TF bare autoFocus placeholder="Paste a GitHub, GitLab or Bitbucket pull request URL" autoComplete="off" value={pr} onChange={(ev) => setPr(ev.target.value)}
                onKeyDown={async (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); setPrBusy(true); if (await linkPr(t, pr)) setPr(''); setPrBusy(false); } if (ev.key === 'Escape') { S.prForm = false; emit(); } }} />
              <button className="btn sm primary" disabled={prBusy} onClick={async () => { setPrBusy(true); if (await linkPr(t, pr)) setPr(''); setPrBusy(false); }}>{prBusy ? 'Looking up…' : 'Link'}</button>
              <button className="btn sm subtle" onClick={() => { S.prForm = false; emit(); }}>Cancel</button></div>}
            {!t.prs.length && !S.prForm && <p className="muted small">Link the pull requests that implement this issue to track their status here.</p>}
          </div>

          <div className="sec"><div className="sec-title"><h3>Dependency notes</h3></div>
            <TA ghost disabled={!edit} placeholder="One per line" key={t.dependencies.join('|')} defaultValue={t.dependencies.join('\n')}
              onBlur={(ev) => field('dependencies', ev.target.value.split('\n').map((s) => s.trim()).filter(Boolean))} /></div>

          <div className="sec"><div className="sec-title"><h3>Activity</h3></div>
            <div className="seg">{[['comments', 'Comments'], ['history', 'History'], ['all', 'All']].map(([v, l]) => <button key={v} className={S.actTab === v ? 'on' : ''} onClick={() => { S.actTab = v; saveUi(); emit(); }}>{l}</button>)}</div>
            {S.actTab !== 'history' && can('issue.comment') && <div className="composer"><Avatar name={me()} size={32} /><div style={{ flex: 1, minWidth: 0 }}>
              <CommentEditor key={t.id} compactUntilFocus placeholder="Add a comment…" onSave={(v) => saveComment(t, v)} /></div></div>}
            {activity.map((a: Any) => (a.kind === 'c' ? (
              <div key={a.c.id} className={`comment ${a.c.system ? 'auto' : ''}`}>{a.c.system ? <span className="avatar bot" title="Automation"><Ico svg={I.bot} /></span> : <Avatar name={a.c.author} size={32} />}<div style={{ flex: 1, minWidth: 0 }}>
                <div><b>{a.c.author}</b>{a.c.system && <span className="label-chip" style={{ marginLeft: 6 }}>Automated</span>} <span className="muted small">{ago(a.c.at)}{a.c.editedAt ? ' · edited' : ''}</span></div>
                {S.cmtEdit === a.c.id ? <CommentEditor value={a.c} autoFocus onCancel={() => { S.cmtEdit = null; emit(); }}
                    onSave={(v) => { S.cmtEdit = null; mutate(() => { a.c.body = v.text; a.c.doc = v.doc; a.c.attachments = v.attachments; a.c.editedAt = new Date().toISOString(); }); }} />
                  : <>{a.c.system ? <AutoBody c={a.c} t={t} /> : <CommentBody c={a.c} />}
                    {!a.c.system && (a.c.authorId ? a.c.authorId === S.user?.id : a.c.author === me()) && can('issue.comment') && <div className="row small" style={{ gap: 10, marginTop: 2 }}>
                      <a href="#" onClick={(ev) => { ev.preventDefault(); S.cmtEdit = a.c.id; emit(); }}>Edit</a>
                      <a href="#" onClick={(ev) => { ev.preventDefault(); openModal(<Confirm title="Delete this comment?" label="Delete" text="The comment is removed from the issue." onYes={() => mutate(() => { t.comments = t.comments.filter((x: Any) => x.id !== a.c.id); })} />); }}>Delete</a></div>}</>}
              </div></div>
            ) : (
              <div key={a.h.id} className="hist"><Avatar name={a.h.author} size={24} /><div><b>{a.h.author}</b> {historyText(a.h)} <span className="muted small">{ago(a.h.at)}</span>
                {a.h.from !== undefined && <div className="hist-change"><span>{a.h.from}</span> → <span>{a.h.to}</span></div>}</div></div>
            )))}
            {!activity.length && (S.actTab === 'history'
              ? <EmptyState compact icon={I.history} tone="neutral" title="No changes yet"><p>Edits to this issue are recorded here.</p></EmptyState>
              : <EmptyState compact icon={I.comment} tone="neutral" title="No comments yet"><p>Start the conversation about this issue below.</p></EmptyState>)}
          </div>
        </div>

        <div className="dr-side">
          <details className="details" open={S.detailsOpen} onToggle={(ev) => { S.detailsOpen = (ev.target as HTMLDetailsElement).open; saveUi(); }}>
            <summary>Details <Ico svg={I.chevron} /></summary>
            <div className="dgrid">
              <span className="label">Assignee</span>
              <div><span className="with-icon"><Avatar name={t.assignee} /><PeopleF ghost disabled={!edit} value={t.assignee || ''} placeholder="Unassigned" options={peopleNames()}
                onChange={(v) => field('assignee', v)} onCommit={(v) => v.trim() && mutate(() => addMember(v))} /></span>
                {edit && t.assignee !== me() && <a href="#" className="small" style={{ marginLeft: 34 }} onClick={(ev) => { ev.preventDefault(); mutate(() => { addMember(me()); setField(t, 'assignee', me()); }); }}>Assign to me</a>}</div>
              <span className="label">Reporter</span>
              <span className="with-icon"><Avatar name={t.reporter} /><PeopleF ghost disabled={!edit} value={t.reporter || ''} placeholder="None" options={peopleNames()} onChange={(v) => field('reporter', v)} /></span>
              <span className="label">Labels</span>
              <TF disabled={!edit} key={t.labels.join(',')} defaultValue={t.labels.join(', ')} placeholder="None" onBlur={(ev) => field('labels', ev.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
              <span className="label">Priority</span>
              <span className="with-icon"><PriorityIcon p={t.priority} /><SF disabled={!edit} value={t.priority} onChange={(ev) => field('priority', ev.target.value)}>{opts(PRIORITIES)}</SF></span>
              <span className="label">Story points</span>
              <TF type="number" min={0} disabled={!edit} value={t.storyPoints ?? ''} placeholder="None" onChange={(ev) => field('storyPoints', ev.target.value === '' ? null : Number(ev.target.value))} />
              <span className="label">Sprint</span>
              {isSub(t) ? <span className="muted" style={{ padding: '6px 8px' }}>{sprint(t.sprintId)?.name || 'None'} <span className="small">(from parent)</span></span>
                : <SF disabled={!edit && !can('sprint.manage')} value={t.sprintId || ''} onChange={(ev) => field('sprintId', ev.target.value || null)}><MenuItem value="">None</MenuItem>
                  {sprints.map((s: Any) => <MenuItem key={s.id} value={s.id}>{s.name}{s.state === 'active' ? ' (active)' : s.state === 'closed' ? ' (closed)' : ''}</MenuItem>)}</SF>}
              {isSub(t) ? <>
                <span className="label">Parent</span>
                <SF disabled={!edit} value={t.parentId} onChange={(ev) => mutate(() => { const par = ticket(ev.target.value); setField(t, 'parentId', ev.target.value); if (par) { t.epicId = par.epicId; t.sprintId = par.sprintId; } })}>
                  {p.tickets.filter((x: Any) => !isSub(x)).map((x: Any) => <MenuItem key={x.id} value={x.id}>{x.key} — {x.title.slice(0, 40)}</MenuItem>)}</SF>
              </> : <>
                <span className="label">Epic</span>
                <span className="with-icon" title={e?.title || undefined}>{e && <Swatch color={e.color} style={{ marginLeft: 4 }} />}<SF disabled={!edit && !can('epic.manage')} value={t.epicId || ''} onChange={(ev) => field('epicId', ev.target.value || null)}>
                  <MenuItem value="">None</MenuItem>{p.epics.map((x: Any) => <MenuItem key={x.id} value={x.id}>{x.title}</MenuItem>)}</SF></span>
                <span className="label">Issue type</span>
                <span className="with-icon"><TypeIcon type={t.type} /><SF disabled={!edit} value={t.type} onChange={(ev) => field('type', ev.target.value)}>{opts(TYPES)}</SF></span>
              </>}
              <span className="label">Development</span>
              <span className="dev-sum">{t.prs.length ? <><Ico svg={I.pr} /> {t.prs.length} pull request{t.prs.length > 1 ? 's' : ''} {[...new Set(t.prs.map((r: Any) => r.status))].map((s2: Any) => <span key={s2} className={`loz ${prCls(s2)}`}>{s2}</span>)}</>
                : edit ? <a href="#" className="small" onClick={(ev) => { ev.preventDefault(); S.prForm = true; emit(); }}>Link pull request</a> : <span className="muted">None</span>}</span>
              <span className="label">Tests</span>
              <span className="dev-sum">{t.testCases.length ? `${t.testCases.filter((x: Any) => x.status === 'Pass').length}/${t.testCases.length} passing · ${t.testCases.filter((x: Any) => x.script).length} automated` : <span className="muted">None</span>}</span>
            </div>
            <div className="dfoot muted small">Created {ago(t.createdAt)} · Updated {ago(t.updatedAt)}</div>
          </details>
        </div>
      </div>
    </div>
  </>;
}

const fmtMs = (ms: number) => (!ms ? '' : ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u || ''; } };

/** An automated test-run comment, made readable: a pass/fail summary, then each test with its error and screenshot. */
function AutoBody({ c, t }: { c: Any; t: Any }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Older comments only listed failures.
  const results: Any[] = c.results || (c.failures || []).map((f: Any) => ({ ...f, status: 'Fail' }));
  const failed = results.filter((r) => r.status !== 'Pass');
  const passed = results.length - failed.length;
  const ok = !failed.length;
  const mention = !ok && (c.body.match(/^@(.+?) \d+ (?:of \d+ )?automated/) || [])[1];
  const total = c.durationMs || results.reduce((n, r) => n + (r.durationMs || 0), 0);
  const rerun = () => runTests(failed.map((r) => ({ t, tc: t.testCases.find((x: Any) => x.id === r.tcId) })).filter((x) => x.tc));
  return (
    <div className={`run-card ${ok ? 'pass' : 'fail'}`}>
      <div className="run-head">
        <span className={`run-badge ${ok ? 'pass' : 'fail'}`}><Ico svg={ok ? I.check : I.warn} />{ok ? 'Passed' : 'Failed'}</span>
        <b>{ok ? `All ${results.length} test${results.length === 1 ? '' : 's'} passed` : `${failed.length} of ${results.length} test${results.length === 1 ? '' : 's'} failed`}</b>
        {mention && <span className="mention">@{mention}</span>}
        <span className="spacer" />
        {!ok && can('test.run') && <button className="btn sm" onClick={rerun}><Ico svg={I.play} />Re-run failed</button>}
      </div>
      <div className="run-bar" role="img" aria-label={`${passed} passed, ${failed.length} failed`}>
        {passed > 0 && <i className="p" style={{ flex: passed }} />}{failed.length > 0 && <i className="f" style={{ flex: failed.length }} />}</div>
      <div className="run-meta muted small">
        <span><Ico svg={I.check} className="ok" /> {passed} passed</span><span><Ico svg={I.close} className="bad" /> {failed.length} failed</span>
        {total > 0 && <span><Ico svg={I.clock} /> {fmtMs(total)}</span>}
        <span>Run by {c.runBy || 'a teammate'}</span>
        {c.baseUrl && <span title={c.baseUrl}>on <code>{hostOf(c.baseUrl)}</code></span>}
      </div>
      <ul className="run-list">
        {[...failed, ...results.filter((r) => r.status === 'Pass')].map((r) => {
          const bad = r.status !== 'Pass';
          const first = String(r.error || '').split('\n')[0];
          const more = bad && (String(r.error || '').length > first.length || r.screenshot);
          return <li key={r.tcId} className={bad ? 'bad' : 'good'}>
            <div className="run-row">
              <Ico svg={bad ? I.close : I.check} className={bad ? 'bad' : 'ok'} />
              <div className="run-main">
                <span className="run-title" title={r.title}>{r.title}</span>
                <span className="run-sub"><a href={`#tc-${r.tcId}`} className="key" onClick={(e) => { e.preventDefault(); S.openTc.add(r.tcId); emit(); setTimeout(() => document.getElementById(`tc-${r.tcId}`)?.scrollIntoView({ block: 'center' }), 50); }}>{r.key}</a>
                  {r.durationMs > 0 && <span className="run-ms">{fmtMs(r.durationMs)}</span>}</span>
              </div>
            </div>
            {bad && <div className="run-err">
              <code className="run-err-1">{first || 'Failed'}</code>
              {more && <button className="link-btn small" onClick={() => setOpen({ ...open, [r.tcId]: !open[r.tcId] })}>{open[r.tcId] ? 'Hide details' : 'Details'}</button>}
              {open[r.tcId] && <>
                {String(r.error || '').length > first.length && <pre className="run-err-full">{r.error}</pre>}
                {r.screenshot && <button className="run-shot" onClick={() => openModal(<ShotModal url={r.screenshot} title={`${r.key} ${r.title}`} error={r.error} at={c.at} />)}>
                  <img src={r.screenshot} alt={`Screenshot when ${r.key} failed`} loading="lazy" /></button>}
              </>}
            </div>}
          </li>;
        })}
      </ul>
    </div>
  );
}

function TestCase({ t, tc, i }: { t: Any; tc: Any; i: number }) {
  const edit = can('issue.edit');
  const open = S.openTc.has(tc.id);
  const running = S.autoRun?.running && S.autoRun.current === tc.id;
  const r = tc.lastRun;
  const set = (k: string, v: Any) => mutate(() => { const old = tc[k]; tc[k] = v; if (k !== 'script') logChange(t, 'testCases', old, v); }, { tag: `tc${tc.id}${k}` });
  const toggle = () => { if (open) S.openTc.delete(tc.id); else S.openTc.add(tc.id); emit(); };
  return (
    <div className="tc" id={`tc-${tc.id}`}>
      <div className={`tc-h ${open ? '' : 'closed'}`} onClick={(ev) => { if (!(ev.target as HTMLElement).closest('input,select,button,.MuiInputBase-root,.MuiMenuItem-root,.MuiBackdrop-root')) toggle(); }}>
        <Ico svg={I.chevron} /><span className="key">{tcKey(t, i)}</span>
        <TF aria-label="Test case title" disabled={!edit} value={tc.title} onChange={(ev) => set('title', ev.target.value)} />
        {running ? <span className="spinner" style={{ color: 'var(--brand)' }} title="Running" /> : tc.script ? <span className="muted" title="Automated"><Ico svg={I.bot} /></span> : null}
        {can('test.run') && <button className="icon-btn" title="Run automated test" disabled={S.autoRun?.running} onClick={() => runTests([{ t, tc }])}><Ico svg={I.play} /></button>}
        <SF loz className={`loz ${tCls(tc.status)}`} aria-label="Result" disabled={!can('test.run') && !edit} value={tc.status} onChange={(ev) => setTcStatus(t, tc, ev.target.value)}>{opts(TC_STATUS)}</SF>
      </div>
      {open && <div className="tc-b">
        <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
          <label className="field"><span>Type</span><SF disabled={!edit} value={tc.type} onChange={(ev) => set('type', ev.target.value)}>{opts(TC_TYPES.includes(tc.type) ? TC_TYPES : [tc.type, ...TC_TYPES])}</SF></label>
          <label className="field"><span>Priority</span><SF disabled={!edit} value={tc.priority} onChange={(ev) => set('priority', ev.target.value)}>{opts(['High', 'Medium', 'Low'])}</SF></label>
          <label className="field"><span>Covers AC #</span><TF disabled={!edit} key={(tc.acRef || []).join(',')} defaultValue={(tc.acRef || []).join(', ')} placeholder="e.g. 1, 3"
            onBlur={(ev) => set('acRef', ev.target.value.split(/[,\s]+/).map((s) => Number(s.replace(/\D/g, ''))).filter((n) => n > 0))} /></label>
          <label className="field"><span>Run as</span>
            <SF disabled={!edit} value={tc.roleId || ''} onChange={(ev) => set('roleId', ev.target.value || null)}>
              <MenuItem value="">Not signed in</MenuItem>
              {(P().automation?.app?.roles || []).filter((r: Any) => r.name).map((r: Any) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}
              {tc.roleId && !(P().automation?.app?.roles || []).some((r: Any) => r.id === tc.roleId) && <MenuItem value={tc.roleId}>Removed role</MenuItem>}
            </SF></label>
        </div>
        <label className="field"><span>Preconditions</span><TA style={{ minHeight: 32 }} disabled={!edit} value={tc.preconditions} onChange={(ev) => set('preconditions', ev.target.value)} /></label>
        <label className="field"><span>Steps — one per line</span><TA disabled={!edit} key={(tc.steps || []).join('|')} defaultValue={(tc.steps || []).join('\n')}
          onBlur={(ev) => set('steps', ev.target.value.split('\n').map((s) => s.trim()).filter(Boolean))} /></label>
        <label className="field"><span>Expected result</span><TA style={{ minHeight: 32 }} disabled={!edit} value={tc.expected} onChange={(ev) => set('expected', ev.target.value)} /></label>
        {r && <div className={`run-box ${tCls(r.status)}`}>
          <div className="row small"><span className={`loz ${tCls(r.status)}`}><Ico svg={I.bot} /> {r.status}</span><span className="muted">Automated run {ago(r.at)} · {(r.durationMs / 1000).toFixed(1)}s</span>
            {r.screenshot && <a href={r.screenshot} target="_blank" rel="noopener noreferrer"><Ico svg={I.external} /> Screenshot</a>}</div>
          {r.error && <pre className="err-box">{r.error}</pre>}
          {r.logs?.length > 0 && <details><summary className="small muted">Browser console ({r.logs.length})</summary><pre className="code small">{r.logs.join('\n')}</pre></details>}
        </div>}
        <details className="script-box"><summary className="small"><Ico svg={I.bot} /> Automation script {!tc.script && <span className="muted">(written by Claude on first run)</span>}</summary>
          <TA mono spellCheck={false} max={420} disabled={!can('test.run') && !edit} value={tc.script || ''} placeholder="// Body of async ({ page, expect, baseURL, app }) => { … }  e.g. await app.loginAs('Admin'); await app.goto('Orders');" onChange={(ev) => set('script', ev.target.value)} />
          {can('test.run') && can('ai.use') && <div className="row" style={{ marginTop: 6 }}><button className="btn sm" onClick={() => runTests([{ t, tc }], { regenerate: true })}><Ico svg={I.sparkle} />Rewrite with Claude and run</button></div>}
        </details>
        {edit && <div className="row" style={{ justifyContent: 'flex-end', margin: '8px 0' }}>
          <button className="btn sm subtle" onClick={() => { const n = { ...clone(tc), id: uid(), lastRun: null }; S.openTc.add(n.id); mutate(() => t.testCases.splice(i + 1, 0, n)); }}><Ico svg={I.copy} />Duplicate</button>
          <button className="btn sm danger-subtle" onClick={() => mutate(() => { const [x] = t.testCases.splice(i, 1); logEvent(t, `removed test case “${x.title}”`); })}><Ico svg={I.trash} />Remove</button></div>}
      </div>}
    </div>
  );
}

// ---------------------------------------------------------------- epic
function EpicPanel({ e }: { e: Any }) {
  const pr = epicProgress(e);
  const ed = can('epic.manage');
  const range = epicRange(e);
  return <>
    <Head crumb={<Crumb type="Epic" keyText={e.key} />} menu={ed ? <button style={{ color: 'var(--danger)' }} onClick={() => openModal(<DeleteEpicModal ep={e} />)}><Ico svg={I.trash} />Delete epic</button> : <span className="muted small" style={{ padding: '8px 16px', display: 'block' }}>No actions available</span>} />
    <div className="dr-scroll">
      <TA title rows={1} aria-label="Epic name" disabled={!ed} value={e.title} onChange={(ev) => mutate(() => { e.title = ev.target.value.replace(/\n/g, ' '); }, { tag: `e.title${e.id}` })} />
      <div className="dr-actions">
        {can('issue.create') && <button className="btn" onClick={() => openModal(<CreateIssueModal epicId={e.id} />)}><Ico svg={I.plus} />Create issue</button>}
        {can('issue.create') && can('ai.use') && <button className="btn ai" onClick={() => openModal(<NewWithClaudeModal epicId={e.id} />)}><Ico svg={I.sparkle} />Write issue with Claude</button>}
      </div>
      <div className="sec"><div className="sec-title"><h3>Description</h3></div>
        <TA ghost disabled={!ed} value={e.description} placeholder="Describe the goal of this epic…" onChange={(ev) => mutate(() => { e.description = ev.target.value; }, { tag: `e.desc${e.id}` })} /></div>
      <PsdSection epic={e} />
      <div className="sec"><div className="sec-title"><h3>Dates</h3>
        {range?.derived && <span className="muted small" style={{ marginLeft: 'auto' }}>Estimated from sprints: {fmtDate(`${range.start}T00:00:00`)} – {fmtDate(`${range.end}T00:00:00`)}</span>}</div>
        <div className="grid2 epic-dates">
          <label className="field"><span>Start date</span><DateF disabled={!ed} value={e.startDate || ''} onChange={(v) => setEpicDates(e, v, e.dueDate && v && e.dueDate < v ? v : e.dueDate || '')} /></label>
          <label className="field"><span>Due date</span><DateF disabled={!ed} value={e.dueDate || ''} onChange={(v) => setEpicDates(e, e.startDate && v && e.startDate > v ? v : e.startDate || '', v)} /></label>
        </div>
        <p className="muted small" style={{ margin: '6px 0 0' }}>Shown as a bar on the <a href={`/p/${P().id}/timeline`}>Timeline</a>.</p></div>
      <div className="sec"><div className="sec-title"><h3>Colour</h3></div>
        <div className="row">{COLORS.map((c) => <button key={c} className="icon-btn" disabled={!ed} aria-label={`Colour ${c}`} onClick={() => mutate(() => { e.color = c; })}
          style={{ width: 24, height: 24, borderRadius: 4, background: c, boxShadow: c === e.color ? '0 0 0 2px var(--bg), 0 0 0 4px var(--border-focus)' : 'none' }} />)}</div></div>
      <div className="sec"><div className="sec-title"><h3>Progress</h3><span className="muted small" style={{ marginLeft: 'auto' }}>{pr.done} of {pr.total} done · {spSum(pr.ts)} story points</span></div><ProgBar {...pr} /></div>
      <div className="sec"><div className="sec-title"><h3>Child issues</h3><span className="count">{pr.total}</span></div>
        {pr.total ? <div className="rows">{pr.ts.map((t: Any) => (
          <div key={t.id} className="irow" onClick={() => openDrawer('issue', t.id)}><TypeIcon type={t.type} /><span className="key">{t.key}</span><span className="sum">{t.title}</span><span className="right"><Avatar name={t.assignee} /><StatusLoz s={t.status} /><PriorityIcon p={t.priority} /></span></div>
        ))}</div> : <p className="muted small">No issues in this epic yet.</p>}</div>
    </div>
  </>;
}

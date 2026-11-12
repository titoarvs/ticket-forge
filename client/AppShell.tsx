'use client';
// Signed-in shell: loads the session, renders the top navigation, dialogs and notifications.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  S, emit, useStore, api, loadPrefs, startSync, saveNow, undo, redo, P, can, setMenu, openModal, ago, loadNotifs, markNotifsRead, toggleSidebar, hashColor, COLORS, type Any,
  loadFlags, setAiRun,
} from './core';
import { Ico, I, Menu, Avatar, Toasts, TaskTray, EmptyState, ErrorState, TypeIcon, TIER_NAME } from './ui';
import { AppSkeleton, NotifSkeleton } from './skeletons';
import { loadEngine, logout, exportAs, AiSettingsModal, openCreateIssue, openDrawer } from './actions';
import { AccountModal } from './Admin';
import { useThemeMode } from './theme';

const EXPORTS: (string[] | null)[] = [
  ['xlsx', 'Excel workbook', '.xlsx'], ['docx', 'Word document', '.docx'], ['pdf', 'PDF report', '.pdf'], ['html', 'HTML report', '.html'],
  null,
  ['csv', 'CSV — issues', '.csv'], ['csv-tests', 'CSV — test cases', '.csv'], ['csv-jira', 'CSV — Jira import', '.csv'],
  null,
  ['json', 'Project backup', '.json'],
];

/** Loads /api/auth/me once and the server status for signed-in users. */
export async function bootSession() {
  loadPrefs();
  S.bootError = null;
  try { S.auth = await api('/api/auth/me'); }
  catch (e: Any) { S.bootError = e; S.ready = true; emit(); return; } // server unreachable: show it, don't pretend to be signed out
  S.user = S.auth.user;
  if (S.user) { await loadFlags(); await refreshStatus(); loadEngine(); startSync(); loadNotifs(); }
  S.ready = true;
  emit();
}

/**
 * Reloads the AI connection status. A failed request never clears a status we already have; when there is none
 * yet, it tries again shortly (3 s, 10 s, 30 s) instead of leaving the pill empty until the next poll.
 */
let statusRetry: Any = null;
export async function refreshStatus(attempt = 0, fresh = false) {
  clearTimeout(statusRetry);
  if (fresh) { S.statusBusy = true; emit(); }
  try {
    // fresh: the server checks the Claude sign-in and AI settings again instead of answering from its cache.
    S.status = await api(`/api/status${fresh ? '?fresh=1' : ''}`);
    S.statusError = null; S.statusAt = Date.now();
  } catch (e: Any) {
    S.statusError = e?.message || 'Couldn’t check the AI connection';
    if (!S.status && attempt < 3) statusRetry = setTimeout(() => refreshStatus(attempt + 1), [3000, 10000, 30000][attempt]);
  } finally { S.statusBusy = false; }
  emit();
}
/** The AI can't be used right now, or is on a backup because the main one is limited. */
export const aiInactive = (st: Any) => !st || !st.ready || Boolean(st.switched);

function connInfo() {
  const st = S.status;
  if (!st) return { ok: false, label: S.statusError ? 'AI status unavailable' : 'Checking AI…', model: '', switched: false, unknown: true };
  const ok = Boolean(st.ready);
  const label = st.label || 'AI';
  const model = !ok ? '' : st.mode === 'account' && st.label === 'Claude account' && !st.routingOn ? (S.settings.model || st.model || '') : (st.model || '');
  return { ok, label, model, switched: Boolean(st.switched) };
}

/**
 * The AI menu in the top bar: which AI the app is using now (and why, when it's a backup), which AI runs your next AI
 * actions ("Runs on"), a way to check the connection again and the AI settings.
 */
function AiMenu() {
  const st = S.status;
  const c = connInfo();
  const unknown = 'unknown' in c;
  const cool = st?.account?.cooldown;
  const at = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
  const why = c.switched ? (cool ? `Claude ${/weekly/.test(cool.reason || '') ? 'weekly limit' : /daily/.test(cool.reason || '') ? 'daily limit' : 'limit'}${cool.until ? ` · back ${at(cool.until)}` : ''}` : 'Main AI unavailable') : '';
  const tone = unknown ? 'pending' : !c.ok ? 'bad' : c.switched ? 'warn' : 'ok';
  const name = unknown ? (S.statusError ? 'Status unavailable' : 'Checking…') : !c.ok ? 'Not connected' : c.label;
  const ch = st?.aiChoices;
  const run = S.aiRun || 'auto';
  const runs: [string, string, string][] = [
    ['auto', 'Auto', st?.routingOn ? 'per task (Model routing)' : (st?.model || '')],
    ...Object.keys(TIER_NAME).map((k): [string, string, string] => [k, TIER_NAME[k], ch?.tiers?.[k] || '']),
    ...(ch?.configs || []).map((x: Any): [string, string, string] => [`cfg:${x.id}`, x.name, x.model || '']),
  ];
  const runName = runs.find((r) => r[0] === run)?.[1] || 'Auto';
  const open = S.menu === 'ai';
  return (
    <Menu id="ai" button={
      <button className={`ai-pill t-${tone} ${open ? 'on' : ''}`} onClick={() => setMenu('ai')} aria-haspopup="menu" aria-expanded={open}
        title={c.switched ? `Using ${c.label} because your Claude account ${cool?.reason || 'is unavailable'}` : `AI: ${name}${c.model ? ` · ${c.model}` : ''} · runs on ${runName}`}>
        <span className={`dot ${tone}`} /><Ico svg={I.sparkle} className="ai-ic" />
        <span className="ai-name">{name}</span>
        {run !== 'auto' && <span className="ai-runtag">{runName}</span>}
        {c.switched && <span className="ai-backup">Backup</span>}
        <Ico svg={I.chevron} className="ai-chev" />
      </button>}>
      <div className="ai-menu-h" onClick={(e) => e.stopPropagation()}>
        <span className={`dot ${tone}`} />
        <div><b>{name}</b>{c.model && <code className="ai-model">{c.model}</code>}
          {c.switched && <p className="warn-text small">Backup: {why}. It switches back by itself.</p>}
          {!unknown && !c.ok && <p className="muted small">AI actions are off until an AI is connected.</p>}</div>
      </div>
      {can('ai.use') && <><hr /><div className="mh">Runs on <small className="muted">your next AI actions</small></div>
        {runs.map(([k, label, model]) => <button key={k} role="menuitemradio" aria-checked={run === k} onClick={() => setAiRun(k)}>
          <span className="radio-dot">{run === k && <Ico svg={I.check} />}</span>{label}{model && <small>{model}</small>}</button>)}</>}
      <hr />
      <button onClick={(e) => { e.stopPropagation(); refreshStatus(0, true); }} disabled={S.statusBusy}><Ico svg={I.refresh} className={S.statusBusy ? 'spin' : ''} />Check the connection again</button>
      <button onClick={() => openModal(<AiSettingsModal />)}><Ico svg={I.bot} />AI connection settings…</button>
      {can('users.manage') && <button onClick={() => S.nav('/admin/ai')}><Ico svg={I.settings} />Model routing and usage</button>}
    </Menu>
  );
}

/** Inside a project: its name, and a menu to jump to another project. */
export function ProjectSwitcher({ p }: { p: Any }) {
  const open = S.menu === 'projects';
  const load = async () => { if (!S.projectsLoaded) { try { S.projects = await api('/api/projects'); S.projectsLoaded = true; emit(); } catch { /* the menu shows what it has */ } } };
  const others = (S.projects || []).filter((x: Any) => x.id !== p.id);
  return (
    <Menu id="projects" left button={
      <button className={`proj-switch ${open ? 'on' : ''}`} onClick={() => { setMenu('projects'); load(); }} title="Switch project" aria-haspopup="menu" aria-expanded={open}>
        <span className="proj-avatar xs" style={{ background: hashColor(p.key, COLORS) }} aria-hidden>{String(p.key).slice(0, 2)}</span>
        <span className="proj-name">{p.name}</span><Ico svg={I.chevron} className="proj-chev" />
      </button>}>
      <div className="mh">Current project</div>
      <button onClick={() => S.nav(`/p/${p.id}/backlog`)}><span className="proj-avatar xs" style={{ background: hashColor(p.key, COLORS) }}>{String(p.key).slice(0, 2)}</span>{p.name}<small>{p.key}</small></button>
      {others.length > 0 && <><hr /><div className="mh">Switch to</div>
        {others.slice(0, 8).map((x: Any) => <button key={x.id} onClick={() => S.nav(`/p/${x.id}/backlog`)}><span className="proj-avatar xs" style={{ background: hashColor(x.key, COLORS) }}>{String(x.key).slice(0, 2)}</span>{x.name}<small>{x.key}</small></button>)}</>}
      <hr /><button onClick={() => S.nav('/')}><Ico svg={I.folder} />All projects</button>
    </Menu>
  );
}

/** Search in the top bar (⌘K): issues by key or summary inside a project, projects elsewhere. Enter opens the first match. */
function HeaderSearch({ inProject }: { inProject: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const qq = q.trim().toLowerCase();
  const loadProjects = async () => { if (!inProject && !S.projectsLoaded) { try { S.projects = await api('/api/projects'); S.projectsLoaded = true; emit(); } catch { /* shows what it has */ } } };
  type Hit = { id: string; key: string; title: string; go: () => void; icon: ReactNode; meta?: string };
  let hits: Hit[] = [];
  if (qq) {
    if (inProject) {
      const p = P();
      const scored = p.tickets.map((t: Any) => {
        const key = String(t.key).toLowerCase(), title = String(t.title).toLowerCase();
        const score = key === qq ? 0 : key.startsWith(qq) ? 1 : title.startsWith(qq) ? 2 : title.includes(qq) || key.includes(qq) ? 3 : -1;
        return { t, score };
      }).filter((x: Any) => x.score >= 0).sort((a: Any, b: Any) => a.score - b.score).slice(0, 8);
      hits = scored.map(({ t }: Any) => ({ id: t.id, key: t.key, title: t.title, icon: <TypeIcon type={t.type} />, meta: t.status, go: () => openDrawer('issue', t.id) }));
      hits.push(...p.epics.filter((e: Any) => `${e.key} ${e.title}`.toLowerCase().includes(qq)).slice(0, 3)
        .map((e: Any) => ({ id: e.id, key: e.key, title: e.title, icon: <TypeIcon type="Epic" />, meta: 'Epic', go: () => openDrawer('epic', e.id) })));
    } else {
      hits = (S.projects || []).filter((x: Any) => `${x.key} ${x.name}`.toLowerCase().includes(qq)).slice(0, 8)
        .map((x: Any) => ({ id: x.id, key: x.key, title: x.name, icon: <span className="proj-avatar xs" style={{ background: hashColor(x.key, COLORS) }}>{String(x.key).slice(0, 2)}</span>, meta: 'Project', go: () => S.nav(`/p/${x.id}/backlog`) }));
    }
  }
  const pick = (h?: Hit) => { if (!h) return; h.go(); setQ(''); setOpen(false); (document.activeElement as HTMLElement)?.blur(); };
  return (
    <div className="tn-search" ref={ref}>
      <Ico svg={I.search} className="tn-search-ic" />
      <input id="tn-search" type="search" autoComplete="off" placeholder={inProject ? 'Search issues' : 'Search projects'} aria-label={inProject ? 'Search issues by key or summary' : 'Search projects'}
        value={q} onFocus={() => { setOpen(true); loadProjects(); }} onBlur={() => setOpen(false)} onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); pick(hits[active]); }
          else if (e.key === 'Escape') { e.stopPropagation(); setQ(''); setOpen(false); (e.target as HTMLElement).blur(); }
        }} />
      <kbd className="tn-kbd" aria-hidden>⌘K</kbd>
      {open && qq && <div className="tn-results" role="listbox">
        {hits.length ? hits.map((h, i) => (
          <button key={h.id} role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)}>
            {h.icon}<span className="key">{h.key}</span><span className="tn-r-title">{h.title}</span>{h.meta && <small>{h.meta}</small>}</button>
        )) : <p className="muted small tn-none">Nothing matches “{q.trim()}”.</p>}
      </div>}
    </div>
  );
}

/**
 * The top bar, left to right: the app and its main pages, where you are (project switcher), search and Create;
 * then this project's save state, undo/redo and export; then the AI, notifications and your account.
 */
export function TopNav() {
  const pathname = usePathname();
  const p = P();
  const { mode, toggle } = useThemeMode();
  // Only once the project in the address has loaded (not the previous one while switching).
  const inProject = Boolean(pathname.startsWith('/p/') && p && p.id === decodeURIComponent(pathname.split('/')[2] || ''));
  const inAdmin = pathname.startsWith('/admin');
  const saving = /Saving/.test(S.saveText), failed = /failed/i.test(S.saveText);
  return (
    <header className="topnav">
      <div className="tn-left">
        <Link className="brand" href="/" title="All projects"><span className="brand-mark" dangerouslySetInnerHTML={{ __html: I.logo }} /><span className="hide-md">TicketForge</span></Link>
        <nav className="tn-nav" aria-label="Main">
          <Link className={`navlink ${!pathname.startsWith('/p/') && !inAdmin ? 'active' : ''}`} href="/"><Ico svg={I.folder} /><span className="hide-sm">Projects</span></Link>
          {can('users.manage') && <Link className={`navlink hide-sm ${inAdmin ? 'active' : ''}`} href={S.user?.isOwner ? '/admin/users' : '/admin/ai'}><Ico svg={I.settings} />Administration</Link>}
        </nav>
        {inProject && <><span className="tn-sep" aria-hidden>/</span><ProjectSwitcher p={p} /></>}
      </div>
      <div className="tn-center">
        <HeaderSearch inProject={inProject} />
        {(inProject ? can('issue.create') : can('project.create')) && (
          <button className="btn primary tn-create" title={inProject ? 'Create issue (C)' : 'Create project'}
            onClick={() => (inProject ? openCreateIssue() : S.nav('/new'))}><Ico svg={I.plus} /><span className="hide-sm">{inProject ? 'Create' : 'New project'}</span></button>
        )}
      </div>
      <div className="tn-right">
        {inProject && <div className="tn-group tn-edit">
          <span className={`save-state ${saving ? 'saving' : failed ? 'failed' : 'saved'}`} title={S.saveText || 'All changes saved'} role="status">
            {saving ? <span className="spinner sm" /> : <Ico svg={failed ? I.warn : I.check} />}<span className="hide-md">{S.saveText || 'Saved'}</span></span>
          <button className="icon-btn" title="Undo (⌘Z)" aria-label="Undo" disabled={!S.undo.length} onClick={undo}><Ico svg={I.undo} /></button>
          <button className="icon-btn" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!S.redo.length} onClick={redo}><Ico svg={I.redo} /></button>
          {can('export') && (
            <Menu id="export" button={<button className="icon-btn" title="Export" aria-label="Export" onClick={() => setMenu('export')}><Ico svg={I.download} /></button>}>
              <div className="mh">Download as</div>
              {EXPORTS.map((x, i) => (x ? <button key={x[0]} onClick={() => exportAs(x[0])}>{x[1]}<small>{x[2]}</small></button> : <hr key={i} />))}
            </Menu>
          )}
        </div>}
        <AiMenu />
        <Notifications />
        <Menu id="account" button={<button className="me-chip" aria-label="Account menu" title={`${S.user.name}: account`} onClick={() => setMenu('account')}><Avatar name={S.user.name} /><Ico svg={I.chevron} className="me-chev hide-sm" /></button>}>
          <div className="acct"><Avatar name={S.user.name} size={36} /><div><b>{S.user.name}</b><span className="muted small">{S.user.email}</span><span className="label-chip">{S.user.roleName}{S.user.isOwner ? ' · Owner' : ''}</span></div></div><hr />
          {can('users.manage') && <>
            <button onClick={() => S.nav(S.user?.isOwner ? '/admin/users' : '/admin/ai')}><Ico svg={I.people} />Administration</button>
            {S.user?.isOwner && <button onClick={() => S.nav('/admin/invites')}><Ico svg={I.plus} />Invite people</button>}
            <hr />
          </>}
          <button onClick={() => openModal(<AccountModal />)}><Ico svg={I.settings} />Your account &amp; password</button>
          <button onClick={(e) => { e.stopPropagation(); toggle(); }}><Ico svg={mode === 'dark' ? I.sun : I.moon} />{mode === 'dark' ? 'Light theme' : 'Dark theme'}</button>
          <hr />
          <button onClick={logout}><Ico svg={I.external} />Log out</button>
        </Menu>
      </div>
    </header>
  );
}

function Notifications() {
  const { items, unread } = S.notifs;
  const open = (n: Any) => {
    if (!n.read_at) markNotifsRead([n.id]);
    if (n.link) S.nav(n.link);
  };
  return (
    <Menu id="notifs" button={
      <button className="icon-btn bell" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`} title="Notifications" onClick={() => { setMenu('notifs'); loadNotifs(); }}>
        <Ico svg={I.bell} />{unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>}>
      <div className="notif-head"><b>Notifications</b>{unread > 0 && <button className="link-btn small" onClick={(e) => { e.stopPropagation(); markNotifsRead(); }}>Mark all as read</button>}</div>
      <div className="notif-list">
        {!S.notifsLoaded ? (S.notifsError
          ? <div onClick={(e) => e.stopPropagation()}><ErrorState compact title="Couldn’t load notifications" onRetry={loadNotifs} /></div>
          : <NotifSkeleton />)
        : items.length ? items.map((n: Any) => (
          <button key={n.id} className={`notif ${n.read_at ? '' : 'unread'}`} onClick={() => open(n)}>
            <span className="notif-ic"><Ico svg={n.kind === 'test-failed' ? I.bot : I.bell} /></span>
            <span className="notif-txt"><b>{n.title}</b><span className="muted small">{n.body}</span><span className="muted small">{ago(n.created_at)}</span></span>
            {!n.read_at && <span className="notif-dot" aria-label="Unread" />}
          </button>
        )) : <EmptyState compact icon={I.bell} tone="success" title="You’re all caught up"><p>Failed tests on your issues and other updates for you show up here.</p></EmptyState>}
      </div>
    </Menu>
  );
}

/** The server didn't answer when the app started. */
export function ServerDown() {
  return (
    <ErrorState title="Can’t reach TicketForge" error={S.bootError}
      onRetry={async () => { await bootSession(); if (S.bootError) throw new Error('Still can’t reach the server.'); }}>
      <p>The server didn’t respond. It may be restarting; try again in a moment.</p>
    </ErrorState>
  );
}

function RunPill() {
  const r = S.autoRun;
  if (!r?.running) return null;
  return (
    <div id="runPill"><span className="spinner" />
      <button className="link-btn" onClick={() => P() && S.nav(`/p/${P().id}/automation`)}>Running tests {r.done}/{r.total} · {r.pass} passed · {r.fail} failed</button>
      <button className="btn sm" onClick={() => r.ctrl?.abort()}><Ico svg={I.stop} />Stop</button>
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  useStore();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => { S.nav = (h: string) => router.push(h); }, [router]);
  useEffect(() => {
    // Links from the previous version used hash routes (/#/invite/…, /#/reset/…, /#/p/…).
    const legacy = location.hash.match(/^#(\/(?:invite|reset|p|admin|new)\b.*)$/);
    if (legacy) { router.replace(legacy[1]); return; }
    if (!S.ready) bootSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!S.ready || S.bootError) return;
    if (S.auth?.setupRequired) router.replace('/setup');
    else if (!S.user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [S.ready, S.user, pathname, router]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement).closest?.('input,textarea,select,[contenteditable],[role=combobox],[role=listbox]');
      if (S.modal) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !inField && P()) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && P()) { e.preventDefault(); saveNow(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { const f = document.getElementById('tn-search'); if (f) { e.preventDefault(); f.focus(); } return; }
      if (e.key === 'Escape') {
        if (S.pop) { S.pop = null; emit(); return; }
        if (S.menu) { S.menu = null; emit(); return; }
        if (S.full) { S.full = false; emit(); return; }
        if (S.drawer && !inField) { S.drawer = null; emit(); }
        return;
      }
      if (!inField && !e.metaKey && !e.ctrlKey && !e.altKey && P() && location.pathname.startsWith('/p/')) {
        if (e.key === 'c') { e.preventDefault(); openCreateIssue(); }
        if (e.key === '/') { const f = document.getElementById('fq') || document.getElementById('tq'); if (f) { e.preventDefault(); f.focus(); } }
        if (e.key === '[') { e.preventDefault(); toggleSidebar(); }
      }
    };
    const onUnload = () => { if (P() && S.saveTimer) saveNow(); };
    const poll = setInterval(() => { if (document.visibilityState === 'visible') loadNotifs(); }, 30000);
    // Keep the AI pill current (e.g. when TicketForge switches to a backup provider).
    const statusPoll = setInterval(() => { if (document.visibilityState === 'visible' && S.user) { refreshStatus(); loadFlags(); } }, 60000);
    // Coming back to the tab: refresh what may be stale (status at most every 20 s).
    const onFocus = () => { loadNotifs(); if (S.user && Date.now() - (S.statusAt || 0) > 20000) refreshStatus(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); window.removeEventListener('focus', onFocus); clearInterval(poll); clearInterval(statusPoll); };
  }, []);

  if (S.bootError) return <main id="app"><div className="page"><ServerDown /></div><Toasts /></main>;
  if (!S.ready || !S.user) return <AppSkeleton />;
  return (
    <>
      <TopNav />
      <main id="app">{children}</main>
      {S.modal as Any}
      <Toasts />
      <TaskTray />
      <RunPill />
    </>
  );
}


'use client';
// Signed-in shell: loads the session, renders the top navigation, dialogs and notifications.
import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  S, emit, useStore, api, loadPrefs, startSync, saveNow, undo, redo, P, can, setMenu, openModal, ago, loadNotifs, markNotifsRead, toggleSidebar, hashColor, COLORS, type Any,
  loadFlags,
} from './core';
import { Ico, I, Menu, Avatar, Toasts, TaskTray, EmptyState, ErrorState } from './ui';
import { AppSkeleton, NotifSkeleton } from './skeletons';
import { loadEngine, logout, exportAs, AiSettingsModal, openCreateIssue } from './actions';
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

/** The AI the app is using right now, why (when it's a backup), and a way to check again. */
function AiStatus() {
  const st = S.status;
  const c = connInfo();
  const unknown = 'unknown' in c;
  const cool = st?.account?.cooldown;
  const at = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
  const why = c.switched ? (cool ? `Claude ${/weekly/.test(cool.reason || '') ? 'weekly limit' : /daily/.test(cool.reason || '') ? 'daily limit' : 'limit'}${cool.until ? ` · back ${at(cool.until)}` : ''}` : 'Main AI unavailable') : '';
  const tone = unknown ? 'pending' : !c.ok ? 'bad' : c.switched ? 'warn' : 'ok';
  const title = unknown ? (S.statusError ? `Couldn’t check the AI connection (${S.statusError}). Retrying.` : 'Checking the AI connection…')
    : !c.ok ? 'The AI isn’t connected. Open AI settings.'
    : c.switched ? `Your Claude account ${cool?.reason || 'is unavailable'}${cool?.until ? ` until ${at(cool.until)}` : ''}, so TicketForge is using ${c.label}${c.model ? ` (${c.model})` : ''}. It switches back by itself.`
    : `AI: ${c.label}${c.model ? ` · ${c.model}` : ''}`;
  return (
    <div className={`ai-pill t-${tone}`}>
      <button className="ai-main" onClick={() => openModal(<AiSettingsModal />)} title={title} aria-label={title}>
        <span className={`dot ${tone}`} />
        <span className="ai-tag">AI</span>
        <span className="ai-name">{unknown ? (S.statusError ? 'Status unavailable' : 'Checking…') : !c.ok ? 'Not connected' : c.label}</span>
        {c.model && <span className="ai-model">{c.model}</span>}
        {c.switched && <span className="ai-backup" title={why}>Backup{why ? <span className="ai-why">· {why}</span> : null}</span>}
      </button>
      {aiInactive(S.status) && <button className="ai-refresh" onClick={() => refreshStatus(0, true)} disabled={S.statusBusy}
        title="Check the AI connection again" aria-label="Check the AI connection again"><Ico svg={I.refresh} className={S.statusBusy ? 'spin' : ''} /></button>}
    </div>
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

export function TopNav() {
  const pathname = usePathname();
  const p = P();
  // Only once the project in the address has loaded (not the previous one while switching).
  const inProject = pathname.startsWith('/p/') && p && p.id === decodeURIComponent(pathname.split('/')[2] || '');
  const inAdmin = pathname.startsWith('/admin');
  return (
    <header className="topnav">
      <div className="tn-left">
        <Link className="brand" href="/" title="All projects"><span className="brand-mark" dangerouslySetInnerHTML={{ __html: I.logo }} /><span className="hide-sm">TicketForge</span></Link>
        <nav className="tn-nav" aria-label="Main">
          <Link className={`navlink ${!pathname.startsWith('/p/') && !inAdmin ? 'active' : ''}`} href="/"><Ico svg={I.folder} />Projects</Link>
          {can('users.manage') && <Link className={`navlink hide-sm ${inAdmin ? 'active' : ''}`} href={S.user?.isOwner ? '/admin/users' : '/admin/ai'}><Ico svg={I.settings} />Administration</Link>}
        </nav>
        {inProject && <><span className="tn-sep" aria-hidden>/</span><ProjectSwitcher p={p} /></>}
        {(inProject ? can('issue.create') : can('project.create')) && (
          <button className="btn primary tn-create" title={inProject ? 'Create issue (C)' : 'Create project'}
            onClick={() => (inProject ? openCreateIssue() : S.nav('/new'))}><Ico svg={I.plus} /><span className="hide-sm">{inProject ? 'Create' : 'New project'}</span></button>
        )}
      </div>
      <div className="spacer" />
      <div className="tn-right">
        {inProject && <div className="tn-group tn-edit">
          <span className="save-state hide-sm">{S.saveText}</span>
          <button className="icon-btn" title="Undo (⌘Z)" aria-label="Undo" disabled={!S.undo.length} onClick={undo}><Ico svg={I.undo} /></button>
          <button className="icon-btn" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!S.redo.length} onClick={redo}><Ico svg={I.redo} /></button>
          {can('export') && (
            <Menu id="export" button={<button className="btn sm tn-export" onClick={() => setMenu('export')}><Ico svg={I.download} /><span className="hide-sm">Export</span></button>}>
              <div className="mh">Download as</div>
              {EXPORTS.map((x, i) => (x ? <button key={x[0]} onClick={() => exportAs(x[0])}>{x[1]}<small>{x[2]}</small></button> : <hr key={i} />))}
            </Menu>
          )}
        </div>}
        <AiStatus />
        <div className="tn-group">
          <ThemeToggle />
          <Notifications />
        </div>
        <Menu id="account" button={<button className="me-chip" aria-label="Account menu" title={`${S.user.name} — account`} onClick={() => setMenu('account')}><Avatar name={S.user.name} /><span className="me-name hide-md">{S.user.name.split(' ')[0]}</span><Ico svg={I.chevron} className="me-chev hide-md" /></button>}>
          <div className="acct"><b>{S.user.name}</b><span className="muted small">{S.user.email}</span><span className="label-chip">{S.user.roleName}{S.user.isOwner ? ' · Owner' : ''}</span></div><hr />
          {can('users.manage') && <>
            <button onClick={() => S.nav(S.user?.isOwner ? '/admin/users' : '/admin/ai')}><Ico svg={I.people} />Administration</button>
            <button onClick={() => S.nav('/admin/invites')}><Ico svg={I.plus} />Invite people</button>
          </>}
          <button onClick={() => openModal(<AiSettingsModal />)}><Ico svg={I.bot} />AI connection</button>
          <button onClick={() => openModal(<AccountModal />)}><Ico svg={I.settings} />Your account &amp; password</button><hr />
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
      if (e.key === 'Escape') {
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

function ThemeToggle() {
  const { mode, toggle } = useThemeMode();
  const next = mode === 'dark' ? 'light' : 'dark';
  return <button className="icon-btn theme-btn" onClick={toggle} title={`Switch to ${next} theme`} aria-label={`Switch to ${next} theme`}>
    <Ico svg={mode === 'dark' ? I.sun : I.moon} /></button>;
}

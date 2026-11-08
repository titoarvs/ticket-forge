'use client';
// Signed-in shell: loads the session, renders the top navigation, dialogs and notifications.
import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  S, emit, useStore, api, loadPrefs, startSync, saveNow, undo, redo, P, can, setMenu, openModal, ago, loadNotifs, markNotifsRead, type Any,
} from './core';
import { Ico, I, Menu, Avatar, Toasts, BusyPill, EmptyState, ErrorState } from './ui';
import { AppSkeleton, NotifSkeleton } from './skeletons';
import { loadEngine, logout, exportAs, AiSettingsModal, openCreateIssue } from './actions';
import { AccountModal } from './Admin';

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
  if (S.user) { S.status = await api('/api/status').catch(() => null); loadEngine(); startSync(); loadNotifs(); }
  S.ready = true;
  emit();
}

function connInfo() {
  const st = S.status;
  if (!st) return { ok: false, label: 'AI', model: '', switched: false };
  const ok = Boolean(st.ready);
  const label = st.label || 'AI';
  const model = !ok ? '' : st.mode === 'account' && st.label === 'Claude account' ? (S.settings.model || st.model || '') : (st.model || '');
  return { ok, label, model, switched: Boolean(st.switched) };
}

function TopNav() {
  const pathname = usePathname();
  const p = P();
  // Only once the project in the address has loaded (not the previous one while switching).
  const inProject = pathname.startsWith('/p/') && p && p.id === decodeURIComponent(pathname.split('/')[2] || '');
  const inAdmin = pathname.startsWith('/admin');
  const c = connInfo();
  return (
    <header className="topnav">
      <Link className="brand" href="/" title="All projects"><span className="brand-mark" dangerouslySetInnerHTML={{ __html: I.logo }} />TicketForge</Link>
      <Link className={`navlink ${!pathname.startsWith('/p/') && !inAdmin ? 'active' : ''}`} href="/">Projects</Link>
      {inProject && <Link className="navlink active hide-sm" href={`/p/${p.id}/backlog`}>{p.name}</Link>}
      {can('users.manage') && <Link className={`navlink hide-sm ${inAdmin ? 'active' : ''}`} href="/admin/users">Administration</Link>}
      {(inProject ? can('issue.create') : can('project.create')) && (
        <button className="btn primary" style={{ marginLeft: 8 }} title={inProject ? 'Create issue (C)' : 'Create project'}
          onClick={() => (inProject ? openCreateIssue() : S.nav('/new'))}><Ico svg={I.plus} />Create</button>
      )}
      <div className="spacer" />
      {inProject && <>
        <span className="save-state">{S.saveText}</span>
        <button className="icon-btn" title="Undo (⌘Z)" disabled={!S.undo.length} onClick={undo}><Ico svg={I.undo} /></button>
        <button className="icon-btn" title="Redo (⇧⌘Z)" disabled={!S.redo.length} onClick={redo}><Ico svg={I.redo} /></button>
        {can('export') && (
          <Menu id="export" style={{ margin: '0 4px' }} button={<button className="btn" onClick={() => setMenu('export')}><Ico svg={I.download} />Export</button>}>
            <div className="mh">Download as</div>
            {EXPORTS.map((x, i) => (x ? <button key={x[0]} onClick={() => exportAs(x[0])}>{x[1]}<small>{x[2]}</small></button> : <hr key={i} />))}
          </Menu>
        )}
      </>}
      <Notifications />
      <button className="conn" onClick={() => openModal(<AiSettingsModal />)} title={c.switched ? 'Your main AI is limited right now, so TicketForge switched to a backup' : 'AI connection'}>
        <span className={`dot ${S.status ? (c.ok ? (c.switched ? 'warn' : 'ok') : 'bad') : ''}`} />{c.label}{c.model ? ` · ${c.model}` : ''}{c.switched ? ' · backup' : ''}
      </button>
      <Menu id="account" button={<button className="me-chip" aria-label="Account menu" title={`${S.user.name} — account`} onClick={() => setMenu('account')}><Avatar name={S.user.name} /></button>}>
        <div className="acct"><b>{S.user.name}</b><span className="muted small">{S.user.email}</span><span className="label-chip">{S.user.roleName}{S.user.isOwner ? ' · Owner' : ''}</span></div><hr />
        {can('users.manage') && <>
          <button onClick={() => S.nav('/admin/users')}><Ico svg={I.people} />Administration</button>
          <button onClick={() => S.nav('/admin/invites')}><Ico svg={I.plus} />Invite people</button>
        </>}
        <button onClick={() => openModal(<AccountModal />)}><Ico svg={I.settings} />Your account &amp; password</button><hr />
        <button onClick={logout}><Ico svg={I.external} />Log out</button>
      </Menu>
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
      }
    };
    const onUnload = () => { if (P() && S.saveTimer) saveNow(); };
    const poll = setInterval(() => { if (document.visibilityState === 'visible') loadNotifs(); }, 30000);
    // Keep the AI pill current (e.g. when TicketForge switches to a backup provider).
    const statusPoll = setInterval(() => { if (document.visibilityState === 'visible' && S.user) api('/api/status').then((st) => { S.status = st; emit(); }).catch(() => {}); }, 60000);
    const onFocus = () => loadNotifs();
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
      <BusyPill />
      <RunPill />
    </>
  );
}

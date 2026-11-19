'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  P,
  S,
  can,
  undo,
  redo,
  setMenu,
  openModal,
  isDeployed,
  runPlace,
  setRunPlace,
  toast,
  emit,
  type Any,
  markNotifsRead,
  loadNotifs,
  ago,
} from '../core';
import { I, Ico, Menu, Avatar, ErrorState, EmptyState } from '../ui';
import { NotifSkeleton } from '../skeletons';
import { openCreateIssue, exportAs, logout } from '../actions';
import { AccountModal } from '../Admin';
import { MyAiModal } from '../MyAi';
import { useThemeMode } from '../theme';
import { startTourHere, resetTours } from '../tour';
import { WorkspaceSwitcher } from '../WorkspaceSwitcher';
import { ProjectSwitcher, HeaderSearch } from './ProjectSwitcher';
import { EXPORTS, AiMenu } from './set-local-engine';

/**
 * The top bar, left to right: the app and its main pages, where you are (project switcher), search
 * and Create; then this project's save state, undo/redo and export; then the AI, notifications and
 * your account.
 */
export function TopNav() {
  const pathname = usePathname();
  const p = P();
  const { mode, toggle } = useThemeMode();
  // Only once the project in the address has loaded (not the previous one while switching).
  const inProject = Boolean(
    pathname.startsWith('/p/') && p && p.id === decodeURIComponent(pathname.split('/')[2] || ''),
  );
  const inAdmin = pathname.startsWith('/admin');
  const saving = /Saving/.test(S.saveText),
    failed = /failed/i.test(S.saveText);
  return (
    <header className="topnav">
      <div className="tn-left">
        <Link className="brand" href="/projects" title="All projects">
          <span className="brand-mark" dangerouslySetInnerHTML={{ __html: I.logo }} />
          <span className="hide-md">TicketForge</span>
        </Link>
        <WorkspaceSwitcher />
        <nav className="tn-nav" aria-label="Main">
          <Link
            className={`navlink ${!pathname.startsWith('/p/') && !inAdmin ? 'active' : ''}`}
            href="/projects"
            title="Projects"
            aria-label="Projects"
          >
            <Ico svg={I.folder} />
            <span className="tn-txt hide-sm">Projects</span>
          </Link>
          {can('users.manage') && (
            <Link
              className={`navlink hide-sm ${inAdmin ? 'active' : ''}`}
              href={S.user?.isOwner ? '/admin/users' : '/admin/ai'}
              title="Administration"
              aria-label="Administration"
            >
              <Ico svg={I.settings} />
              <span className="tn-txt">Administration</span>
            </Link>
          )}
        </nav>
        {inProject && (
          <>
            <span className="tn-sep" aria-hidden>
              /
            </span>
            <ProjectSwitcher p={p} />
          </>
        )}
      </div>
      <div className="tn-center">
        <HeaderSearch inProject={inProject} />
        {(inProject ? can('issue.create') : can('project.create')) && (
          <button
            className="btn primary tn-create"
            data-tour="tn-create"
            title={inProject ? 'Create issue (C)' : 'Create project'}
            onClick={() => (inProject ? openCreateIssue() : S.nav('/new'))}
          >
            <Ico svg={I.plus} />
            <span className="hide-sm">{inProject ? 'Create' : 'New project'}</span>
          </button>
        )}
      </div>
      <div className="tn-right">
        {inProject && (
          <div className="tn-group tn-edit" data-tour="tn-edit">
            <span
              className={`save-state ${saving ? 'saving' : failed ? 'failed' : 'saved'}`}
              title={S.saveText || 'All changes saved'}
              role="status"
            >
              {saving ? <span className="spinner sm" /> : <Ico svg={failed ? I.warn : I.check} />}
              <span className="hide-md">{S.saveText || 'Saved'}</span>
            </span>
            <button
              className="icon-btn"
              title="Undo (⌘Z)"
              aria-label="Undo"
              disabled={!S.undo.length}
              onClick={undo}
            >
              <Ico svg={I.undo} />
            </button>
            <button
              className="icon-btn"
              title="Redo (⇧⌘Z)"
              aria-label="Redo"
              disabled={!S.redo.length}
              onClick={redo}
            >
              <Ico svg={I.redo} />
            </button>
            {can('export') && (
              <Menu
                id="export"
                button={
                  <button
                    className="icon-btn"
                    title="Export"
                    aria-label="Export"
                    onClick={() => setMenu('export')}
                  >
                    <Ico svg={I.download} />
                  </button>
                }
              >
                <div className="mh">Download as</div>
                {EXPORTS.map((x, i) =>
                  x ? (
                    <button key={x[0]} onClick={() => exportAs(x[0])}>
                      {x[1]}
                      <small>{x[2]}</small>
                    </button>
                  ) : (
                    <hr key={i} />
                  ),
                )}
              </Menu>
            )}
          </div>
        )}
        <AiMenu />
        <Notifications />
        <Menu
          id="account"
          button={
            <button
              className="me-chip"
              data-tour="account"
              aria-label="Account menu"
              title={`${S.user.name}: account`}
              onClick={() => setMenu('account')}
            >
              <Avatar name={S.user.name} />
              <Ico svg={I.chevron} className="me-chev hide-sm" />
            </button>
          }
        >
          <div className="acct">
            <Avatar name={S.user.name} size={36} />
            <div>
              <b>{S.user.name}</b>
              <span className="muted small">{S.user.email}</span>
              <span className="label-chip">
                {S.user.roleName}
                {S.user.isOwner ? ' · Owner' : ''}
              </span>
            </div>
          </div>
          <hr />
          {can('users.manage') && (
            <>
              <button onClick={() => S.nav(S.user?.isOwner ? '/admin/users' : '/admin/ai')}>
                <Ico svg={I.people} />
                Administration
              </button>
              {S.user?.isOwner && (
                <button onClick={() => S.nav('/admin/invites')}>
                  <Ico svg={I.plus} />
                  Invite people
                </button>
              )}
              <hr />
            </>
          )}
          <button onClick={() => openModal(<AccountModal />)}>
            <Ico svg={I.settings} />
            Your account &amp; password
          </button>
          <button onClick={() => openModal(<MyAiModal />)}>
            <Ico svg={I.sparkle} />
            My AI (your Claude subscription)
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
          >
            <Ico svg={mode === 'dark' ? I.sun : I.moon} />
            {mode === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <hr />
          {!isDeployed() && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const to = runPlace() === 'github' ? 'local' : 'github';
                setRunPlace(to);
                toast(
                  to === 'github'
                    ? 'Code jobs and test runs now run on GitHub Actions'
                    : 'Code jobs and test runs now run on this computer',
                );
              }}
              title="Where Write code with AI and test runs go (this browser only; the deployed app always uses GitHub Actions)"
            >
              <Ico svg={runPlace() === 'github' ? I.pr : I.folder} />
              {runPlace() === 'github'
                ? 'Code & tests: GitHub Actions'
                : 'Code & tests: this computer'}
            </button>
          )}
          <button
            onClick={() => {
              S.menu = null;
              emit();
              setTimeout(() => {
                if (!startTourHere()) toast('There’s no tour for this page.');
              }, 150);
            }}
          >
            <Ico svg={I.sparkle} />
            Show me around
          </button>
          <button
            onClick={async () => {
              S.menu = null;
              emit();
              await resetTours();
              toast('Tours will show again on each page.');
              setTimeout(startTourHere, 150);
            }}
          >
            <Ico svg={I.undo} />
            Restart all tours
          </button>
          <button onClick={() => window.open('/timeline', '_blank', 'noopener')}>
            <Ico svg={I.history} />
            What’s new: product timeline
          </button>
          <button onClick={() => window.open('/terms', '_blank', 'noopener')}>
            <Ico svg={I.doc} />
            Terms of Use
          </button>
          <button onClick={() => window.open('/privacy', '_blank', 'noopener')}>
            <Ico svg={I.doc} />
            Privacy Policy
          </button>
          <hr />
          <button onClick={logout}>
            <Ico svg={I.external} />
            Log out
          </button>
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
    <Menu
      id="notifs"
      button={
        <button
          className="icon-btn bell"
          data-tour="bell"
          aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
          title="Notifications"
          onClick={() => {
            setMenu('notifs');
            loadNotifs();
          }}
        >
          <Ico svg={I.bell} />
          {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
        </button>
      }
    >
      <div className="notif-head">
        <b>Notifications</b>
        {unread > 0 && (
          <button
            className="link-btn small"
            onClick={(e) => {
              e.stopPropagation();
              markNotifsRead();
            }}
          >
            Mark all as read
          </button>
        )}
      </div>
      <div className="notif-list">
        {!S.notifsLoaded ? (
          S.notifsError ? (
            <div onClick={(e) => e.stopPropagation()}>
              <ErrorState compact title="Couldn’t load notifications" onRetry={loadNotifs} />
            </div>
          ) : (
            <NotifSkeleton />
          )
        ) : items.length ? (
          items.map((n: Any) => (
            <button
              key={n.id}
              className={`notif ${n.read_at ? '' : 'unread'}`}
              onClick={() => open(n)}
            >
              <span className="notif-ic">
                <Ico svg={n.kind === 'test-failed' ? I.bot : I.bell} />
              </span>
              <span className="notif-txt">
                <b>{n.title}</b>
                <span className="muted small">{n.body}</span>
                <span className="muted small">{ago(n.created_at)}</span>
              </span>
              {!n.read_at && <span className="notif-dot" aria-label="Unread" />}
            </button>
          ))
        ) : (
          <EmptyState compact icon={I.bell} tone="success" title="You’re all caught up">
            <p>Failed tests on your issues and other updates for you show up here.</p>
          </EmptyState>
        )}
      </div>
    </Menu>
  );
}

'use client';
import { usePathname } from 'next/navigation';
import { P, S, can, undo, redo, setMenu, type Any, markNotifsRead, loadNotifs, ago } from '../core';
import { I, Ico, Menu, ErrorState, EmptyState } from '../ui';
import { NotifSkeleton } from '../skeletons';
import { openCreateIssue, exportAs } from '../actions';
import { HeaderSearch } from './ProjectSwitcher';
import { EXPORTS, AiMenu } from './set-local-engine';
import { MENU_BTN_ID, setDrawerOpen, useDrawerOpen, useSideMode } from './side-mode';

/** Phones: opens the sidebar as a drawer. */
function MenuButton() {
  const open = useDrawerOpen();
  if (useSideMode() !== 'phone') return null;
  return (
    <button
      type="button"
      id={MENU_BTN_ID}
      className="icon-btn side-menu-btn"
      onClick={() => setDrawerOpen(!open)}
      aria-label="Open navigation menu"
      aria-expanded={open}
      aria-controls={open ? 'side-drawer' : undefined}
      aria-haspopup="dialog"
    >
      <Ico svg={I.menu} />
    </button>
  );
}

function SaveState() {
  const saving = /Saving/.test(S.saveText),
    failed = /failed/i.test(S.saveText);
  return (
    <span
      className={`save-state ${saving ? 'saving' : failed ? 'failed' : 'saved'}`}
      title={S.saveText || 'All changes saved'}
      role="status"
    >
      {saving ? <span className="spinner sm" /> : <Ico svg={failed ? I.warn : I.check} />}
      <span className="tn-label">{S.saveText || 'Saved'}</span>
    </span>
  );
}

function ExportMenu() {
  return (
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
  );
}

/** This project's save state, undo, redo and export. */
function EditTools() {
  return (
    <div className="tn-group tn-edit" data-tour="tn-edit">
      <SaveState />
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
      {can('export') && <ExportMenu />}
    </div>
  );
}

/**
 * The bar over the page: search, then this project's save state, undo/redo and export, the AI,
 * notifications and Create. Where you are, the settings and your account are in the sidebar.
 */
export function TopNav() {
  const pathname = usePathname();
  const p = P();
  // Only once the project in the address has loaded (not the previous one while switching).
  const inProject = Boolean(
    pathname.startsWith('/p/') && p && p.id === decodeURIComponent(pathname.split('/')[2] || ''),
  );
  // Not on the pages that are about creating a project: they have their own button.
  const canCreate = inProject
    ? can('issue.create')
    : can('project.create') && !/^\/(projects|new)\b/.test(pathname);
  return (
    <header className="topnav">
      <MenuButton />
      <HeaderSearch inProject={inProject} />
      <div className="tn-right">
        {inProject && <EditTools />}
        <AiMenu />
        <Notifications />
        {canCreate && (
          <button
            className="btn primary tn-create"
            data-tour="tn-create"
            title={inProject ? 'Create issue (C)' : 'Create project'}
            onClick={() => (inProject ? openCreateIssue() : S.nav('/new'))}
          >
            <Ico svg={I.plus} />
            <span className="tn-label">{inProject ? 'Create' : 'New project'}</span>
          </button>
        )}
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

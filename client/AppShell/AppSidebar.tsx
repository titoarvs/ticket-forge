'use client';
// The sidebar on every signed-in page: the app, where you are (workspace, project), the links, the
// system settings and you. Full on desktops (it can be collapsed), icons on tablets, and a drawer on
// phones that the top bar's menu button opens.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { P, S, type Any, can, toggleSidebar } from '../core';
import { I, Ico } from '../ui';
import { useThemeMode } from '../theme';
import { VIEWS } from '../Workspace/views';
import { WorkspaceSwitcher } from '../WorkspaceSwitcher';
import { AccountCard, showAround } from './AccountCard';
import { ProjectSwitcher } from './ProjectSwitcher';
import { MainNav, NavSkeleton, ProjectNav, SideGroup, SideLink, type NavCtx } from './SideNav';
import { MENU_BTN_ID, setDrawerOpen, useDrawerOpen, useSideMode } from './side-mode';
import { hasRail, WorkspaceRail } from './WorkspaceRail';
import pkg from '../../package.json';

/** v<major.minor.patch>, read from package.json so it follows each release. */
const APP_VERSION = /^\d+\.\d+\.\d+/.test(pkg.version)
  ? `v${pkg.version.match(/^\d+\.\d+\.\d+/)![0]}`
  : '';

/** Where you are: the project in the address (once it has loaded) and its page. */
export function useWhere() {
  const pathname = usePathname();
  const [, root, rawId, rawView] = pathname.split('/');
  const inProject = root === 'p';
  const id = inProject ? decodeURIComponent(rawId || '') : '';
  const project: Any = inProject && P()?.id === id ? P() : null;
  return {
    pathname,
    project,
    loading: inProject && !project && S.projectError?.id !== id,
    // A code job's page (/p/<id>/code/<issue>) belongs under Code jobs.
    view: rawView === 'code' ? 'codejobs' : VIEWS[rawView] ? rawView : 'backlog',
  };
}

function ThemeRow({ ctx }: { ctx: NavCtx }) {
  const { mode, toggle } = useThemeMode();
  const dark = mode === 'dark';
  return (
    <button
      type="button"
      className="side-item"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      onClick={toggle}
      {...ctx.tip(dark ? 'Light mode' : 'Dark mode')}
    >
      <Ico svg={dark ? I.sun : I.moon} />
      <span className="side-text">Dark mode</span>
      <span className="switch" aria-hidden />
    </button>
  );
}

function SystemNav({ ctx, where }: { ctx: NavCtx; where: ReturnType<typeof useWhere> }) {
  const { project, view, pathname } = where;
  return (
    <SideGroup label="System" className="side-sys">
      <ThemeRow ctx={ctx} />
      {project && (
        <SideLink
          ctx={ctx}
          href={`/p/${project.id}/settings`}
          icon={I.settings}
          label="Project settings"
          active={view === 'settings'}
        />
      )}
      {can('users.manage') && (
        <SideLink
          ctx={ctx}
          href={S.user?.isOwner ? '/admin/users' : '/admin/ai'}
          icon={I.people}
          label="Administration"
          active={pathname.startsWith('/admin')}
        />
      )}
      <button
        type="button"
        className="side-item"
        onClick={showAround}
        {...ctx.tip('Show me around')}
      >
        <Ico svg={I.help} />
        <span className="side-text">Show me around</span>
      </button>
    </SideGroup>
  );
}

function SideBody({ ctx, collapse }: { ctx: NavCtx; collapse?: ReactNode }) {
  const where = useWhere();
  const { project, loading, view, pathname } = where;
  // With the workspace rail beside it, the sidebar doesn't name the workspace a second time.
  const railShown = useSideMode() === 'full' && hasRail();
  return (
    <>
      <div className="side-top">
        <div className="side-brand">
          <Link
            className="brand"
            href="/projects"
            title={`TicketForge ${APP_VERSION}: all projects`}
          >
            <span className="brand-mark" dangerouslySetInnerHTML={{ __html: I.logo }} />
            <span className="side-text brand-name">TicketForge</span>
            <span className="side-version" aria-label={`App version ${APP_VERSION}`}>
              {APP_VERSION}
            </span>
          </Link>
          {collapse}
        </div>
        {!railShown && <WorkspaceSwitcher />}
        {project && <ProjectSwitcher p={project} />}
      </div>
      <nav className="side-scroll" aria-label={project ? 'Project' : 'Main'} data-tour="sidebar">
        {project ? (
          <ProjectNav p={project} view={view} ctx={ctx} />
        ) : loading ? (
          <NavSkeleton />
        ) : (
          <MainNav pathname={pathname} ctx={ctx} />
        )}
        <div className="side-push" />
        <SystemNav ctx={ctx} where={where} />
      </nav>
      <div className="side-me">
        <AccountCard />
      </div>
    </>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Phones: a modal drawer. It takes focus, keeps Tab inside and gives focus back when it closes. */
function PhoneDrawer({ ctx }: { ctx: NavCtx }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    el.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, []);
  const close = (returnFocus = true) => {
    setDrawerOpen(false);
    if (returnFocus) setTimeout(() => document.getElementById(MENU_BTN_ID)?.focus(), 0);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.nativeEvent.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const els = [...(el.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || [])];
    if (!els.length) {
      e.preventDefault();
      return;
    }
    const first = els[0],
      last = els[els.length - 1],
      cur = document.activeElement;
    const outside = !el.current?.contains(cur);
    if (outside || (!e.shiftKey && cur === last)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && cur === first) {
      e.preventDefault();
      last.focus();
    }
  };
  return (
    <>
      <div className="side-backdrop" onClick={() => close()} aria-hidden="true" />
      <div
        id="side-drawer"
        ref={el}
        className="side-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        onKeyDown={onKey}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) close(false);
        }}
      >
        <div className="sidebar">
          <SideBody
            ctx={ctx}
            collapse={
              <button
                type="button"
                className="side-toggle"
                onClick={() => close()}
                aria-label="Close navigation menu"
              >
                <Ico svg={I.close} />
              </button>
            }
          />
        </div>
      </div>
    </>
  );
}

const NO_TIP: NavCtx['tip'] = () => ({
  onMouseEnter: () => {},
  onFocus: () => {},
  onMouseLeave: () => {},
  onBlur: () => {},
});

export function AppSidebar() {
  const mode = useSideMode();
  const drawerOpen = useDrawerOpen();
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  const mini = mode === 'rail' || (mode === 'full' && S.sideCollapsed);
  if (mode === 'phone')
    return drawerOpen ? <PhoneDrawer ctx={{ mini: false, tip: NO_TIP }} /> : null;
  const hide = () => setTip(null);
  const ctx: NavCtx = {
    mini,
    tip: (text) => {
      const show = (e: React.SyntheticEvent<HTMLElement>) => {
        if (!mini) return;
        const r = e.currentTarget.getBoundingClientRect();
        setTip({ text, top: r.top + r.height / 2, left: r.right + 10 });
      };
      return { onMouseEnter: show, onFocus: show, onMouseLeave: hide, onBlur: hide };
    },
  };
  return (
    <>
      {mode === 'full' && hasRail() && <WorkspaceRail />}
      <div className={`side-wrap ${mini ? 'is-collapsed' : ''}`}>
        <aside className="sidebar">
          <SideBody
            ctx={ctx}
            collapse={
              mode === 'full' && (
                <button
                  type="button"
                  className="side-toggle"
                  onClick={() => {
                    hide();
                    toggleSidebar();
                  }}
                  aria-expanded={!mini}
                  aria-label={mini ? 'Expand sidebar' : 'Collapse sidebar'}
                  title={mini ? 'Expand sidebar  [' : 'Collapse sidebar  ['}
                >
                  <Ico svg={I.collapseSide} />
                </button>
              )
            }
          />
        </aside>
        {tip && mini && (
          <div className="side-tip" role="tooltip" style={{ top: tip.top, left: tip.left }}>
            {tip.text}
          </div>
        )}
      </div>
    </>
  );
}

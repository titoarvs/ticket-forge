'use client';
import { useSyncExternalStore, useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  store,
  P,
  S,
  feat,
  hashColor,
  COLORS,
  isSub,
  isDone,
  activeSprint,
  can,
  toggleSidebar,
} from '../core';
import { Ico, I } from '../ui';
import { Summary, Backlog, Epics, Reports, Tests, Automation } from '../views';
import { Settings } from '../ProjectSettings';
import { Sources } from '../Sources';
import { Timeline } from '../Timeline';
import { Board } from '../Board';
import { TestManagement } from '../TestRepo';
import { PullRequests } from '../PullRequests';
import { Issues } from '../Issues';
import { Releases } from '../Releases';
import { Activity } from '../Activity';
import { Brain } from '../Brain';
import { ProjectCodeJobs } from '../CodeJobsPage';
import pkg from '../../package.json';

/**
 * App version shown at the top of the sidebar, as v<major.minor.patch> (read from package.json, so
 * it follows each release).
 */
const APP_VERSION = /^\d+\.\d+\.\d+/.test(pkg.version)
  ? `v${pkg.version.match(/^\d+\.\d+\.\d+/)![0]}`
  : '';
export const VIEWS: Record<string, string> = {
  summary: 'Summary',
  issues: 'Issues',
  backlog: 'Backlog',
  board: 'Board',
  epics: 'Epics',
  releases: 'Releases',
  timeline: 'Timeline',
  activity: 'Activity',
  reports: 'Reports',
  tests: 'Test cases',
  testmgmt: 'Test management',
  automation: 'Test automation',
  prs: 'Pull requests',
  codejobs: 'Code jobs',
  source: 'Source documents',
  brain: 'Brain',
  settings: 'Project settings',
};
export const COMPONENTS: Record<string, () => React.ReactNode> = {
  summary: Summary,
  issues: Issues,
  backlog: Backlog,
  board: Board,
  epics: Epics,
  releases: Releases,
  timeline: Timeline,
  activity: Activity,
  reports: Reports,
  tests: Tests,
  testmgmt: TestManagement,
  automation: Automation,
  prs: PullRequests,
  codejobs: ProjectCodeJobs,
  source: Sources,
  brain: Brain,
  settings: Settings,
};
/**
 * Sidenav layout for the screen width: phone (< 600px) drawer, tablet (600–1023px) icon rail,
 * desktop (1024px+) full.
 */
type SideMode = 'phone' | 'rail' | 'full';
const PHONE_Q = '(max-width: 599px)',
  RAIL_Q = '(max-width: 1023px)';
const subscribeMode = (cb: () => void) => {
  const qs = [matchMedia(PHONE_Q), matchMedia(RAIL_Q)];
  qs.forEach((q) => q.addEventListener('change', cb));
  return () => qs.forEach((q) => q.removeEventListener('change', cb));
};
const modeNow = (): SideMode =>
  matchMedia(PHONE_Q).matches ? 'phone' : matchMedia(RAIL_Q).matches ? 'rail' : 'full';
const useSideMode = () => useSyncExternalStore(subscribeMode, modeNow, () => 'full' as SideMode);
/**
 * Whether the phone drawer is open is remembered in this browser; a missing or invalid saved value
 * means closed.
 */
const DRAWER_KEY = 'tf.sideDrawerOpen';
const readDrawerOpen = () => store.get(DRAWER_KEY, false) === true;
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export function Sidebar({ view }: { view: string }) {
  const p = P();
  const mode = useSideMode();
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const drawerEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setOpen(readDrawerOpen());
  }, []);
  const setDrawer = (v: boolean) => {
    setOpen(v);
    store.set(DRAWER_KEY, v);
  };
  const drawerOpen = mode === 'phone' && open;
  // A modal drawer takes focus when it opens (including when it is restored after a reload).
  useEffect(() => {
    if (drawerOpen) drawerEl.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [drawerOpen]);
  useEffect(() => {
    if (mode !== 'rail') setTip(null);
  }, [mode]);
  const closeDrawer = (returnFocus = true) => {
    setDrawer(false);
    if (returnFocus) setTimeout(() => menuBtn.current?.focus(), 0);
  };
  const onDrawerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.nativeEvent.stopPropagation();
      closeDrawer();
      return;
    }
    if (e.key !== 'Tab') return;
    const els = [...(drawerEl.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || [])];
    if (!els.length) {
      e.preventDefault();
      return;
    }
    const first = els[0],
      last = els[els.length - 1],
      cur = document.activeElement;
    if (!drawerEl.current?.contains(cur)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && cur === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && cur === last) {
      e.preventDefault();
      first.focus();
    }
  };
  const tests = p.tickets.reduce((s: number, t: any) => s + t.testCases.length, 0);
  const rail = mode === 'rail';
  const mini = rail || (mode === 'full' && S.sideCollapsed);
  const showTip = (text: string) => (e: React.SyntheticEvent<HTMLElement>) => {
    if (!rail) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ text, top: r.top + r.height / 2, left: r.right + 8 });
  };
  const item = (v: string, icon: string, label: string, n?: number) =>
    !feat(VIEW_FEATURE[v] || '') ? null : (
      <Link
        key={v}
        className={`side-item ${view === v ? 'active' : ''}`}
        href={`/p/${p.id}/${v}`}
        title={mini && !rail ? `${label}${n !== undefined ? ` (${n})` : ''}` : undefined}
        aria-label={mini ? label : undefined}
        aria-current={view === v ? 'page' : undefined}
        onMouseEnter={showTip(label)}
        onFocus={showTip(label)}
        onMouseLeave={() => setTip(null)}
        onBlur={() => setTip(null)}
      >
        <Ico svg={icon} />
        <span className="side-text">{label}</span>
        {n !== undefined && <span className="n">{n}</span>}
      </Link>
    );
  const nav = (
    <nav
      className="sidebar"
      aria-label="Project"
      data-tour="sidebar"
      onClick={(e) => {
        if (drawerOpen && (e.target as HTMLElement).closest('a')) closeDrawer(false);
      }}
    >
      <div
        className="side-version"
        aria-label={`App version ${APP_VERSION}`}
        title={`Ticket Forge ${APP_VERSION}`}
      >
        {APP_VERSION}
      </div>
      <div className="proj-head" title={mini ? p.name : undefined}>
        <span className="proj-avatar" style={{ background: hashColor(p.key, COLORS) }}>
          {p.key.slice(0, 2)}
        </span>
        <div className="side-text" style={{ minWidth: 0 }}>
          <b title={p.name}>{p.name}</b>
          <span>Software project</span>
        </div>
      </div>
      <div className="side-label">Planning</div>
      {item('summary', I.summary, 'Summary')}
      {item(
        'issues',
        I.grid,
        'Issues',
        p.tickets.filter((t: any) => !isSub(t) && !isDone(t)).length,
      )}
      {item('backlog', I.backlog, 'Backlog', p.tickets.filter((t: any) => !isSub(t)).length)}
      {item('board', I.board, activeSprint() ? 'Active sprint' : 'Board')}
      {item('epics', I.epic, 'Epics', p.epics.length)}
      {item(
        'releases',
        I.pr,
        'Releases',
        (p.releases || []).filter((r: any) => r.status === 'unreleased').length,
      )}
      {item('timeline', I.calendar, 'Timeline')}
      {item('activity', I.history, 'Activity')}
      {item('reports', I.chart, 'Reports')}
      <div className="side-label">Quality</div>
      {item('tests', I.test, 'Test cases', tests)}
      {item('testmgmt', I.folder, 'Test management', (p.testRepo?.tests || []).length)}
      {item('automation', I.bot, 'Test automation')}
      {(feat('prs') || (feat('code') && can('ai.use'))) && (
        <div className="side-label">Development</div>
      )}
      {item(
        'prs',
        I.pr,
        'Pull requests',
        p.tickets.reduce(
          (n: number, t: any) =>
            n + (t.prs || []).filter((r: any) => ['Open', 'Draft'].includes(r.status)).length,
          0,
        ),
      )}
      {can('ai.use') && item('codejobs', I.bot, 'Code jobs')}
      <div className="side-label">Requirements</div>
      {item('source', I.doc, 'Source documents', (p.sourceText ? 1 : 0) + (p.sources || []).length)}
      {item('brain', I.brain, 'Brain')}
      <div className="side-foot">{item('settings', I.settings, 'Project settings')}</div>
    </nav>
  );
  if (mode === 'phone') {
    return (
      <div className="side-phone">
        <div className="side-mbar">
          <button
            type="button"
            ref={menuBtn}
            className="icon-btn side-menu-btn"
            onClick={() => setDrawer(!open)}
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
            aria-controls={drawerOpen ? 'side-drawer' : undefined}
            aria-haspopup="dialog"
          >
            <Ico svg={I.menu} />
          </button>
          <span className="side-mbar-name">{p.name}</span>
        </div>
        {drawerOpen && (
          <>
            <div className="side-backdrop" onClick={() => closeDrawer()} aria-hidden="true" />
            <div
              id="side-drawer"
              ref={drawerEl}
              className="side-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Project navigation"
              onKeyDown={onDrawerKey}
            >
              <button
                type="button"
                className="icon-btn side-drawer-x"
                onClick={() => closeDrawer()}
                aria-label="Close navigation menu"
              >
                <Ico svg={I.close} />
              </button>
              {nav}
            </div>
          </>
        )}
      </div>
    );
  }
  return (
    <div className={`side-wrap ${mini ? 'is-collapsed' : ''} ${rail ? 'is-rail' : ''}`}>
      {nav}
      {!rail && (
        <button
          type="button"
          className="side-toggle"
          onClick={() => toggleSidebar()}
          aria-expanded={!mini}
          aria-label={mini ? 'Expand sidebar' : 'Collapse sidebar'}
          title={mini ? 'Expand sidebar  [' : 'Collapse sidebar  ['}
        >
          <Ico svg={I.chevron} />
        </button>
      )}
      {tip && (
        <div className="side-tip" role="tooltip" style={{ top: tip.top, left: tip.left }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
/** Pages that belong to a feature the owner can lock (Administration → Features). */
export const VIEW_FEATURE: Record<string, string> = {
  issues: 'issues',
  board: 'board',
  timeline: 'timeline',
  releases: 'releases',
  activity: 'activity',
  reports: 'reports',
  source: 'source',
  tests: 'tests',
  testmgmt: 'testmgmt',
  automation: 'automation',
  prs: 'prs',
  codejobs: 'code',
  brain: 'brain',
};

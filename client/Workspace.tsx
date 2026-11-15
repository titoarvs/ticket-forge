'use client';
// Project workspace: sidebar, current view and the issue/epic panel.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { loadAgents, hireAgent } from './Agents';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { S, store, emit, useStore, P, openProject, isSub, isDone, feat, activeSprint, hashColor, COLORS, ticket, toggleSidebar, statusColorCss, can, type Any } from './core';
import { Ico, I, EmptyState, ErrorState } from './ui';
import { switchWorkspace } from './WorkspaceSwitcher';
import { WorkspaceSkeleton } from './skeletons';
import { Summary, Backlog, Epics, Reports, Tests, Automation } from './views';
import { RowPop } from './RowActions';
import { Settings } from './ProjectSettings';
import { Sources } from './Sources';
import { Drawer } from './Drawer';
import { Timeline } from './Timeline';
import { Board } from './Board';
import { TestManagement } from './TestRepo';
import { PullRequests } from './PullRequests';
import { Issues } from './Issues';
import { Releases } from './Releases';
import { Activity } from './Activity';
import { Brain } from './Brain';
import { openCode } from './DevCode';
import { watchCodeStatus, stopWatching } from './codeStatus';
import { ProjectCodeJobs } from './CodeJobsPage';

export const VIEWS: Record<string, string> = { summary: 'Summary', issues: 'Issues', backlog: 'Backlog', board: 'Board', epics: 'Epics', releases: 'Releases', timeline: 'Timeline', activity: 'Activity', reports: 'Reports', tests: 'Test cases', testmgmt: 'Test management', automation: 'Test automation', prs: 'Pull requests', codejobs: 'Code jobs', source: 'Source documents', brain: 'Brain', settings: 'Project settings' };
const COMPONENTS: Record<string, () => React.ReactNode> = { summary: Summary, issues: Issues, backlog: Backlog, board: Board, epics: Epics, releases: Releases, timeline: Timeline, activity: Activity, reports: Reports, tests: Tests, testmgmt: TestManagement, automation: Automation, prs: PullRequests, codejobs: ProjectCodeJobs, source: Sources, brain: Brain, settings: Settings };

/** Sidenav layout for the screen width: phone (< 600px) drawer, tablet (600–1023px) icon rail, desktop (1024px+) full. */
type SideMode = 'phone' | 'rail' | 'full';
const PHONE_Q = '(max-width: 599px)', RAIL_Q = '(max-width: 1023px)';
const subscribeMode = (cb: () => void) => {
  const qs = [matchMedia(PHONE_Q), matchMedia(RAIL_Q)];
  qs.forEach((q) => q.addEventListener('change', cb));
  return () => qs.forEach((q) => q.removeEventListener('change', cb));
};
const modeNow = (): SideMode => (matchMedia(PHONE_Q).matches ? 'phone' : matchMedia(RAIL_Q).matches ? 'rail' : 'full');
const useSideMode = () => useSyncExternalStore(subscribeMode, modeNow, () => 'full' as SideMode);

/** Whether the phone drawer is open is remembered in this browser; a missing or invalid saved value means closed. */
const DRAWER_KEY = 'tf.sideDrawerOpen';
const readDrawerOpen = () => store.get(DRAWER_KEY, false) === true;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Sidebar({ view }: { view: string }) {
  const p = P();
  const mode = useSideMode();
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const drawerEl = useRef<HTMLDivElement>(null);
  useEffect(() => { setOpen(readDrawerOpen()); }, []);
  const setDrawer = (v: boolean) => { setOpen(v); store.set(DRAWER_KEY, v); };
  const drawerOpen = mode === 'phone' && open;
  // A modal drawer takes focus when it opens (including when it is restored after a reload).
  useEffect(() => { if (drawerOpen) drawerEl.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus(); }, [drawerOpen]);
  useEffect(() => { if (mode !== 'rail') setTip(null); }, [mode]);
  const closeDrawer = (returnFocus = true) => { setDrawer(false); if (returnFocus) setTimeout(() => menuBtn.current?.focus(), 0); };
  const onDrawerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.nativeEvent.stopPropagation(); closeDrawer(); return; }
    if (e.key !== 'Tab') return;
    const els = [...(drawerEl.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || [])];
    if (!els.length) { e.preventDefault(); return; }
    const first = els[0], last = els[els.length - 1], cur = document.activeElement;
    if (!drawerEl.current?.contains(cur)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  };
  const tests = p.tickets.reduce((s: number, t: any) => s + t.testCases.length, 0);
  const rail = mode === 'rail';
  const mini = rail || (mode === 'full' && S.sideCollapsed);
  const showTip = (text: string) => (e: React.SyntheticEvent<HTMLElement>) => {
    if (!rail) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ text, top: r.top + r.height / 2, left: r.right + 8 });
  };
  const item = (v: string, icon: string, label: string, n?: number) => (!feat(VIEW_FEATURE[v] || '') ? null :
    <Link key={v} className={`side-item ${view === v ? 'active' : ''}`} href={`/p/${p.id}/${v}`} title={mini && !rail ? `${label}${n !== undefined ? ` (${n})` : ''}` : undefined}
      aria-label={mini ? label : undefined} aria-current={view === v ? 'page' : undefined}
      onMouseEnter={showTip(label)} onFocus={showTip(label)} onMouseLeave={() => setTip(null)} onBlur={() => setTip(null)}>
      <Ico svg={icon} /><span className="side-text">{label}</span>{n !== undefined && <span className="n">{n}</span>}</Link>
  );
  const nav = (
    <nav className="sidebar" aria-label="Project" data-tour="sidebar" onClick={(e) => { if (drawerOpen && (e.target as HTMLElement).closest('a')) closeDrawer(false); }}>
      <div className="proj-head" title={mini ? p.name : undefined}><span className="proj-avatar" style={{ background: hashColor(p.key, COLORS) }}>{p.key.slice(0, 2)}</span><div className="side-text" style={{ minWidth: 0 }}><b title={p.name}>{p.name}</b><span>Software project</span></div></div>
      <div className="side-label">Planning</div>
      {item('summary', I.summary, 'Summary')}
      {item('issues', I.grid, 'Issues', p.tickets.filter((t: any) => !isSub(t) && !isDone(t)).length)}
      {item('backlog', I.backlog, 'Backlog', p.tickets.filter((t: any) => !isSub(t)).length)}
      {item('board', I.board, activeSprint() ? 'Active sprint' : 'Board')}
      {item('epics', I.epic, 'Epics', p.epics.length)}
      {item('releases', I.pr, 'Releases', (p.releases || []).filter((r: any) => r.status === 'unreleased').length)}
      {item('timeline', I.calendar, 'Timeline')}
      {item('activity', I.history, 'Activity')}
      {item('reports', I.chart, 'Reports')}
      <div className="side-label">Quality</div>
      {item('tests', I.test, 'Test cases', tests)}
      {item('testmgmt', I.folder, 'Test management', (p.testRepo?.tests || []).length)}
      {item('automation', I.bot, 'Test automation')}
      {(feat('prs') || (feat('code') && can('ai.use'))) && <div className="side-label">Development</div>}
      {item('prs', I.pr, 'Pull requests', p.tickets.reduce((n: number, t: any) => n + (t.prs || []).filter((r: any) => ['Open', 'Draft'].includes(r.status)).length, 0))}
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
          <button type="button" ref={menuBtn} className="icon-btn side-menu-btn" onClick={() => setDrawer(!open)} aria-label="Open navigation menu"
            aria-expanded={drawerOpen} aria-controls={drawerOpen ? 'side-drawer' : undefined} aria-haspopup="dialog"><Ico svg={I.menu} /></button>
          <span className="side-mbar-name">{p.name}</span>
        </div>
        {drawerOpen && <>
          <div className="side-backdrop" onClick={() => closeDrawer()} aria-hidden="true" />
          <div id="side-drawer" ref={drawerEl} className="side-drawer" role="dialog" aria-modal="true" aria-label="Project navigation" onKeyDown={onDrawerKey}>
            <button type="button" className="icon-btn side-drawer-x" onClick={() => closeDrawer()} aria-label="Close navigation menu"><Ico svg={I.close} /></button>
            {nav}
          </div>
        </>}
      </div>
    );
  }
  return (
    <div className={`side-wrap ${mini ? 'is-collapsed' : ''} ${rail ? 'is-rail' : ''}`}>
    {nav}
    {!rail && <button type="button" className="side-toggle" onClick={() => toggleSidebar()} aria-expanded={!mini} aria-label={mini ? 'Expand sidebar' : 'Collapse sidebar'}
      title={mini ? 'Expand sidebar  [' : 'Collapse sidebar  ['}><Ico svg={I.chevron} /></button>}
    {tip && <div className="side-tip" role="tooltip" style={{ top: tip.top, left: tip.left }}>{tip.text}</div>}
    </div>
  );
}

/** Pages that belong to a feature the owner can lock (Administration → Features). */
const VIEW_FEATURE: Record<string, string> = { issues: 'issues', board: 'board', timeline: 'timeline', releases: 'releases', activity: 'activity', reports: 'reports', source: 'source', tests: 'tests', testmgmt: 'testmgmt', automation: 'automation', prs: 'prs', codejobs: 'code', brain: 'brain' };
function LockedView({ label }: { label: string }) {
  return <EmptyState icon={I.settings} tone="neutral" title={`${label} is locked`}
    actions={S.user?.isOwner ? <Link className="btn primary" href="/admin/features">Manage features</Link> : <Link className="btn" href={`/p/${P().id}/backlog`}>Go to the backlog</Link>}>
    <p>{S.user?.isOwner ? 'You locked this feature. Unlock it in Administration → Features.' : 'The owner locked this feature. Ask them if you need it.'}</p></EmptyState>;
}

/** The project couldn't be opened: missing, no access, or a failed request. */
function ProjectError({ id }: { id: string }) {
  const e = S.projectError;
  const back = <Link className="btn" href="/projects">Back to projects</Link>;
  if (e.status === 404 || e.status === 403) {
    if (e.elsewhere) {
      return (
        <EmptyState icon={I.folder} tone="neutral" title={`This project is in ${e.elsewhere.name}`}
          actions={<><button className="btn primary" onClick={() => switchWorkspace(e.elsewhere.id, location.pathname)}>Switch to {e.elsewhere.name}</button>{back}</>}>
          <p>You’re working in <b>{S.user?.workspaceName}</b> right now. Switch workspaces to open it.</p>
        </EmptyState>
      );
    }
    return (
      <EmptyState icon={I.folder} tone="neutral" title="Project not found" actions={<Link className="btn primary" href="/projects">Back to projects</Link>}>
        <p>It may have been deleted, or you don’t have access to it. If you think you should, ask an administrator to add you.</p>
      </EmptyState>
    );
  }
  return (
    <ErrorState title="Couldn’t open this project" error={e.message} actions={back}
      onRetry={async () => { S.projectError = null; emit(); await openProject(id); }}>
      <p>Something went wrong while loading it. Your saved work isn’t affected.</p>
    </ErrorState>
  );
}

export default function Workspace({ id, view }: { id: string; view: string }) {
  useStore();
  useEffect(() => { openProject(id); }, [id]);
  // Links from emails and notifications: /p/<id>/backlog?issue=<issueId> opens that issue.
  const params = useSearchParams();
  const router = useRouter();
  const issueParam = params.get('issue');
  const epicParam = params.get('epic');
  const hireParam = params.get('hire');
  const codeParam = params.get('code'); // from the Code jobs page: also open the issue's code job (frontend | backend)
  const loaded = P()?.id === id;
  // Changing page closes the issue/epic panel and any row popup, so the next page doesn't open with the last
  // page's issue beside it. (Runs before the ?issue / ?epic effects below, which may open one for the new page.)
  useEffect(() => {
    if (S.drawer || S.full || S.pop) { Object.assign(S, { drawer: null, full: false, pop: null, menu: null }); emit(); }
  }, [view, id]);
  // From Administration → Agents → Hire: /p/<id>/backlog?epic=<epicId>&hire=<agentId> opens the epic and hires the agent.
  useEffect(() => {
    if (!loaded || !epicParam) return;
    const ep = P().epics.find((x: Any) => x.id === epicParam);
    if (ep) {
      Object.assign(S, { drawer: { kind: 'epic', id: epicParam }, menu: null }); emit();
      if (hireParam) loadAgents().then((d) => { const a = d.agents.find((x: Any) => x.id === hireParam); if (a) hireAgent(a, ep); }).catch(() => {});
    }
    router.replace(`/p/${id}/${view || 'backlog'}`, { scroll: false });
  }, [loaded, epicParam, hireParam]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loaded || !issueParam) return;
    const t = ticket(issueParam);
    if (t) {
      Object.assign(S, { drawer: { kind: 'issue', id: issueParam }, menu: null }); emit();
      if (codeParam) openCode(t, codeParam === 'backend' ? 'backend' : 'frontend');
    }
    router.replace(`/p/${id}/${view || 'backlog'}`, { scroll: false });
  }, [loaded, issueParam]); // eslint-disable-line react-hooks/exhaustive-deps
  // Coding indicators on issues (rows, cards, the issue panel): fresh while this project is open.
  useEffect(() => { if (!loaded) return undefined; watchCodeStatus(id); return () => stopWatching(); }, [loaded, id]);
  const v = VIEWS[view] ? view : 'backlog';
  if (S.projectError?.id === id) return <div className="page"><ProjectError id={id} /></div>;
  if (!P() || P().id !== id) return <WorkspaceSkeleton view={v} />;
  const View = COMPONENTS[v];
  return (
    <div className="shell">
      <style>{statusColorCss()}</style>
      <Sidebar view={v} />
      <div className="main">
        <section className="view">{feat(VIEW_FEATURE[v] || '') ? <View /> : <LockedView label={VIEWS[v]} />}</section>
        <Drawer />
      </div>
      <RowPop />
    </div>
  );
}

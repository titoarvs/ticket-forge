'use client';
// Project workspace: sidebar, current view and the issue/epic panel.
import { useEffect } from 'react';
import { loadAgents, hireAgent } from './Agents';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { S, emit, useStore, P, openProject, isSub, activeSprint, hashColor, COLORS, ticket, toggleSidebar, statusColorCss, type Any } from './core';
import { Ico, I, EmptyState, ErrorState } from './ui';
import { WorkspaceSkeleton } from './skeletons';
import { Summary, Backlog, Epics, Reports, Tests, Automation } from './views';
import { Settings } from './ProjectSettings';
import { Sources } from './Sources';
import { Drawer } from './Drawer';
import { Timeline } from './Timeline';
import { Board } from './Board';
import { TestManagement } from './TestRepo';

export const VIEWS: Record<string, string> = { summary: 'Summary', backlog: 'Backlog', board: 'Board', epics: 'Epics', timeline: 'Timeline', reports: 'Reports', tests: 'Test cases', testmgmt: 'Test management', automation: 'Test automation', source: 'Source documents', settings: 'Project settings' };
const COMPONENTS: Record<string, () => React.ReactNode> = { summary: Summary, backlog: Backlog, board: Board, epics: Epics, timeline: Timeline, reports: Reports, tests: Tests, testmgmt: TestManagement, automation: Automation, source: Sources, settings: Settings };

function Sidebar({ view }: { view: string }) {
  const p = P();
  const tests = p.tickets.reduce((s: number, t: any) => s + t.testCases.length, 0);
  const mini = S.sideCollapsed;
  const item = (v: string, icon: string, label: string, n?: number) => (
    <Link key={v} className={`side-item ${view === v ? 'active' : ''}`} href={`/p/${p.id}/${v}`} title={mini ? `${label}${n !== undefined ? ` (${n})` : ''}` : undefined}
      aria-label={mini ? label : undefined} aria-current={view === v ? 'page' : undefined}>
      <Ico svg={icon} /><span className="side-text">{label}</span>{n !== undefined && <span className="n">{n}</span>}</Link>
  );
  return (
    <div className={`side-wrap ${mini ? 'is-collapsed' : ''}`}>
    <nav className="sidebar" aria-label="Project">
      <div className="proj-head" title={mini ? p.name : undefined}><span className="proj-avatar" style={{ background: hashColor(p.key, COLORS) }}>{p.key.slice(0, 2)}</span><div className="side-text" style={{ minWidth: 0 }}><b title={p.name}>{p.name}</b><span>Software project</span></div></div>
      <div className="side-label">Planning</div>
      {item('summary', I.summary, 'Summary')}
      {item('backlog', I.backlog, 'Backlog', p.tickets.filter((t: any) => !isSub(t)).length)}
      {item('board', I.board, activeSprint() ? 'Active sprint' : 'Board')}
      {item('epics', I.epic, 'Epics', p.epics.length)}
      {item('timeline', I.calendar, 'Timeline')}
      {item('reports', I.chart, 'Reports')}
      <div className="side-label">Quality</div>
      {item('tests', I.test, 'Test cases', tests)}
      {item('testmgmt', I.folder, 'Test management', (p.testRepo?.tests || []).length)}
      {item('automation', I.bot, 'Test automation')}
      <div className="side-label">Requirements</div>
      {item('source', I.doc, 'Source documents', (p.sourceText ? 1 : 0) + (p.sources || []).length)}
      <div className="side-foot">{item('settings', I.settings, 'Project settings')}</div>
    </nav>
    <button type="button" className="side-toggle" onClick={() => toggleSidebar()} aria-expanded={!mini} aria-label={mini ? 'Expand sidebar' : 'Collapse sidebar'}
      title={mini ? 'Expand sidebar  [' : 'Collapse sidebar  ['}><Ico svg={I.chevron} /></button>
    </div>
  );
}

/** The project couldn't be opened: missing, no access, or a failed request. */
function ProjectError({ id }: { id: string }) {
  const e = S.projectError;
  const back = <Link className="btn" href="/">Back to projects</Link>;
  if (e.status === 404 || e.status === 403) {
    return (
      <EmptyState icon={I.folder} tone="neutral" title="Project not found" actions={<Link className="btn primary" href="/">Back to projects</Link>}>
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
  const loaded = P()?.id === id;
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
    if (ticket(issueParam)) { Object.assign(S, { drawer: { kind: 'issue', id: issueParam }, menu: null }); emit(); }
    router.replace(`/p/${id}/${view || 'backlog'}`, { scroll: false });
  }, [loaded, issueParam]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = VIEWS[view] ? view : 'backlog';
  if (S.projectError?.id === id) return <div className="page"><ProjectError id={id} /></div>;
  if (!P() || P().id !== id) return <WorkspaceSkeleton view={v} />;
  const View = COMPONENTS[v];
  return (
    <div className="shell">
      <style>{statusColorCss()}</style>
      <Sidebar view={v} />
      <div className="main">
        <section className="view"><View /></section>
        <Drawer />
      </div>
    </div>
  );
}

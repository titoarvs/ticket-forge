'use client';
// Project workspace: sidebar, current view and the issue/epic panel.
import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { S, emit, useStore, P, openProject, isSub, activeSprint, hashColor, COLORS, ticket } from './core';
import { Ico, I, EmptyState, ErrorState } from './ui';
import { WorkspaceSkeleton } from './skeletons';
import { Summary, Backlog, Board, Epics, Reports, Tests, Automation, Source, Settings } from './views';
import { Drawer } from './Drawer';

export const VIEWS: Record<string, string> = { summary: 'Summary', backlog: 'Backlog', board: 'Board', epics: 'Epics', reports: 'Reports', tests: 'Test cases', automation: 'Test automation', source: 'Source document', settings: 'Project settings' };
const COMPONENTS: Record<string, () => React.ReactNode> = { summary: Summary, backlog: Backlog, board: Board, epics: Epics, reports: Reports, tests: Tests, automation: Automation, source: Source, settings: Settings };

function Sidebar({ view }: { view: string }) {
  const p = P();
  const tests = p.tickets.reduce((s: number, t: any) => s + t.testCases.length, 0);
  const item = (v: string, icon: string, label: string, n?: number) => (
    <Link key={v} className={`side-item ${view === v ? 'active' : ''}`} href={`/p/${p.id}/${v}`}><Ico svg={icon} /><span>{label}</span>{n !== undefined && <span className="n">{n}</span>}</Link>
  );
  return (
    <nav className="sidebar" aria-label="Project">
      <div className="proj-head"><span className="proj-avatar" style={{ background: hashColor(p.key, COLORS) }}>{p.key.slice(0, 2)}</span><div style={{ minWidth: 0 }}><b title={p.name}>{p.name}</b><span>Software project</span></div></div>
      <div className="side-label">Planning</div>
      {item('summary', I.summary, 'Summary')}
      {item('backlog', I.backlog, 'Backlog', p.tickets.filter((t: any) => !isSub(t)).length)}
      {item('board', I.board, activeSprint() ? 'Active sprint' : 'Board')}
      {item('epics', I.epic, 'Epics', p.epics.length)}
      {item('reports', I.chart, 'Reports')}
      <div className="side-label">Quality</div>
      {item('tests', I.test, 'Test cases', tests)}
      {item('automation', I.bot, 'Test automation')}
      <div className="side-label">Requirements</div>
      {item('source', I.doc, 'Source document')}
      <div className="side-foot">{item('settings', I.settings, 'Project settings')}</div>
    </nav>
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
  const loaded = P()?.id === id;
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
      <Sidebar view={v} />
      <div className="main">
        <section className="view"><View /></section>
        <Drawer />
      </div>
    </div>
  );
}

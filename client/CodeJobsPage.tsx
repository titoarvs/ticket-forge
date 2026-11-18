'use client';
// Code jobs (top bar): every code generation in your workspace's projects, live, on this computer and on GitHub
// Actions. Filter to what's running or waiting for review, stop a job, or open it to review the changes.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { S, P, api, toast, ago, useStore, closeProject, type Any } from './core';
import { Ico, I, Spinner, EmptyState, ErrorState } from './ui';
import { TF, SF, MenuItem } from './fields';
import { DiffReview } from './DiffReview';
import { StartCoding } from './DevPlan';

const LIVE = ['starting', 'queued', 'running'];
const REVIEW = ['review', 'report'];
const SHIPPED = ['pr', 'merged', 'committed'];
const TROUBLE = ['failed', 'cancelled', 'empty'];
const LABEL: Record<string, string> = {
  starting: 'Starting', queued: 'Waiting', running: 'Working', review: 'Ready for review', report: 'Report ready', committed: 'Committed',
  pr: 'Pull request open', merged: 'Merged', empty: 'No changes', failed: 'Failed', cancelled: 'Stopped',
};
type Filter = 'live' | 'review' | 'all';

/**
 * The issue "Write code" opened this page for (TF-124, /code-jobs?project=…&ticket=…): its ID, the coding prompt and the
 * linked repository or spec. With no repository or spec only the ID and the prompt show.
 */
function TicketContext({ projectId, ticketId }: { projectId: string; ticketId: string }) {
  const [c, setC] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const load = () => { setError(null); api(`/api/projects/${encodeURIComponent(projectId)}/code-context?ticketId=${encodeURIComponent(ticketId)}`).then(setC).catch(setError); };
  useEffect(load, [projectId, ticketId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <div className="card" style={{ padding: 16, marginBottom: 12 }}><ErrorState title="Couldn’t load the issue" error={error} onRetry={load}><p>Open the issue again from its project.</p></ErrorState></div>;
  if (!c) return <div className="card" style={{ padding: 16, marginBottom: 12 }}><Spinner /> Loading the issue…</div>;
  return (
    <div className="card" style={{ padding: 16, marginBottom: 12 }} aria-label="Issue to code">
      <div className="job-l1"><code>{c.key || c.ticketId}</code><span className="job-title">{c.title}</span></div>
      {(c.repos.length > 0 || c.spec) && <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
        {c.repos.map((r: Any) => <li key={r.label}>{r.label}: <code>{r.name}</code></li>)}
        {c.spec && <li>Coding spec: {c.spec.status === 'ready' ? 'ready for coding' : 'draft'}{c.spec.files.length ? <> · {c.spec.files.map((f: Any) => <code key={f.path} style={{ marginRight: 6 }}>{f.path}</code>)}</> : null}{c.spec.modules.length ? ` · modules: ${c.spec.modules.join(', ')}` : ''}</li>}
      </ul>}
      <h4 style={{ margin: '12px 0 4px' }}>Prompt</h4>
      <pre className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', margin: 0 }}>{c.prompt}</pre>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {/* The issue's code panel in its project: start the agent, watch it, review the diff and open the pull request. */}
        <Link className="btn sm ai" href={`/p/${encodeURIComponent(projectId)}/backlog?issue=${encodeURIComponent(c.ticketId)}&code=${c.repos.length === 1 && c.repos[0].label === 'Backend' ? 'backend' : 'frontend'}`}
          title="Opens this issue’s code panel: start the AI agent, review its changes, then open the pull request"><Ico svg={I.sparkle} />Start writing code</Link>
        <Link className="btn sm subtle" href={`/p/${encodeURIComponent(projectId)}/codejobs`} title="The project’s Code jobs page: start coding one ticket or a whole feature">Code a whole feature…</Link>
        <button className="btn sm subtle" onClick={() => navigator.clipboard?.writeText(c.prompt).then(() => toast('Prompt copied.'), () => toast('Couldn’t copy the prompt.', 'err'))}>Copy prompt</button>
      </div>
    </div>
  );
}

/** The Code jobs page. With `projectId` it is that project's page (Development → Code jobs): its jobs only, links stay in the project. */
export function CodeJobsPage({ projectId = '' }: { projectId?: string }) {
  useStore();
  const [d, setD] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const [filter, setFilter] = useState<Filter>('live');
  const [q, setQ] = useState('');
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState('');
  const [diffOpen, setDiffOpen] = useState<string | null>(null);
  const timer = useRef<Any>(null);
  // Opened by "Write code" on an issue (TF-124): /code-jobs?project=…&ticket=…
  const [asked, setAsked] = useState<{ project: string; ticket: string } | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('project') && sp.get('ticket')) setAsked({ project: sp.get('project') || '', ticket: sp.get('ticket') || '' });
  }, []);

  const load = async () => {
    try {
      const url = `/api/code-jobs${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`;
      const r = await api(url);
      setD(r); setError(null);
      // Jobs through the AI API update when someone asks about them: ask for the running ones, then show the news.
      const gh = r.jobs.filter((j: Any) => j.live && j.where === 'github').slice(0, 8);
      if (gh.length) {
        await Promise.all(gh.map((j: Any) => api(`/api/projects/${j.projectId}/code?jobId=${encodeURIComponent(j.id)}&since=999999`).catch(() => null)));
        setD(await api(url));
      }
    } catch (e: Any) { setError(e); }
  };
  useEffect(() => { if (!projectId) closeProject(); load(); return () => clearTimeout(timer.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Every few seconds while something is running; otherwise now and then (jobs started elsewhere show up).
  useEffect(() => {
    if (!d) return undefined;
    const live = d.jobs.some((j: Any) => j.live);
    timer.current = setTimeout(load, live ? 3000 : 20000);
    return () => clearTimeout(timer.current);
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !d) return <div className="page"><div className="page-inner"><ErrorState title="Couldn’t load code jobs" error={error} onRetry={load}><p>Check your connection and try again.</p></ErrorState></div></div>;
  const jobs: Any[] = d?.jobs || [];
  const n = (s: string[]) => jobs.filter((j) => s.includes(j.status)).length;
  const projects = [...new Map(jobs.map((j) => [j.projectId, j.projectName])).entries()];
  const shown = jobs.filter((j) => (filter === 'live' ? j.live : filter === 'review' ? REVIEW.includes(j.status) : true)
    && (!project || j.projectId === project)
    && (!q.trim() || `${j.ticketKey} ${j.title} ${j.projectName} ${j.agentName} ${j.branch}`.toLowerCase().includes(q.trim().toLowerCase())));
  const stop = async (j: Any) => {
    setBusy(j.id);
    try { await api(`/api/projects/${j.projectId}/code`, { method: 'POST', body: { action: 'cancel', jobId: j.id } }); toast(`Stopped ${j.ticketKey}`); await load(); }
    catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const openHref = (j: Any) => `/p/${j.projectId}/backlog?issue=${encodeURIComponent(j.ticketId)}&code=${j.side || 'frontend'}`;
  const scoped = Boolean(projectId);
  const tabs: [Filter, string, number][] = [['live', 'Running now', n(LIVE)], ['review', 'Ready for review', n(REVIEW)], ['all', 'All recent', jobs.length]];

  return (
    <div className="page"><div className="page-inner cjp">
      <div className="page-h"><div><h1>Code jobs</h1><p className="muted small" style={{ margin: '2px 0 0' }}>{scoped ? `What AI agents are writing for ${P()?.name || 'this project'}, live. Open a job to review its changes, then open the pull request.` : `What AI agents are writing across your projects${S.user?.workspaceName ? ` in ${S.user.workspaceName}` : ''}, live.`}</p></div>
        {scoped && <Link className="btn" href={`/p/${projectId}/prs`} style={{ marginLeft: 12 }}><Ico svg={I.pr} />Pull requests</Link>}
        <div className="spacer" /><button className="btn" onClick={load}><Ico svg={I.undo} />Refresh</button></div>
      {asked && <TicketContext projectId={asked.project} ticketId={asked.ticket} />}
      {scoped && <StartCoding />}
      {!d ? <div className="card" style={{ padding: 20 }}><Spinner /> Loading code jobs…</div> : <>
        <div className="cjp-sum">
          <div className={n(LIVE) ? 'on' : ''}><b>{n(['running', 'starting'])}</b><span>working</span></div>
          <div><b>{n(['queued'])}</b><span>waiting for a slot</span></div>
          <div><b>{n(REVIEW)}</b><span>ready for review</span></div>
          <div><b>{n(SHIPPED)}</b><span>shipped</span></div>
          <div className={n(TROUBLE) ? 'bad' : ''}><b>{n(TROUBLE)}</b><span>need attention</span></div>
        </div>
        <div className="cjp-bar">
          <div className="seg" role="tablist" aria-label="Show">{tabs.map(([k, l, c]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}{c ? ` (${c})` : ''}</button>))}</div>
          <span className="spacer" />
          {!scoped && projects.length > 1 && <SF filter value={project} onChange={(e) => setProject(String(e.target.value))} aria-label="Project" displayEmpty>
            <MenuItem value="">All projects</MenuItem>{projects.map(([id, name]) => <MenuItem key={id} value={id}>{name}</MenuItem>)}</SF>}
          <TF search sx={{ width: 220 }} placeholder="Search issue, project, agent" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!shown.length ? (
          <div className="card"><EmptyState compact icon={I.bot} tone="neutral"
            title={filter === 'live' ? 'Nothing is running right now' : filter === 'review' ? 'Nothing is waiting for review' : 'No code jobs yet'}
            actions={filter !== 'all' && jobs.length ? <button className="btn" onClick={() => setFilter('all')}>Show all recent jobs</button> : <Link className="btn" href="/projects">Go to projects</Link>}>
            <p>Start one from an issue’s <b>Write code with AI</b>, or select several issues in a backlog. They show up here while they run.</p></EmptyState></div>
        ) : (
          <div className="jobs-list cjp-list">{shown.map((j) => {
            const add = (j.files || []).reduce((s: number, f: Any) => s + (f.added || 0), 0), del = (j.files || []).reduce((s: number, f: Any) => s + (f.removed || 0), 0);
            return (
              <div key={j.id} className="cjp-item">
              <div className={`job-row s-${j.status}`}>
                <span className={`cj-badge s-${j.status}`}>{j.live ? <Spinner /> : <Ico svg={TROUBLE.includes(j.status) ? I.warn : I.check} />}{LABEL[j.status] || j.status}</span>
                <div className="job-main">
                  <div className="job-l1"><code>{j.ticketKey}</code><span className="job-title">{j.title}</span>
                    {!scoped && <span className="cjp-proj" title={j.projectName}>{j.projectName}</span>}
                    {j.side === 'backend' && <span className="layer-chip l-backend">Backend</span>}</div>
                  <div className="job-l2 muted small">
                    <span>{j.where === 'github' ? 'AI API + GitHub' : 'This computer'}</span>
                    {j.agentName && <span>{j.agentName}</span>}
                    {j.todosTotal > 0 && <span>Plan {j.todosDone}/{j.todosTotal}</span>}
                    {j.live && j.last ? <span className="job-last">{j.last}</span> : j.error ? <span className="job-last bad">{j.error}</span> : null}
                    {j.files?.length > 0 && <span>{j.files.length} file{j.files.length === 1 ? '' : 's'} <span className="da">+{add}</span> <span className="dr">−{del}</span></span>}
                    {j.costUsd > 0 && <span>${j.costUsd.toFixed(2)}</span>}
                    {j.startedBy && <span>by {j.startedBy}</span>}
                    <span>{ago(j.startedAt)}</span>
                  </div>
                </div>
                <div className="cjp-actions">
                  {j.files?.length > 0 && !j.live && <button className="btn sm subtle" aria-expanded={diffOpen === j.id} onClick={() => setDiffOpen(diffOpen === j.id ? null : j.id)} title="Review the changes as a side-by-side diff">Changes</button>}
                  {j.url && <a className="btn sm subtle" href={j.url} target="_blank" rel="noopener noreferrer" title="Open the GitHub Actions run"><Ico svg={I.external} /></a>}
                  {j.pr?.url && <a className="btn sm subtle" href={j.pr.url} target="_blank" rel="noopener noreferrer">PR #{j.pr.number}</a>}
                  {j.live && <button className="btn sm subtle" disabled={busy === j.id} onClick={() => stop(j)}>{busy === j.id ? <Spinner /> : <Ico svg={I.stop} />}{j.status === 'queued' ? 'Remove' : 'Stop'}</button>}
                  <Link className={`btn sm ${REVIEW.includes(j.status) ? 'primary' : ''}`} href={openHref(j)}>{REVIEW.includes(j.status) ? 'Review' : 'Open'}</Link>
                </div>
              </div>
              {diffOpen === j.id && <div className="cjp-diff"><DiffReview job={j} /></div>}
              </div>
            );
          })}</div>
        )}
      </>}
    </div></div>
  );
}

/** Development → Code jobs inside a project. */
export function ProjectCodeJobs() { return <CodeJobsPage projectId={P().id} />; }

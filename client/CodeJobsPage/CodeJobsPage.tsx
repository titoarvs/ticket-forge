'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useStore, type Any, api, closeProject, toast, P, S, ago } from '../core';
import { ErrorState, Ico, I, Spinner, EmptyState } from '../ui';
import { SF, MenuItem, TF } from '../fields';
import { openCodingBoard, toCodeCount } from '../CodingBoard';
import { type Filter, REVIEW, TROUBLE, LIVE, TicketContext, LABEL } from './TicketContext';
import { JobActions } from './JobActions';
import { JobsOffice } from './JobsOffice';

const VIEW_KEY = 'tf.codejobs.view';
/** List or office, remembered on this device. */
function useJobsView() {
  const [view, setView] = useState('list');
  useEffect(() => {
    try {
      setView(localStorage.getItem(VIEW_KEY) || 'list');
    } catch {
      /* storage off */
    }
  }, []);
  const set = (v: string) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage off */
    }
  };
  return [view, set] as const;
}

function ViewSwitch({ view, setView }: { view: string; setView: (v: string) => void }) {
  const tab = (v: string, title: string, icon: string) => (
    <button
      role="tab"
      aria-selected={view === v}
      className={view === v ? 'on' : ''}
      onClick={() => setView(v)}
      title={title}
      aria-label={title}
    >
      <Ico svg={icon} />
    </button>
  );
  return (
    <div className="seg cjp-view" role="tablist" aria-label="View">
      {tab('list', 'List', I.backlog)}
      {tab('office', 'Office', I.office)}
    </div>
  );
}

/**
 * The Code jobs page. With `projectId` it is that project's page (Development → Code jobs): its
 * jobs only, links stay in the project.
 */
export function CodeJobsPage({ projectId = '' }: { projectId?: string }) {
  useStore();
  const [d, setD] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const [filter, setFilter] = useState<Filter>('live');
  const [q, setQ] = useState('');
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState('');
  const [view, setView] = useJobsView();
  const timer = useRef<Any>(null);
  // Opened by "Write code" on an issue (TF-124): /code-jobs?project=…&ticket=…
  const [asked, setAsked] = useState<{ project: string; ticket: string } | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('project') && sp.get('ticket'))
      setAsked({ project: sp.get('project') || '', ticket: sp.get('ticket') || '' });
    if (projectId && sp.get('coding') === '1') {
      openCodingBoard();
      history.replaceState(null, '', location.pathname);
    }
  }, [projectId]);

  const load = async () => {
    try {
      const url = `/api/code-jobs${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`;
      const r = await api(url);
      setD(r);
      setError(null);
      // Jobs through the AI API update when someone asks about them: ask for the running ones, then
      // show the news.
      const gh = r.jobs.filter((j: Any) => j.live && j.where === 'github').slice(0, 8);
      if (gh.length) {
        await Promise.all(
          gh.map((j: Any) =>
            api(
              `/api/projects/${j.projectId}/code?jobId=${encodeURIComponent(j.id)}&since=999999`,
            ).catch(() => null),
          ),
        );
        setD(await api(url));
      }
    } catch (e: Any) {
      setError(e);
    }
  };
  useEffect(() => {
    if (!projectId) closeProject();
    load();
    return () => clearTimeout(timer.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Every few seconds while something is running; otherwise now and then (jobs started elsewhere
  // show up).
  useEffect(() => {
    if (!d) return undefined;
    const live = d.jobs.some((j: Any) => j.live);
    timer.current = setTimeout(load, live ? 3000 : 20000);
    return () => clearTimeout(timer.current);
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !d)
    return (
      <div className="page">
        <div className="page-inner">
          <ErrorState title="Couldn’t load code jobs" error={error} onRetry={load}>
            <p>Check your connection and try again.</p>
          </ErrorState>
        </div>
      </div>
    );
  const jobs: Any[] = d?.jobs || [];
  const n = (s: string[]) => jobs.filter((j) => s.includes(j.status)).length;
  const projects = [...new Map(jobs.map((j) => [j.projectId, j.projectName])).entries()];
  const shown = jobs.filter(
    (j) =>
      (filter === 'live'
        ? j.live
        : filter === 'review'
          ? REVIEW.includes(j.status)
          : filter === 'trouble'
            ? TROUBLE.includes(j.status)
            : true) &&
      (!project || j.projectId === project) &&
      (!q.trim() ||
        `${j.ticketKey} ${j.title} ${j.projectName} ${j.agentName} ${j.branch}`
          .toLowerCase()
          .includes(q.trim().toLowerCase())),
  );
  const stop = async (j: Any) => {
    setBusy(j.id);
    try {
      await api(`/api/projects/${j.projectId}/code`, {
        method: 'POST',
        body: { action: 'cancel', jobId: j.id },
      });
      toast(`Stopped ${j.ticketKey}`);
      await load();
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const scoped = Boolean(projectId);
  const tabs: [Filter, string, number][] = [
    ['live', 'Running now', n(LIVE)],
    ['review', 'Ready for review', n(REVIEW)],
    ['trouble', 'Needs attention', n(TROUBLE)],
    ['all', 'All recent', jobs.length],
  ];

  return (
    <div className="page">
      <div className="page-inner cjp">
        <div className="page-h">
          <div>
            <h1>Code jobs</h1>
            <p className="muted small" style={{ margin: '2px 0 0' }}>
              {scoped
                ? `What AI agents are writing for ${P()?.name || 'this project'}, live. Open a job to review its changes, then open the pull request.`
                : `What AI agents are writing across your projects${S.user?.workspaceName ? ` in ${S.user.workspaceName}` : ''}, live.`}
            </p>
          </div>
          <div className="spacer" />
          {scoped && (
            <Link className="btn" href={`/p/${projectId}/prs`}>
              <Ico svg={I.pr} />
              Pull requests
            </Link>
          )}
          <button className="btn" onClick={load}>
            <Ico svg={I.undo} />
            Refresh
          </button>
          {scoped && (
            <button
              className="btn ai"
              onClick={openCodingBoard}
              title="Pick a feature and write code for its tickets, one by one or all at once"
            >
              <Ico svg={I.sparkle} />
              Start coding{toCodeCount() ? ` (${toCodeCount()} to code)` : ''}
            </button>
          )}
        </div>
        {asked && <TicketContext projectId={asked.project} ticketId={asked.ticket} />}
        {!d ? (
          <div className="muted" style={{ padding: 20 }}>
            <Spinner /> Loading code jobs…
          </div>
        ) : (
          <>
            <div className="cjp-bar">
              <div className="seg" role="tablist" aria-label="Show">
                {tabs.map(([k, l, c]) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={filter === k}
                    className={filter === k ? 'on' : ''}
                    onClick={() => setFilter(k)}
                  >
                    {l}
                    {c ? ` (${c})` : ''}
                  </button>
                ))}
              </div>
              <span className="spacer" />
              {!scoped && projects.length > 1 && (
                <SF
                  filter
                  value={project}
                  onChange={(e) => setProject(String(e.target.value))}
                  aria-label="Project"
                  displayEmpty
                >
                  <MenuItem value="">All projects</MenuItem>
                  {projects.map(([id, name]) => (
                    <MenuItem key={id} value={id}>
                      {name}
                    </MenuItem>
                  ))}
                </SF>
              )}
              <TF
                search
                sx={{ width: 220 }}
                placeholder="Search issue, project, agent"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <ViewSwitch view={view} setView={setView} />
            </div>
            {!shown.length ? (
              <div className="cjp-empty">
                <EmptyState
                  compact
                  icon={I.bot}
                  tone="neutral"
                  title={
                    filter === 'live'
                      ? 'Nothing is running right now'
                      : filter === 'review'
                        ? 'Nothing is waiting for review'
                        : filter === 'trouble'
                          ? 'Nothing needs attention'
                          : 'No code jobs yet'
                  }
                  actions={
                    filter !== 'all' && jobs.length ? (
                      <button className="btn" onClick={() => setFilter('all')}>
                        Show all recent jobs
                      </button>
                    ) : (
                      <Link className="btn" href="/projects">
                        Go to projects
                      </Link>
                    )
                  }
                >
                  <p>
                    {scoped ? (
                      <>
                        Press <b>Start coding</b>: one ticket, or a whole feature at once.
                      </>
                    ) : (
                      <>
                        Start one from a project’s <b>Code jobs</b> page (one ticket or a whole
                        feature), or select several issues in a backlog.
                      </>
                    )}{' '}
                    They show up here while they run.
                  </p>
                </EmptyState>
              </div>
            ) : view === 'office' ? (
              <JobsOffice jobs={shown} busy={busy} stop={stop} />
            ) : (
              <div className="jobs-list cjp-list">
                {shown.map((j) => {
                  const add = (j.files || []).reduce((s: number, f: Any) => s + (f.added || 0), 0),
                    del = (j.files || []).reduce((s: number, f: Any) => s + (f.removed || 0), 0);
                  return (
                    <div key={j.id} className="cjp-item">
                      <div className={`job-row s-${j.status}`}>
                        <span className={`cj-badge s-${j.status}`}>
                          {j.live ? (
                            <Spinner />
                          ) : (
                            <Ico svg={TROUBLE.includes(j.status) ? I.warn : I.check} />
                          )}
                          {LABEL[j.status] || j.status}
                        </span>
                        <div className="job-main">
                          <div className="job-l1">
                            <code>{j.ticketKey}</code>
                            <span className="job-title">{j.title}</span>
                            {!scoped && (
                              <span className="cjp-proj" title={j.projectName}>
                                {j.projectName}
                              </span>
                            )}
                            {scoped &&
                              (() => {
                                const ep = (P()?.epics || []).find(
                                  (e: Any) =>
                                    e.id ===
                                    P()?.tickets.find((t: Any) => t.id === j.ticketId)?.epicId,
                                );
                                return ep ? (
                                  <span className="cjp-proj" title={`Feature: ${ep.title}`}>
                                    {ep.title}
                                  </span>
                                ) : null;
                              })()}
                            {j.side === 'backend' && (
                              <span className="layer-chip l-backend">Backend</span>
                            )}
                          </div>
                          {j.live && j.todosTotal > 0 && (
                            <span
                              className="cjp-plan"
                              aria-label={`Plan ${j.todosDone} of ${j.todosTotal}`}
                            >
                              <span
                                style={{
                                  width: `${Math.round((j.todosDone / j.todosTotal) * 100)}%`,
                                }}
                              />
                            </span>
                          )}
                          <div className="job-l2 muted small">
                            <span>
                              {j.where === 'github' ? 'AI API + GitHub' : 'This computer'}
                            </span>
                            {j.agentName && <span>{j.agentName}</span>}
                            {j.todosTotal > 0 && (
                              <span>
                                Plan {j.todosDone}/{j.todosTotal}
                              </span>
                            )}
                            {j.live && j.last ? (
                              <span className="job-last">{j.last}</span>
                            ) : j.error ? (
                              <span className="job-last bad">{j.error}</span>
                            ) : null}
                            {j.files?.length > 0 && (
                              <span>
                                {j.files.length} file{j.files.length === 1 ? '' : 's'}{' '}
                                <span className="da">+{add}</span>{' '}
                                <span className="dr">−{del}</span>
                              </span>
                            )}
                            {j.costUsd > 0 && <span>${j.costUsd.toFixed(2)}</span>}
                            {j.startedBy && <span>by {j.startedBy}</span>}
                            <span>{ago(j.startedAt)}</span>
                          </div>
                        </div>
                        <div className="cjp-actions">
                          <JobActions j={j} busy={busy} stop={stop} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

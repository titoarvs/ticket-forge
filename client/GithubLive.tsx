'use client';
// Project settings → Code & GitHub → Issues and Projects (TF-140): the repository's GitHub issues
// and GitHub Projects, read live from the GitHub API each time a section opens (nothing is kept
// from an earlier load). Read-only. Shown only to people whose role has the Code & GitHub
// permission (project.repo); the server checks it too. States: loading, "connect GitHub" (no
// connection), "choose a repository", empty, error, list.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { P, api, ago, can, type Any } from './core';
import { SetCard, Ico, I, Loading, Sk, EmptyState, ErrorState } from './ui';

type Section = 'issues' | 'projects';
type Live = { status: 'loading' } | { status: 'ok'; data: Any } | { status: 'error'; error: Any };

/**
 * Reads one section live. Every load (first, retry, refresh) clears what was shown before it asks
 * GitHub, and a failure leaves only the error: earlier data is never shown as current.
 */
function useLive(pid: string, section: Section): [Live, () => Promise<void>] {
  const [live, setLive] = useState<Live>({ status: 'loading' });
  const latest = useRef(0);
  const load = useCallback(async () => {
    const n = ++latest.current;
    setLive({ status: 'loading' });
    try {
      const data = await api(
        `/api/projects/${encodeURIComponent(pid)}/github-live?section=${section}`,
      );
      if (n === latest.current) setLive({ status: 'ok', data });
    } catch (error: Any) {
      if (n === latest.current) setLive({ status: 'error', error });
    }
  }, [pid, section]);
  useEffect(() => {
    load();
    return () => {
      latest.current++;
    };
  }, [load]);
  return [live, load];
}

const rows = (n: number) => (
  <Loading label="Loading from GitHub…">
    <div style={{ display: 'grid', gap: 8 }}>
      {Array.from({ length: n }, (_, i) => (
        <Sk key={i} h={40} r={8} />
      ))}
    </div>
  </Loading>
);

/** The shared states of both sections; the list itself comes from `list`. */
function LiveBody({
  noun,
  live,
  reload,
  empty,
  list,
}: {
  noun: string;
  live: Live;
  reload: () => Promise<void>;
  empty: string;
  list: (data: Any) => React.ReactNode;
}) {
  if (live.status === 'loading') return rows(3);
  if (live.status === 'error')
    return (
      <ErrorState
        compact
        title={`Couldn’t load ${noun} from GitHub`}
        error={live.error}
        onRetry={reload}
      />
    );
  const d = live.data;
  if (!d.connected)
    return (
      <EmptyState compact icon={I.pr} tone="neutral" title="Connect GitHub to see this">
        <p>
          This workspace has no GitHub connection yet. Connect GitHub in{' '}
          {can('users.manage') ? (
            <Link href="/admin/github">admin settings</Link>
          ) : (
            'admin settings'
          )}
          , or in Repository setup above.
        </p>
      </EmptyState>
    );
  if (!d.repo)
    return (
      <EmptyState compact icon={I.pr} tone="neutral" title="Choose a repository first">
        <p>
          Choose this project’s GitHub repository in <b>Repository</b> below to see its {noun}.
        </p>
      </EmptyState>
    );
  const none = d.issues ? !d.issues.length : !d.projects.length;
  if (none)
    return (
      <EmptyState compact icon={I.pr} tone="neutral" title={empty}>
        <p>
          Nothing found in <b>{d.repo}</b> on GitHub.
        </p>
      </EmptyState>
    );
  return <>{list(d)}</>;
}

const refreshButton = (live: Live, reload: () => Promise<void>) => (
  <button className="btn sm" disabled={live.status === 'loading'} onClick={reload}>
    <Ico svg={I.refresh} />
    Refresh
  </button>
);

/** Code & GitHub → Issues. */
export function GithubIssuesCard() {
  const pid = P().id;
  const [live, reload] = useLive(pid, 'issues');
  return (
    <SetCard
      id="github-live-issues"
      title="Issues"
      desc="The issues of the project’s GitHub repository, read from GitHub each time this opens. Read-only."
      right={refreshButton(live, reload)}
    >
      <LiveBody
        noun="issues"
        live={live}
        reload={reload}
        empty="No GitHub issues"
        list={(d) => (
          <>
            <ul className="set-docs" aria-label={`Issues of ${d.repo}`}>
              {d.issues.map((i: Any) => (
                <li key={i.number}>
                  <a href={i.url} target="_blank" rel="noreferrer">
                    <b>#{i.number}</b> {i.title}
                  </a>
                  <span className="muted small">
                    <span className={`loz ${i.state === 'open' ? 's-inprogress' : 't-pass'}`}>
                      {i.state === 'open' ? 'Open' : 'Closed'}
                    </span>{' '}
                    {i.assignee ? `Assigned to ${i.assignee} · ` : ''}
                    {i.labels.length ? `${i.labels.join(', ')} · ` : ''}
                    updated {ago(i.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
            {d.truncated && (
              <p className="muted small set-note">
                Showing the {d.issues.length} most recently updated issues of {d.repo}.
              </p>
            )}
          </>
        )}
      />
    </SetCard>
  );
}

/** Code & GitHub → Projects. */
export function GithubProjectsCard() {
  const pid = P().id;
  const [live, reload] = useLive(pid, 'projects');
  return (
    <SetCard
      id="github-live-projects"
      title="Projects"
      desc="The GitHub Projects (boards) of the project’s repository and its owner, read from GitHub each time this opens. Read-only."
      right={refreshButton(live, reload)}
    >
      <LiveBody
        noun="projects"
        live={live}
        reload={reload}
        empty="No GitHub Projects"
        list={(d) => (
          <ul className="set-docs" aria-label={`GitHub Projects of ${d.repo}`}>
            {d.projects.map((b: Any) => (
              <li key={b.id}>
                <a href={b.url} target="_blank" rel="noreferrer">
                  <b>#{b.number}</b> {b.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      />
    </SetCard>
  );
}

/** The Issues and Projects sections, for people with the Code & GitHub permission only. */
export function GithubLive() {
  if (!can('project.repo')) return null;
  const id = P().id;
  return (
    <>
      <GithubIssuesCard key={`gi-${id}`} />
      <GithubProjectsCard key={`gp-${id}`} />
    </>
  );
}

'use client';
// Project settings → Code & GitHub → GitHub connection and repository (TF-142): whether the project's
// GitHub connection works (connected, not connected, error), Connect GitHub / Disconnect, and the
// repository linked to the project, chosen from the repositories the connection can access.
// Both are stored in the database (github_connections, github_repo_links), so they are the same after
// a reload. Shown and changed only by people whose role has the Code & GitHub permission
// (project.repo); the server checks it too. States: loading, error (with Try again, the saved
// repository is kept), not connected, connected, and an empty repository field.
import { useCallback, useEffect, useRef, useState } from 'react';
import { P, api, ago, can, openModal, toast, type Any } from './core';
import { SetCard, Ico, I, Loading, Sk, EmptyState, ErrorState, Confirm, Spinner } from './ui';
import { TF } from './fields';
import { GitHubConnectModal } from './DevCode/FolderPicker';

type Load = { status: 'loading' } | { status: 'ok'; data: Any } | { status: 'error'; error: Any };
const route = (pid: string) => `/api/projects/${encodeURIComponent(pid)}/github-link`;

/** The status badge: connected, not connected or error. */
function StatusBadge({ status }: { status: string }) {
  return status === 'connected' ? (
    <span className="loz t-pass">Connected</span>
  ) : status === 'error' ? (
    <span className="loz t-fail">Error</span>
  ) : (
    <span className="loz s-todo">Not connected</span>
  );
}

/** Choose, change or clear the repository: a searchable list of what the connection can access. */
function RepoField({
  pid,
  saved,
  onSaved,
}: {
  pid: string;
  saved: Any;
  onSaved: (r: Any) => void;
}) {
  const [repos, setRepos] = useState<Any[] | null>(null);
  const [err, setErr] = useState<Any>(null);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<string>(saved?.fullName || '');
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  const load = useCallback(async () => {
    const n = ++latest.current;
    setErr(null);
    setRepos(null);
    try {
      const r = await api(route(pid), { method: 'POST', body: { action: 'repos' } });
      if (n === latest.current) setRepos(r.repos);
    } catch (e: Any) {
      if (n === latest.current) setErr(e);
    }
  }, [pid]);
  useEffect(() => {
    load();
    return () => {
      latest.current++;
    };
  }, [load]);
  useEffect(() => setDraft(saved?.fullName || ''), [saved?.fullName]);
  const needle = search.trim().toLowerCase();
  const shown = (repos || []).filter(
    (r) => !needle || `${r.fullName} ${r.description}`.toLowerCase().includes(needle),
  );
  const dirty = draft !== (saved?.fullName || '');
  const save = async () => {
    setBusy(true);
    try {
      const r = await api(route(pid), { method: 'POST', body: { action: 'saveRepo', repo: draft } });
      onSaved(r.repo);
      toast(r.repo ? `Linked ${r.repo.fullName}` : 'Repository cleared', 'ok', {
        title: r.repo ? 'Repository saved' : 'Repository cleared',
      });
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ marginTop: 16 }}>
      <h4 className="rc-sub" style={{ marginTop: 0 }}>
        Linked repository
      </h4>
      <div className="rc-current" aria-live="polite">
        {saved ? (
          <div className="gha-text">
            <b>{saved.fullName}</b>
            <span className="muted small">
              {saved.private ? 'Private · ' : ''}
              {saved.defaultBranch ? `${saved.defaultBranch} · ` : ''}saved {ago(saved.selectedAt)}
            </span>
          </div>
        ) : (
          <div className="gha-text">
            <b>No repository linked</b>
            <span className="muted small">Choose one below and save to link it to this project.</span>
          </div>
        )}
      </div>
      {err ? (
        <ErrorState
          compact
          title="Couldn’t load your repositories"
          error={err}
          onRetry={load}
        />
      ) : !repos ? (
        <Loading label="Loading your repositories…">
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            <Sk h={40} r={8} />
            <Sk h={40} r={8} />
          </div>
        </Loading>
      ) : (
        <>
          <div style={{ marginTop: 10 }}>
            <TF
              search
              value={search}
              placeholder="Search the repositories this connection can access"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <ul className="gr-list" aria-label="Repositories this connection can access">
            {shown.slice(0, 200).map((r) => (
              <li key={r.fullName}>
                <button
                  type="button"
                  aria-pressed={draft === r.fullName}
                  disabled={busy}
                  onClick={() => setDraft(r.fullName)}
                >
                  <span className="gr-name">
                    {draft === r.fullName && <Ico svg={I.check} />}
                    <b>{r.fullName}</b>
                    {r.private && <span className="ag-chip tiny">Private</span>}
                    {r.archived && <span className="ag-chip tiny">Archived</span>}
                  </span>
                  {r.description && <span className="muted small gr-desc">{r.description}</span>}
                </button>
              </li>
            ))}
            {!shown.length && (
              <li className="muted small" style={{ padding: 12 }}>
                {repos.length ? 'No repositories match.' : 'This connection can’t access any repositories.'}
              </li>
            )}
          </ul>
        </>
      )}
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="btn primary sm" disabled={!dirty || busy} onClick={save}>
          {busy ? (
            <>
              <Spinner />
              Saving…
            </>
          ) : (
            'Save repository'
          )}
        </button>
        <button className="btn subtle sm" disabled={!draft || busy} onClick={() => setDraft('')}>
          Clear selection
        </button>
        {dirty && !draft && (
          <span className="muted small">Save to unlink {saved?.fullName} from this project.</span>
        )}
      </div>
    </div>
  );
}

/** Code & GitHub → GitHub connection and repository. */
export function GithubConnectionCard() {
  const pid = P().id;
  const allowed = can('project.repo');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const n = ++latest.current;
    setLoad({ status: 'loading' });
    try {
      const data = await api(route(pid));
      if (n === latest.current) setLoad({ status: 'ok', data });
    } catch (error: Any) {
      if (n === latest.current) setLoad({ status: 'error', error });
    }
  }, [pid]);
  useEffect(() => {
    if (allowed) reload();
    return () => {
      latest.current++;
    };
  }, [allowed, reload]);

  const card = (children: React.ReactNode, right?: React.ReactNode) => (
    <SetCard
      id="github-connection"
      title="GitHub connection and repository"
      desc="Whether this project’s GitHub connection works, and the repository linked to the project, chosen from the repositories the connection can access."
      right={right}
    >
      {children}
    </SetCard>
  );
  if (!allowed)
    return card(
      <p className="muted small" style={{ margin: 0 }}>
        Connecting GitHub and choosing the repository needs the <b>Set up the repository</b>{' '}
        permission. Ask an administrator for it.
      </p>,
    );
  if (load.status === 'loading')
    return card(
      <Loading label="Checking the GitHub connection…">
        <Sk h={56} r={8} />
      </Loading>,
    );
  if (load.status === 'error')
    return card(
      <ErrorState
        compact
        title="Couldn’t load the GitHub connection"
        error={load.error}
        onRetry={reload}
      />,
    );

  const d = load.data;
  const connect = () =>
    openModal(<GitHubConnectModal route="github-link" env={d} onDone={() => reload()} />);
  const disconnect = () =>
    openModal(
      <Confirm
        title={d.account ? `Disconnect @${d.account.login}?` : 'Disconnect GitHub?'}
        label="Disconnect"
        text="TicketForge forgets this project’s GitHub token. The repository linked to the project stays saved."
        onYes={async () => {
          await api(route(pid), { method: 'POST', body: { action: 'disconnect' } });
          toast('GitHub disconnected');
          await reload();
        }}
      />,
    );
  const saveToken = async () => {
    setBusy(true);
    try {
      await api(route(pid), { method: 'POST', body: { action: 'saveToken', token } });
      setToken('');
      toast('GitHub token saved (encrypted)');
      await reload();
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const connected = d.status === 'connected';
  const failed = d.status === 'error';
  return card(
    <>
      <div className={`gha-row ${connected ? 'ok' : ''}`}>
        {connected && d.account?.avatar ? (
          <img src={d.account.avatar} alt="" width={36} height={36} />
        ) : (
          <span className="gha-icon">
            <Ico svg={failed ? I.warn : I.pr} />
          </span>
        )}
        <div className="gha-text" role="status">
          <span className="row" style={{ gap: 8, alignItems: 'center' }}>
            <StatusBadge status={d.status} />
            {d.account && (
              <b>
                @{d.account.login}
                {d.account.name ? ` · ${d.account.name}` : ''}
              </b>
            )}
          </span>
          <span className="muted small">
            {connected
              ? `${d.source === 'workspace' ? 'Using GITHUB_TOKEN from the server' : 'Connected'}${
                  d.connectedAt ? ` ${ago(d.connectedAt)}` : ''
                } · checked just now`
              : failed
                ? 'GitHub didn’t accept this connection.'
                : 'Connect your GitHub account to choose a repository.'}
          </span>
        </div>
        <span className="spacer" />
        {connected && d.source === 'project' && (
          <button className="btn subtle" onClick={disconnect}>
            Disconnect
          </button>
        )}
        {!connected && !failed && (
          <button className="btn primary" onClick={connect}>
            <Ico svg={I.pr} />
            Connect GitHub
          </button>
        )}
      </div>
      {failed && (
        <ErrorState
          compact
          title="The GitHub connection has a problem"
          error={d.error}
          onRetry={reload}
          actions={
            <>
              <button className="btn" onClick={connect}>
                <Ico svg={I.pr} />
                Reconnect GitHub
              </button>
              {d.source === 'project' && (
                <button className="btn subtle" onClick={disconnect}>
                  Disconnect
                </button>
              )}
            </>
          }
        >
          <p>
            {d.repo
              ? `Your saved repository (${d.repo.fullName}) is kept.`
              : 'No repository is linked yet.'}
          </p>
        </ErrorState>
      )}
      {!connected && !failed && (
        <details className="gha-pat">
          <summary className="small">Use a personal access token instead</summary>
          <p className="muted small" style={{ margin: '6px 0' }}>
            A fine-grained token with Contents and Pull requests (read and write) on the
            repositories. Stored encrypted.
          </p>
          <div className="dev-path">
            <TF
              type="password"
              autoComplete="off"
              value={token}
              placeholder="github_pat_… or ghp_…"
              onChange={(e) => setToken(e.target.value)}
            />
            <button className="btn" disabled={!token.trim() || busy} onClick={saveToken}>
              Save token
            </button>
          </div>
        </details>
      )}
      {connected && (
        <RepoField
          pid={pid}
          saved={d.repo}
          onSaved={(repo) => setLoad({ status: 'ok', data: { ...d, repo } })}
        />
      )}
      {!connected && d.repo && (
        <div className="rc-current" style={{ marginTop: 12 }}>
          <div className="gha-text">
            <b>{d.repo.fullName}</b>
            <span className="muted small">
              Linked repository, kept until GitHub is connected again.
            </span>
          </div>
        </div>
      )}
      {!connected && !failed && !d.repo && (
        <EmptyState compact icon={I.pr} tone="neutral" title="No repository linked">
          <p>Connect GitHub to choose this project’s repository.</p>
        </EmptyState>
      )}
    </>,
    <button className="btn sm" onClick={reload} disabled={busy}>
      <Ico svg={I.refresh} />
      Refresh
    </button>,
  );
}

'use client';
import { useState, useEffect } from 'react';
import { type Any, api, P, closeModal, ago, openModal, toast } from '../core';
import { Modal, Ico, I, Spinner, Confirm, SetCard } from '../ui';
import { TF } from '../fields';
import { dev } from './dev';
import { GitHubConnectModal, setDev } from './FolderPicker';

/** Your GitHub repositories, searchable; picking one fills the clone form and clones it. */
export function RepoPickerModal({ onPick }: { onPick: (r: Any) => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Any[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api(`/api/projects/${P().id}/dev`, { method: 'POST', body: { action: 'ghRepos' } })
      .then((r) => setList(r.repos))
      .catch((e) => {
        setErr(e.message);
        setList([]);
      });
  }, []);
  const needle = q.trim().toLowerCase();
  const shown = (list || []).filter(
    (r) => !needle || `${r.fullName} ${r.description}`.toLowerCase().includes(needle),
  );
  return (
    <Modal title="Choose a repository" wide actions={[{ label: 'Cancel' }]}>
      <TF
        search
        autoFocus
        value={q}
        placeholder="Search your repositories"
        onChange={(e) => setQ(e.target.value)}
      />
      {err && (
        <div className="warn-banner danger" style={{ marginTop: 8 }}>
          <Ico svg={I.warn} />
          <span>{err}</span>
        </div>
      )}
      {!list ? (
        <p className="muted">
          <Spinner /> Loading your repositories…
        </p>
      ) : (
        <ul className="gr-list">
          {shown.slice(0, 200).map((r) => (
            <li key={r.fullName}>
              <button
                onClick={() => {
                  closeModal();
                  onPick(r);
                }}
                disabled={r.archived}
              >
                <span className="gr-name">
                  <b>{r.fullName}</b>
                  {r.private && <span className="ag-chip tiny">Private</span>}
                  {r.archived && <span className="ag-chip tiny">Archived</span>}
                </span>
                {r.description && <span className="muted small gr-desc">{r.description}</span>}
                <span className="muted small">
                  {r.language ? `${r.language} · ` : ''}
                  {r.defaultBranch} · updated {ago(r.updatedAt)}
                  {r.permissions?.push === false ? ' · read-only for you' : ''}
                </span>
              </button>
            </li>
          ))}
          {!shown.length && (
            <li className="muted small" style={{ padding: 12 }}>
              No repositories match.
            </li>
          )}
        </ul>
      )}
    </Modal>
  );
}
/**
 * Project settings → Code & GitHub → GitHub account: who TicketForge acts as on GitHub (clone,
 * push, pull requests).
 */
export function GitHubAccountCard({
  ed,
  env,
  setEnv,
}: {
  ed: boolean;
  env: Any;
  setEnv: (e: Any) => void;
}) {
  const acct = dev().githubAccount;
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const local = env?.local !== false; // on this computer git uses your own sign-in; the token is for the deployed app
  const connected = Boolean(acct && env?.hasToken);
  const how = connected
    ? null
    : env?.hasToken
      ? 'A personal access token is saved for this project (encrypted).'
      : env?.envToken
        ? 'Using GITHUB_TOKEN from the server.'
        : env?.ghSignedIn
          ? 'Using the GitHub CLI sign-in (gh) on this computer.'
          : null;
  const connect = () =>
    openModal(
      <GitHubConnectModal
        env={env}
        onDone={(a) => {
          setDev('githubAccount', { ...a, connectedAt: new Date().toISOString() });
          setEnv({ ...env, hasToken: true });
        }}
      />,
    );
  const forget = () =>
    openModal(
      <Confirm
        title={connected ? `Disconnect @${acct.login}?` : 'Remove the saved token?'}
        label={connected ? 'Disconnect' : 'Remove'}
        text="TicketForge forgets this project’s GitHub token. Repositories already set up stay; cloning private repositories, pushing and pull requests need a token or your gh sign-in again."
        onYes={async () => {
          await api(`/api/projects/${P().id}/dev`, {
            method: 'POST',
            body: { action: 'clearToken' },
          });
          setDev('githubAccount', null);
          setEnv({ ...env, hasToken: false });
          toast(connected ? 'GitHub disconnected' : 'Token removed');
        }}
      />,
    );
  const saveToken = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/projects/${P().id}/dev`, {
        method: 'POST',
        body: { action: 'saveToken', token },
      });
      setDev('githubAccount', null);
      setEnv({ ...env, hasToken: r.hasToken });
      setToken('');
      toast('GitHub token saved (encrypted)');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <SetCard
      id="gh-account"
      title={local ? 'GitHub account (optional here)' : 'GitHub account'}
      desc={
        local
          ? 'On this computer, cloning, pushing and pull requests use your own git setup (SSH key or credential helper), so you don’t need to connect GitHub. Connect it only to pick from your list of repositories, or if git can’t sign in.'
          : 'How the deployed TicketForge signs in to GitHub to read your repositories, push branches and open pull requests. Required here: there is no git sign-in on a server.'
      }
    >
      <div className={`gha-row ${connected || how ? 'ok' : ''}`}>
        {connected && acct.avatar ? (
          <img src={acct.avatar} alt="" width={36} height={36} />
        ) : (
          <span className="gha-icon">
            <Ico svg={I.pr} />
          </span>
        )}
        <div className="gha-text">
          {connected ? (
            <>
              <b>Connected as @{acct.login}</b>
              <span className="muted small">
                {acct.name ? `${acct.name} · ` : ''}connected {ago(acct.connectedAt)} · repo,
                read:org and workflow access
              </span>
            </>
          ) : how ? (
            <>
              <b>Signed in</b>
              <span className="muted small">{how}</span>
            </>
          ) : local ? (
            <>
              <b>Not needed on this computer</b>
              <span className="muted small">
                Git uses your own sign-in. Connect only to choose from your GitHub repositories in a
                list.
              </span>
            </>
          ) : (
            <>
              <b>Not connected</b>
              <span className="muted small">
                Connect your GitHub account to choose from all your repositories and open pull
                requests.
              </span>
            </>
          )}
        </div>
        <span className="spacer" />
        {ed &&
          (connected ? (
            <button className="btn subtle" onClick={forget}>
              Disconnect
            </button>
          ) : (
            <>
              <button className={local ? 'btn' : 'btn primary'} onClick={connect}>
                <Ico svg={I.pr} />
                {how
                  ? 'Connect your account'
                  : local
                    ? 'Connect GitHub (optional)'
                    : 'Connect GitHub'}
              </button>
              {env?.hasToken && (
                <button className="btn subtle" onClick={forget}>
                  Remove token
                </button>
              )}
            </>
          ))}
      </div>
      {ed && !connected && (
        <details className="gha-pat">
          <summary className="small">Use a personal access token instead</summary>
          <p className="muted small" style={{ margin: '6px 0' }}>
            A fine-grained token with Contents and Pull requests (read and write) on the
            repositories, plus Workflows for GitHub Actions. Stored encrypted.
          </p>
          <div className="dev-path">
            <TF
              type="password"
              autoComplete="off"
              value={token}
              placeholder={env?.hasToken ? 'Replace the saved token' : 'github_pat_… or ghp_…'}
              onChange={(e) => setToken(e.target.value)}
            />
            <button className="btn" disabled={!token.trim() || busy} onClick={saveToken}>
              Save token
            </button>
          </div>
        </details>
      )}
    </SetCard>
  );
}
/**
 * On the deployed app nothing is cloned: GitHub repositories are used through GitHub (Actions and
 * the API).
 */
export const DEPLOYED_HINT: Record<string, string> = {
  github: 'Pick one from your account; used through GitHub, nothing to clone.',
  url: 'A GitHub URL or owner/name; used through GitHub.',
  folder: 'Only when TicketForge runs on that computer.',
};
export const SOURCES: [string, string, string][] = [
  [
    'github',
    'Your GitHub repositories',
    'Pick one from your account; TicketForge clones it for you.',
  ],
  [
    'url',
    'Git URL',
    'Any https or SSH URL (GitHub, GitLab, others); cloned with your own git sign-in, no token needed.',
  ],
  ['folder', 'Folder on this computer', 'A clone you already have.'],
];

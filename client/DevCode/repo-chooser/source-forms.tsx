'use client';
// Choosing a new repository: from GitHub, a Git URL, or a folder on this computer.
import { useState } from 'react';
import { openModal, runPlace } from '../../core';
import { Ico, I, Spinner } from '../../ui';
import { TF } from '../../fields';
import { GitHubConnectModal, setDev, FolderPicker } from '../FolderPicker';
import { SOURCES, DEPLOYED_HINT, RepoPickerModal } from '../GitHubAccountCard';
import { ghName } from './repo-facts';
import type { Repo } from './use-repo';

export function SourceTabs({ r }: { r: Repo }) {
  return (
    <div className="rc-sources" role="radiogroup" aria-label="Where the repository comes from">
      {SOURCES.map(([k, l, h]) => (
        <button
          key={k}
          role="radio"
          aria-checked={r.mode === k}
          className={r.mode === k ? 'on' : ''}
          disabled={!r.allowed || (k === 'folder' && !r.f.local)}
          onClick={() => r.pickMode(k)}
        >
          <Ico svg={k === 'folder' ? I.folder : I.pr} />
          <b>{l}</b>
          <span className="muted small">{r.f.local ? h : DEPLOYED_HINT[k]}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Pick from the repositories your GitHub sign-in sees: on this computer it is cloned (unless code
 * runs on GitHub); deployed it is used through GitHub.
 */
function PickFromGitHub({ r }: { r: Repo }) {
  const onPick = (repo: { cloneUrl: string; fullName: string; defaultBranch: string }) =>
    r.f.local && runPlace() !== 'github'
      ? r.clone(repo.cloneUrl, '')
      : r.pickRemote(repo.fullName, repo.defaultBranch);
  return (
    <>
      <p className="small muted" style={{ margin: 0 }}>
        Personal and organisation repositories your GitHub sign-in can see.
      </p>
      <button
        className="btn primary"
        disabled={!r.allowed || r.working}
        onClick={() => openModal(<RepoPickerModal onPick={onPick} />)}
      >
        <Ico svg={I.search} />
        Choose a repository
      </button>
    </>
  );
}

function ConnectGitHub({ r, setEnv }: { r: Repo; setEnv: (e: unknown) => void }) {
  const local = r.f.local;
  const connect = () =>
    openModal(
      <GitHubConnectModal
        env={r.env}
        onDone={(a) => {
          setDev('githubAccount', { ...a, connectedAt: new Date().toISOString() });
          setEnv({ ...r.env, hasToken: true });
        }}
      />,
    );
  return (
    <>
      <p className="small muted" style={{ margin: 0 }}>
        {local
          ? 'Listing your repositories needs a GitHub sign-in (optional on this computer). Or use a Git URL: it is cloned with your own git sign-in, no token needed.'
          : 'Connect GitHub first (GitHub account, above), or use a GitHub URL.'}
      </p>
      <button className={local ? 'btn' : 'btn primary'} disabled={!r.canEdit} onClick={connect}>
        <Ico svg={I.pr} />
        {local ? 'Connect GitHub (optional)' : 'Connect GitHub'}
      </button>
    </>
  );
}

export function GitHubForm({ r, setEnv }: { r: Repo; setEnv: (e: unknown) => void }) {
  return (
    <div className="rc-form">
      {r.f.canList ? <PickFromGitHub r={r} /> : <ConnectGitHub r={r} setEnv={setEnv} />}
    </div>
  );
}

/** On this computer the URL is cloned; deployed, only GitHub repositories can be used (through GitHub). */
export function UrlForm({ r }: { r: Repo }) {
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const off = !r.allowed || r.working;
  const use = async () => {
    if (r.f.local) {
      if (await r.clone(url.trim(), branch.trim())) setUrl('');
    } else if (ghName(url)) {
      r.pickRemote(ghName(url), branch.trim());
      setUrl('');
    } else
      r.setErr(
        'From the deployed TicketForge, use a GitHub repository (owner/name or its GitHub URL).',
      );
  };
  return (
    <div className="rc-form dev-path">
      <label className="field" style={{ flex: 2, margin: 0 }}>
        <span>Repository URL</span>
        <TF
          disabled={off}
          value={url}
          spellCheck={false}
          placeholder="https://github.com/owner/repo, git@gitlab.com:group/repo.git or owner/repo"
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <label className="field" style={{ flex: 1, margin: 0 }}>
        <span>Branch (optional)</span>
        <TF
          disabled={off}
          value={branch}
          spellCheck={false}
          placeholder="default branch"
          onChange={(e) => setBranch(e.target.value)}
        />
      </label>
      <button className="btn primary" disabled={off || !url.trim()} onClick={use}>
        {r.f.local ? 'Clone' : 'Use'}
      </button>
    </div>
  );
}

export function FolderForm({ r }: { r: Repo }) {
  const { f } = r;
  const [folder, setFolder] = useState(f.lpath && !f.isClone ? f.lpath : '');
  const browse = () =>
    openModal(
      <FolderPicker
        start={folder || f.lpath || ''}
        onPick={(p) => {
          setFolder(p);
          r.chooseFolder(p);
        }}
      />,
    );
  return (
    <div className="rc-form dev-path">
      <label className="field" style={{ flex: 1, margin: 0 }}>
        <span>Folder</span>
        <TF
          disabled={!r.allowed}
          value={folder}
          spellCheck={false}
          placeholder="/Users/you/code/my-app"
          onChange={(e) => setFolder(e.target.value)}
        />
      </label>
      <button className="btn" disabled={!r.allowed || !f.local} onClick={browse}>
        <Ico svg={I.folder} />
        Browse…
      </button>
      <button
        className="btn primary"
        disabled={!r.allowed || !f.local || !folder.trim() || !!r.busy}
        onClick={() => r.chooseFolder(folder.trim())}
      >
        {r.busy === 'check' ? (
          <>
            <Spinner />
            Checking…
          </>
        ) : (
          'Use this folder'
        )}
      </button>
    </div>
  );
}

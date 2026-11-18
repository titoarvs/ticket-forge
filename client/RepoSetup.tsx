'use client';
// Project settings → Code & GitHub → Repository setup (TF-110): link this project's local repository and connect GitHub.
// The server checks each value first; only accepted values are saved on this project.
import { useState } from 'react';
import { P, api, mutate, toast, type Any } from './core';
import { SetCard, Spinner } from './ui';
import { TF } from './fields';

export function RepoSetupCard() {
  const p = P();
  const [dir, setDir] = useState(p.dev?.localPath || '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const gh = p.dev?.github;
  const savePath = async () => {
    setBusy('path');
    try {
      const r = await api(`/api/projects/${p.id}/repo`, { method: 'POST', body: { localPath: dir } });
      mutate((pp: Any) => {
        pp.dev = { ...(pp.dev || {}), localPath: r.localPath };
      });
      setDir(r.localPath);
      toast(`Linked ${r.localPath}`, 'ok', { title: 'Repository linked' });
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const connect = async () => {
    setBusy('gh');
    try {
      const r = await api(`/api/projects/${p.id}/repo`, { method: 'POST', body: { githubToken: token } });
      mutate((pp: Any) => {
        pp.dev = { ...(pp.dev || {}), github: { login: r.account.login, name: r.account.name, at: new Date().toISOString() } };
      });
      setToken('');
      toast(`Connected as @${r.account.login}`, 'ok', { title: 'GitHub connected' });
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  return (
    <SetCard
      id="repo-setup"
      title="Repository setup"
      desc="Link this project’s local git repository and connect GitHub. Each project keeps its own setup."
    >
      <label className="field">
        <span>Local repository path</span>
        <TF value={dir} placeholder="/Users/me/code/my-app" onChange={(e) => setDir(e.target.value)} />
        <small className="muted">
          {p.dev?.localPath ? (
            <>
              Linked: <code>{p.dev.localPath}</code>
            </>
          ) : (
            'No repository linked yet.'
          )}
        </small>
      </label>
      <div className="row" style={{ gap: 8, margin: '8px 0 16px' }}>
        <button className="btn primary sm" disabled={!dir.trim() || Boolean(busy)} onClick={savePath}>
          {busy === 'path' ? (
            <>
              <Spinner />
              Checking…
            </>
          ) : (
            'Save path'
          )}
        </button>
      </div>
      <label className="field">
        <span>GitHub token</span>
        <TF type="password" value={token} placeholder="ghp_…" onChange={(e) => setToken(e.target.value)} />
        <small className="muted">
          {gh?.login ? (
            <>
              GitHub connected as <b>@{gh.login}</b>
            </>
          ) : (
            'GitHub not connected.'
          )}
        </small>
      </label>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button className="btn sm" disabled={!token.trim() || Boolean(busy)} onClick={connect}>
          {busy === 'gh' ? (
            <>
              <Spinner />
              Connecting…
            </>
          ) : gh?.login ? (
            'Reconnect GitHub'
          ) : (
            'Connect GitHub'
          )}
        </button>
      </div>
    </SetCard>
  );
}

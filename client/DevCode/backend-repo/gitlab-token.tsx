'use client';
// The GitLab access token for a GitLab backend: saved for the project (encrypted), from the
// server's GITLAB_TOKEN, or none (push with your own git sign-in and open the request yourself).
import { useState } from 'react';
import { type Any, api, P, toast } from '../../core';
import { TF } from '../../fields';

type TokenProps = {
  ed: boolean;
  env: Any;
  setEnv: (e: Any) => void;
  busy: string;
  setBusy: (b: string) => void;
};

function tokenState(env: Any) {
  if (env?.hasGitlabToken) return 'A token is saved for this project (encrypted).';
  if (env?.envGitlabToken) return 'Using GITLAB_TOKEN from the server.';
  return 'No token: the branch is pushed with your own git sign-in, and you open the merge request on GitLab from the link given.';
}

export function GitlabToken({ ed, env, setEnv, busy, setBusy }: TokenProps) {
  const [token, setToken] = useState('');
  /** Saves the typed token, or (clear) removes the saved one. */
  const save = async (clear = false) => {
    setBusy('gl');
    try {
      const r = await api(`/api/projects/${P().id}/dev`, {
        method: 'POST',
        body: clear ? { action: 'clearGitlabToken' } : { action: 'saveGitlabToken', token },
      });
      setEnv({ ...env, hasGitlabToken: r.hasGitlabToken });
      setToken('');
      toast(clear ? 'GitLab token removed' : 'GitLab token saved');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const ok = env?.hasGitlabToken || env?.envGitlabToken;
  return (
    <div className="field" style={{ marginTop: 4 }}>
      <span>GitLab access token</span>
      <p className="small" style={{ margin: '0 0 6px' }}>
        <span className={`dot ${ok ? 'ok' : 'bad'}`} style={{ marginRight: 6 }} />
        {tokenState(env)}
      </p>
      {ed && (
        <div className="dev-path">
          <TF
            type="password"
            autoComplete="off"
            value={token}
            placeholder={
              env?.hasGitlabToken
                ? 'Replace the saved token'
                : 'glpat-… (scopes: api, write_repository)'
            }
            onChange={(e) => setToken(e.target.value)}
          />
          <button className="btn" disabled={!token.trim() || !!busy} onClick={() => save()}>
            Save token
          </button>
          {env?.hasGitlabToken && (
            <button className="btn subtle" disabled={!!busy} onClick={() => save(true)}>
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

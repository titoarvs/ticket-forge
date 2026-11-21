'use client';
// Administration → GitHub (TF-140): whether the workspace has a GitHub connection, and what to do
// when it doesn't. The Issues and Projects sections of every project's Code & GitHub read through
// it. Choosing the connection method and the repository is done per project in Project settings →
// Code & GitHub.
import { useEffect, useState } from 'react';
import { api, type Any } from '../core';
import { Loading, Sk, ErrorState } from '../ui';

/** The sentence under the status badge. */
const message = (st: Any) =>
  st.shared
    ? 'GitHub is connected for the whole workspace. Every project’s Issues and Projects sections read live from GitHub through it.'
    : st.projects
      ? `GitHub is connected for ${st.projects} of ${st.total} project${st.total === 1 ? '' : 's'}. The others show a message asking to connect GitHub until they are connected.`
      : 'GitHub isn’t connected. The Issues and Projects sections of Code & GitHub show a message asking to connect GitHub and no GitHub data. Connect GitHub in a project’s Project settings → Code & GitHub → Repository setup.';

/** Administration → GitHub. */
export function GithubTab() {
  const [st, setSt] = useState<Any>(null);
  const [err, setErr] = useState<Any>(null);
  const load = () =>
    api('/api/admin/github')
      .then((d) => {
        setSt(d);
        setErr(null);
      })
      .catch(setErr);
  useEffect(() => {
    load();
  }, []);
  if (err)
    return (
      <div className="card">
        <ErrorState
          compact
          title="Couldn’t load the GitHub connection"
          error={err}
          onRetry={() => {
            setErr(null);
            return load();
          }}
        />
      </div>
    );
  if (!st)
    return (
      <div className="card">
        <Loading label="Loading the GitHub connection…">
          <Sk h={40} r={8} />
        </Loading>
      </div>
    );
  return (
    <div className="cards">
      <div className="card wide">
        <h3>Connection</h3>
        <p className="sub">One GitHub connection per workspace, shared by all projects.</p>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <span className={`loz ${st.connected ? 't-pass' : 's-todo'}`}>
            {st.connected ? 'Connected' : 'Not connected'}
          </span>
          <span className="muted small" role="status">
            {message(st)}
          </span>
        </div>
      </div>
    </div>
  );
}

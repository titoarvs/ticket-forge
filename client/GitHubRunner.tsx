'use client';
// Test automation → Settings → GitHub Actions: run the Playwright tests on GitHub's machines instead of this server.
// Setup sets a repository secret and opens a pull request with the workflow; once it's merged, runs go there.
import { useEffect, useState } from 'react';
import { P, api, can, mutate, toast, ago, useStore, runPlace, setRunPlace, isDeployed, type Any } from './core';
import { Ico, I, Spinner } from './ui';
import { TF } from './fields';
import { collectGitHubRun } from './actions';

export function GitHubRunner() {
  useStore();
  const p = P();
  const cfg = p.automation?.github || {};
  const ed = can('project.settings');
  const [repo, setRepo] = useState(cfg.repo || p.dev?.repo || '');
  const [ref, setRef] = useState(cfg.ref || '');
  const [status, setStatus] = useState<Any>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const check = async (r = repo) => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(r.trim())) { setError('Enter the repository as owner/name, e.g. titoarvs/my-app-tests.'); return; }
    setBusy('check'); setError('');
    try { const st = await api(`/api/automation/github?projectId=${encodeURIComponent(p.id)}&repo=${encodeURIComponent(r.trim())}`); setStatus(st); if (!ref) setRef(st.defaultBranch || 'main'); }
    catch (e: Any) { setStatus(null); setError(e.message); } finally { setBusy(''); }
  };
  useEffect(() => { if (cfg.repo) check(cfg.repo); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const saveCfg = (extra: Any = {}) => mutate((pp: Any) => { pp.automation.github = { ...(pp.automation.github || {}), repo: repo.trim(), ref: (ref || status?.defaultBranch || 'main').trim(), ...extra }; });
  const setup = async () => {
    setBusy('setup'); setError('');
    try {
      const r = await api('/api/automation/github', { method: 'POST', body: { action: 'setup', projectId: p.id, repo: repo.trim() } });
      saveCfg({ setupPr: r.pr, setupAt: new Date().toISOString() });
      toast(`${r.created ? 'Opened' : 'Updated'} pull request #${r.pr.number}. Merge it, then press Check.`, 'ok', { title: 'Runner ready to merge', action: { label: 'Open', onClick: () => window.open(r.pr.url, '_blank', 'noopener') } });
      await check();
    } catch (e: Any) { setError(e.message); } finally { setBusy(''); }
  };
  const deployed = isDeployed();
  const on = runPlace() === 'github';
  const pending = p.automation?.ghPending;
  return (
    <div className="rb ghr">
      <div className="rb-h"><Ico svg={I.pr} /><b>GitHub Actions</b>
        <span className="muted small">{on ? 'Tests run on GitHub Actions' : status?.ready ? 'Ready' : 'Run tests on GitHub’s machines'}</span></div>
      <p className="muted small" style={{ margin: '4px 0 10px' }}>Run the Playwright tests on GitHub instead of this server: no browser needed here (works on Vercel), free for public repositories and within your plan’s Actions minutes for private ones.
        TicketForge sends each run encrypted (scripts and test passwords) to a workflow in the repository, then reads the results back. Each run takes about a minute to start.
        It uses the project’s GitHub token (Project settings → Code & GitHub) or your <code>gh</code> sign-in; the token needs Actions, Contents, Pull requests, Secrets and Workflows (read and write) on the repository.</p>
      <div className="rb-form">
        <label className="field" style={{ flex: 2, margin: 0 }}><span>Repository</span><TF value={repo} disabled={!ed} spellCheck={false} placeholder="owner/name" onChange={(e) => setRepo(e.target.value)} /></label>
        <label className="field" style={{ flex: 1, margin: 0 }}><span>Branch</span><TF value={ref} disabled={!ed} spellCheck={false} placeholder={status?.defaultBranch || 'main'} onChange={(e) => setRef(e.target.value)} /></label>
        <button className="btn" disabled={!!busy || !repo.trim()} onClick={() => check()}>{busy === 'check' ? <><Spinner />Checking…</> : 'Check'}</button>
        {ed && <button className="btn primary" disabled={!!busy || !repo.trim()} onClick={setup}>{busy === 'setup' ? <><Spinner />Setting up…</> : status?.checks?.some((c: Any) => c.label !== 'Repository' && !c.ok) || !status ? 'Set up' : 'Update runner'}</button>}
      </div>
      {error && <div className="warn-banner danger" style={{ marginTop: 10 }}><Ico svg={I.warn} /><span>{error}</span></div>}
      {status && <ul className="ghr-checks">{status.checks.map((c: Any) => <li key={c.label} className={c.ok ? 'ok' : 'bad'}><span className={`dot ${c.ok ? 'ok' : 'bad'}`} /><b>{c.label}</b><span className="muted">{c.detail}</span></li>)}</ul>}
      {status?.setupPr && !status.ready && <div className="warn-banner" style={{ marginTop: 8 }}><Ico svg={I.pr} /><span>Merge <a href={status.setupPr.url} target="_blank" rel="noopener noreferrer">pull request #{status.setupPr.number}</a> into {status.defaultBranch}, then press Check. GitHub only starts workflows that are on the default branch.</span></div>}
      <div className="ghr-switch">
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={on} disabled={deployed || (!on && !status?.ready && !cfg.repo)} onChange={(e) => { if (e.target.checked && ed) saveCfg(); setRunPlace(e.target.checked ? 'github' : 'local'); toast(e.target.checked ? 'Tests and code jobs now run on GitHub Actions' : 'Tests and code jobs run on this computer again'); }} />
          <span><b>Run on GitHub Actions</b> <span className="muted small">{deployed ? '(always, on the deployed TicketForge)' : !status?.ready && !on && !cfg.repo ? '(finish the setup first)' : `in ${repo || cfg.repo} @ ${ref || cfg.ref || 'the default branch'} · your choice on this computer`}</span></span>
        </label>
      </div>
      {pending && <div className="warn-banner" style={{ marginTop: 10 }}><Spinner /><span>A run started {ago(pending.at)} is still on GitHub Actions{pending.runs?.[0]?.url ? <> (<a href={pending.runs[0].url} target="_blank" rel="noopener noreferrer">open</a>)</> : null}.</span>
        <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => collectGitHubRun()}>Collect results</button>
        {ed && <button className="btn sm subtle" onClick={() => mutate((pp: Any) => { delete pp.automation.ghPending; })}>Forget it</button>}</div>}
    </div>
  );
}

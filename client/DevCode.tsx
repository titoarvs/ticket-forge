'use client';
// Code & GitHub: a project's local repository and GitHub settings, and the "Write code with AI" job for an issue:
// Claude Code implements it in its own git worktree, you review the diff, TicketForge opens the pull request.
import { useEffect, useRef, useState } from 'react';
import { refreshCodeStatus } from './codeStatus';
import { readNdjson, S, P, feat, api, startTask, aiBody, setField, downloadFrom, saveBlob, can, mutate, toast, openModal, closeModal, uid, nowIso, logEvent, ago, emit, runPlace, setRunPlace, type Any } from './core';
import { Ico, I, Modal, Spinner, Confirm, SetCard, LAYER_LABEL } from './ui';
import { TF, TA, SF, CB, MenuItem } from './fields';
import { Markdown } from './GuideCard';
import { CodeRabbitPanel, saveReview, setPrFixer } from './CodeRabbit';
import { DiffReview } from './DiffReview';
import { ParallelCheck } from './DevPlan';

const dev = () => P().dev || {};
const be = () => P().devBackend || {};
const setBe = (k: string, v: Any) => mutate((pp) => { pp.devBackend = { ...(pp.devBackend || {}), [k]: v }; }, { tag: `devBackend.${k}` });
/** The project has a separate backend repository set up. */
/** This person's own folder for a repository (set up on their computer), else the project's shared one. */
const myPath = (side: 'frontend' | 'backend'): string => S.auth?.prefs?.local?.[P().id]?.[side]?.path || (side === 'backend' ? be().localPath : dev().localPath) || '';
const hasBackend = () => Boolean(be().enabled && myPath('backend'));
const setDev = (k: string, v: Any) => mutate((pp) => { pp.dev = { ...(pp.dev || {}), [k]: v }; }, { tag: `dev.${k}` });

/** Pick a folder on this computer: click through folders (git repositories are marked), then choose one. */
export function FolderPicker({ start, onPick, title = 'Choose the repository folder', hint }: { start: string; onPick: (path: string) => void; title?: string; hint?: string }) {
  const [at, setAt] = useState<Any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (path: string) => {
    setBusy(true); setErr('');
    try { setAt(await api(`/api/projects/${P().id}/dev`, { method: 'POST', body: { action: 'browse', path } })); }
    catch (e: Any) { setErr(e.message); if (!at) setAt(await api(`/api/projects/${P().id}/dev`, { method: 'POST', body: { action: 'browse', path: '' } }).catch(() => null)); }
    finally { setBusy(false); }
  };
  useEffect(() => { go(start); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const crumbs = at ? at.path.split('/').filter(Boolean).map((part: string, i: number, all: string[]) => ({ name: part, path: `/${all.slice(0, i + 1).join('/')}` })) : [];
  return (
    <Modal title={title} wide actions={[{ label: 'Cancel' }, { label: at?.git && !hint ? 'Use this repository' : 'Use this folder', kind: 'primary', disabled: !at, onClick: () => { closeModal(); onPick(at.path); } }]}>
      {at && <>
        <div className="fp-places">{at.places.map((p: Any) => <button key={p.path} className={`btn sm ${at.path === p.path ? 'primary' : 'subtle'}`} onClick={() => go(p.path)}>{p.name}</button>)}</div>
        <div className="fp-crumbs">{crumbs.map((c: Any, i: number) => <span key={c.path}>{i > 0 && <span className="muted">/</span>}<button className="link-btn" onClick={() => go(c.path)}>{c.name}</button></span>)}
          {at.git && <span className="label-chip fp-git">git repository</span>}{busy && <Spinner />}</div>
        {err && <div className="warn-banner danger" style={{ margin: '0 0 8px' }}><Ico svg={I.warn} /><span>{err}</span></div>}
        <div className="fp-list">
          {at.parent && <button className="fp-item" onClick={() => go(at.parent)}><Ico svg={I.up} /><span>..</span></button>}
          {at.entries.map((e: Any) => <button key={e.path} className="fp-item" onClick={() => go(e.path)} title={e.path}>
            <Ico svg={I.folder} /><span className="fp-name">{e.name}</span>{e.git && <span className="label-chip fp-git">git</span>}</button>)}
          {!at.entries.length && <p className="muted small" style={{ padding: 10, margin: 0 }}>No folders in here.</p>}
        </div>
        <p className="muted small" style={{ margin: '8px 0 0' }}>{hint || <>Open the folder of the project’s clone (marked <b>git</b>), then choose it.</>} Only folder names are shown; files are never read here.</p>
      </>}
      {!at && <div className="muted"><Spinner /> Loading…</div>}
    </Modal>
  );
}

/** Connect GitHub: device sign-in (a code you approve on github.com). Admins can set the OAuth App client ID here. */
function GitHubConnectModal({ env, onDone }: { env: Any; onDone: (account: Any) => void }) {
  const [configured, setConfigured] = useState(Boolean(env?.githubConnect?.configured));
  const [clientId, setClientId] = useState('');
  const [flow, setFlow] = useState<Any>(null);
  const [state, setState] = useState('');
  const [err, setErr] = useState('');
  const stop = useRef(false);
  useEffect(() => () => { stop.current = true; }, []);
  const base = `/api/projects/${P().id}/dev`;
  const start = async () => {
    setErr(''); setState('starting');
    try {
      const f = await api(base, { method: 'POST', body: { action: 'ghConnectStart' } });
      setFlow(f); setState('waiting');
      let wait = f.interval;
      while (!stop.current) {
        await new Promise((r) => setTimeout(r, wait * 1000));
        if (stop.current) return;
        const r = await api(base, { method: 'POST', body: { action: 'ghConnectPoll', id: f.id } });
        if (r.state === 'slow_down') { wait = r.interval || wait + 5; continue; }
        if (r.state === 'pending') continue;
        if (r.state === 'done') { onDone(r.account); closeModal(); toast(`Connected as @${r.account.login}`, 'ok', { title: 'GitHub connected' }); return; }
        setState(''); setFlow(null); setErr(r.state === 'denied' ? 'The sign-in was cancelled on GitHub.' : 'The code expired. Start again.'); return;
      }
    } catch (e: Any) { setState(''); setErr(e.message); }
  };
  const saveId = async () => {
    setErr('');
    try { const r = await api(base, { method: 'POST', body: { action: 'ghClientId', clientId } }); setConfigured(r.configured); if (r.configured) start(); }
    catch (e: Any) { setErr(e.message); }
  };
  const copy = () => { try { navigator.clipboard.writeText(flow.userCode); toast('Code copied'); } catch { /* clipboard off */ } };
  return <Modal title="Connect GitHub" actions={[{ label: state === 'waiting' ? 'Cancel' : 'Close' }]}>
    {!configured ? <>
      <p className="small" style={{ marginTop: 0 }}>Connecting a GitHub account uses a <b>GitHub OAuth App</b> that belongs to your organisation (one per TicketForge, made once by an administrator):</p>
      <ol className="small gc-steps">
        <li>On GitHub: <a href="https://github.com/settings/applications/new" target="_blank" rel="noopener noreferrer">Settings → Developer settings → OAuth Apps → New OAuth App</a>. Any name; homepage and callback URL can be this TicketForge’s address.</li>
        <li>In the new app, tick <b>Enable Device Flow</b> and save.</li>
        <li>Copy its <b>Client ID</b> (not a secret) here.</li>
      </ol>
      {can('users.manage') ? <div className="dev-path">
        <TF value={clientId} spellCheck={false} placeholder="Ov23li… or Iv1.…" onChange={(e) => setClientId(e.target.value)} />
        <button className="btn primary" disabled={!clientId.trim()} onClick={saveId}>Save and connect</button>
      </div> : <p className="muted small">Ask an administrator to do this (or set <code>TICKETFORGE_GITHUB_CLIENT_ID</code> on the server).</p>}
      <p className="muted small">Other ways that work now: sign in with <code>gh auth login</code> on this computer, or save a personal access token under GitHub access.</p>
    </> : !flow ? <>
      <p className="small" style={{ marginTop: 0 }}>Sign in with your GitHub account to pick any of your repositories (personal and organisations), clone them, and open pull requests. TicketForge asks for <code>repo</code>, <code>read:org</code> and <code>workflow</code> access; the token is stored encrypted for this project and you can disconnect at any time.</p>
      <button className="btn primary" disabled={state === 'starting'} onClick={start}>{state === 'starting' ? <><Spinner />Starting…</> : <><Ico svg={I.pr} />Sign in with GitHub</>}</button>
    </> : <div className="gc-code">
      <p className="small" style={{ margin: 0 }}>1. Copy this code</p>
      <button className="gc-user-code" onClick={copy} title="Copy">{flow.userCode}</button>
      <p className="small" style={{ margin: 0 }}>2. Open GitHub, paste it and approve TicketForge</p>
      <a className="btn primary" href={flow.verificationUri} target="_blank" rel="noopener noreferrer" onClick={copy}><Ico svg={I.external} />Open {flow.verificationUri.replace(/^https?:\/\//, '')}</a>
      <p className="muted small" style={{ margin: 0 }}><Spinner /> Waiting for you to approve on GitHub…</p>
    </div>}
    {err && <div className="warn-banner danger" style={{ marginTop: 10 }}><Ico svg={I.warn} /><span>{err}</span></div>}
  </Modal>;
}

/** Your GitHub repositories, searchable; picking one fills the clone form and clones it. */
function RepoPickerModal({ onPick }: { onPick: (r: Any) => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Any[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api(`/api/projects/${P().id}/dev`, { method: 'POST', body: { action: 'ghRepos' } }).then((r) => setList(r.repos)).catch((e) => { setErr(e.message); setList([]); }); }, []);
  const needle = q.trim().toLowerCase();
  const shown = (list || []).filter((r) => !needle || `${r.fullName} ${r.description}`.toLowerCase().includes(needle));
  return <Modal title="Choose a repository" wide actions={[{ label: 'Cancel' }]}>
    <TF search autoFocus value={q} placeholder="Search your repositories" onChange={(e) => setQ(e.target.value)} />
    {err && <div className="warn-banner danger" style={{ marginTop: 8 }}><Ico svg={I.warn} /><span>{err}</span></div>}
    {!list ? <p className="muted"><Spinner /> Loading your repositories…</p> : <ul className="gr-list">{shown.slice(0, 200).map((r) => <li key={r.fullName}>
      <button onClick={() => { closeModal(); onPick(r); }} disabled={r.archived}>
        <span className="gr-name"><b>{r.fullName}</b>{r.private && <span className="ag-chip tiny">Private</span>}{r.archived && <span className="ag-chip tiny">Archived</span>}</span>
        {r.description && <span className="muted small gr-desc">{r.description}</span>}
        <span className="muted small">{r.language ? `${r.language} · ` : ''}{r.defaultBranch} · updated {ago(r.updatedAt)}{r.permissions?.push === false ? ' · read-only for you' : ''}</span>
      </button></li>)}
      {!shown.length && <li className="muted small" style={{ padding: 12 }}>No repositories match.</li>}</ul>}
  </Modal>;
}

/** Project settings → Code & GitHub → GitHub account: who TicketForge acts as on GitHub (clone, push, pull requests). */
function GitHubAccountCard({ ed, env, setEnv }: { ed: boolean; env: Any; setEnv: (e: Any) => void }) {
  const acct = dev().githubAccount;
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const local = env?.local !== false; // on this computer git uses your own sign-in; the token is for the deployed app
  const connected = Boolean(acct && env?.hasToken);
  const how = connected ? null : env?.hasToken ? 'A personal access token is saved for this project (encrypted).' : env?.envToken ? 'Using GITHUB_TOKEN from the server.' : env?.ghSignedIn ? 'Using the GitHub CLI sign-in (gh) on this computer.' : null;
  const connect = () => openModal(<GitHubConnectModal env={env} onDone={(a) => { setDev('githubAccount', { ...a, connectedAt: new Date().toISOString() }); setEnv({ ...env, hasToken: true }); }} />);
  const forget = () => openModal(<Confirm title={connected ? `Disconnect @${acct.login}?` : 'Remove the saved token?'} label={connected ? 'Disconnect' : 'Remove'} text="TicketForge forgets this project’s GitHub token. Repositories already set up stay; cloning private repositories, pushing and pull requests need a token or your gh sign-in again."
    onYes={async () => { await api(`/api/projects/${P().id}/dev`, { method: 'POST', body: { action: 'clearToken' } }); setDev('githubAccount', null); setEnv({ ...env, hasToken: false }); toast(connected ? 'GitHub disconnected' : 'Token removed'); }} />);
  const saveToken = async () => {
    setBusy(true);
    try { const r = await api(`/api/projects/${P().id}/dev`, { method: 'POST', body: { action: 'saveToken', token } }); setDev('githubAccount', null); setEnv({ ...env, hasToken: r.hasToken }); setToken(''); toast('GitHub token saved (encrypted)'); }
    catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return <SetCard id="gh-account" title={local ? 'GitHub account (optional here)' : 'GitHub account'} desc={local
    ? 'On this computer, cloning, pushing and pull requests use your own git setup (SSH key or credential helper), so you don’t need to connect GitHub. Connect it only to pick from your list of repositories, or if git can’t sign in.'
    : 'How the deployed TicketForge signs in to GitHub to read your repositories, push branches and open pull requests. Required here: there is no git sign-in on a server.'}>
    <div className={`gha-row ${connected || how ? 'ok' : ''}`}>
      {connected && acct.avatar ? <img src={acct.avatar} alt="" width={36} height={36} /> : <span className="gha-icon"><Ico svg={I.pr} /></span>}
      <div className="gha-text">
        {connected ? <><b>Connected as @{acct.login}</b><span className="muted small">{acct.name ? `${acct.name} · ` : ''}connected {ago(acct.connectedAt)} · repo, read:org and workflow access</span></>
          : how ? <><b>Signed in</b><span className="muted small">{how}</span></>
          : local ? <><b>Not needed on this computer</b><span className="muted small">Git uses your own sign-in. Connect only to choose from your GitHub repositories in a list.</span></>
          : <><b>Not connected</b><span className="muted small">Connect your GitHub account to choose from all your repositories and open pull requests.</span></>}
      </div>
      <span className="spacer" />
      {ed && (connected ? <button className="btn subtle" onClick={forget}>Disconnect</button>
        : <><button className={local ? 'btn' : 'btn primary'} onClick={connect}><Ico svg={I.pr} />{how ? 'Connect your account' : local ? 'Connect GitHub (optional)' : 'Connect GitHub'}</button>{env?.hasToken && <button className="btn subtle" onClick={forget}>Remove token</button>}</>)}
    </div>
    {ed && !connected && <details className="gha-pat"><summary className="small">Use a personal access token instead</summary>
      <p className="muted small" style={{ margin: '6px 0' }}>A fine-grained token with Contents and Pull requests (read and write) on the repositories, plus Workflows for GitHub Actions. Stored encrypted.</p>
      <div className="dev-path"><TF type="password" autoComplete="off" value={token} placeholder={env?.hasToken ? 'Replace the saved token' : 'github_pat_… or ghp_…'} onChange={(e) => setToken(e.target.value)} />
        <button className="btn" disabled={!token.trim() || busy} onClick={saveToken}>Save token</button></div>
    </details>}
  </SetCard>;
}

/** On the deployed app nothing is cloned: GitHub repositories are used through GitHub (Actions and the API). */
const DEPLOYED_HINT: Record<string, string> = { github: 'Pick one from your account; used through GitHub, nothing to clone.', url: 'A GitHub URL or owner/name; used through GitHub.', folder: 'Only when TicketForge runs on that computer.' };
const SOURCES: [string, string, string][] = [
  ['github', 'Your GitHub repositories', 'Pick one from your account; TicketForge clones it for you.'],
  ['url', 'Git URL', 'Any https or SSH URL (GitHub, GitLab, others); cloned with your own git sign-in, no token needed.'],
  ['folder', 'Folder on this computer', 'A clone you already have.'],
];
/**
 * The repository of one side (frontend = the project's main repository, or backend): a summary of the one in use
 * (where it is, its branch, its state) and a chooser for a new one from GitHub, a Git URL or a local folder.
 */
function RepoChooser({ side, ed, env, setEnv }: { side: 'frontend' | 'backend'; ed: boolean; env: Any; setEnv: (e: Any) => void }) {
  const d = side === 'backend' ? be() : dev();
  const key = side === 'backend' ? 'devBackend' : 'dev';
  const local = env?.local !== false;
  // The folder on disk is each person's own (Project settings are shared, the copy on your computer is yours).
  const mineE = S.auth?.prefs?.local?.[P().id]?.[side];
  const sharedOk = env ? Boolean(env.sharedUsable?.[side]) : true;
  const lpath: string = mineE?.path || (sharedOk ? d.localPath : '') || '';
  const src = mineE?.source || (sharedOk ? d.source : null);
  const isClone = src?.type === 'clone';
  const mineOk = local; // on this computer everyone sets up their own copy; the project's shared choices need the settings permission
  // On the deployed app a GitHub repository is used through GitHub, even when it was cloned on someone's computer.
  const isGh = d.source?.type === 'github' || (!local && Boolean(d.repo) && (d.provider || 'GitHub') === 'GitHub');
  const has = Boolean(lpath || (isGh && d.repo));
  const [mode, setMode] = useState<string>(lpath || (d.source?.type === 'github' && d.repo) ? '' : (side === 'backend' ? 'url' : 'github'));
  // Once the environment is known: on this computer start with a Git URL (it needs no GitHub sign-in) unless GitHub is already usable.
  const picked = useRef(false);
  useEffect(() => {
    if (!env || has || picked.current || side === 'backend') return;
    setMode(env.local !== false && !(env.hasToken || env.ghSignedIn || env.envToken) ? 'url' : 'github');
  }, [env]); // eslint-disable-line react-hooks/exhaustive-deps
  const [status, setStatus] = useState<Any>(null);
  const [busy, setBusy] = useState('');
  const [step, setStep] = useState('');
  const [err, setErr] = useState('');
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [folder, setFolder] = useState(lpath && !isClone ? lpath : '');
  const base = `/api/projects/${P().id}/dev`;
  const canList = Boolean(env?.hasToken || env?.ghSignedIn || env?.envToken);
  // A new repository: the folder is saved as this person's own, and (with the settings permission) the repository's name,
  // provider and base branch become the project's, unless it's the same repository.
  const apply = async (rr: Any, source: Any) => {
    if (rr.path && source?.type !== 'github') {
      const out = await api(base, { method: 'POST', body: { action: 'setMyLocal', side, path: rr.path, source } });
      S.auth.prefs = { ...(S.auth.prefs || {}), local: { ...(S.auth.prefs?.local || {}), [P().id]: out.local } };
      emit();
    }
    if (ed) mutate((pp: Any) => {
      const cur = pp[key] || {};
      const same = Boolean(cur.repo && rr.repo && cur.repo === rr.repo);
      pp[key] = { ...cur, ...(side === 'backend' ? { enabled: true } : {}), ...(rr.path && source?.type !== 'github' ? {} : { localPath: '' }), repo: rr.repo || (same ? cur.repo : ''), provider: rr.provider || '',
        baseBranch: source?.branch || (same && cur.baseBranch) || rr.defaultBranch, ...(source?.type === 'github' ? { source } : {}) };
    });
  };
  const inspect = async (p: string, quiet = false) => {
    if (!quiet) setBusy('check');
    try { const r = await api(base, { method: 'POST', body: { action: 'inspect', localPath: p } }); setStatus({ ok: true, ...r }); return r; }
    catch (e: Any) { setStatus({ ok: false, error: e.message }); if (!quiet) setErr(e.message); return null; } finally { if (!quiet) setBusy(''); }
  };
  useEffect(() => { if (lpath && local && src?.type !== 'github') inspect(lpath, true); }, [lpath, local]); // eslint-disable-line react-hooks/exhaustive-deps
  const useFolder = async (p: string) => {
    setErr('');
    const r = await inspect(p);
    if (r) { await apply(r, { type: 'local' }); setMode(''); toast(`Using ${r.repo || r.path}`); }
  };
  const clone = async (source: string, br: string) => {
    setBusy('clone'); setErr(''); setStep('Starting…');
    try {
      const res = await api(base, { method: 'POST', raw: true, body: { action: 'clone', side, source, branch: br } });
      let got: Any = null;
      await readNdjson(res, (ev) => { if (ev.type === 'step') setStep(ev.text); else if (ev.type === 'repo') got = ev; else if (ev.type === 'error') throw new Error(ev.message); });
      if (got) { await apply(got, { type: 'clone', url: source, branch: br, clonedAt: new Date().toISOString() }); setStatus({ ok: true, ...got }); setMode(''); setUrl(''); toast(`${isClone && src?.url === source ? 'Updated' : 'Cloned'} ${got.repo || 'the repository'}`); }
    } catch (e: Any) { setErr(e.message); } finally { setBusy(''); setStep(''); }
  };
  // Deployed: a GitHub repository is used through GitHub (Actions and the API), with no copy on this server.
  const pickRemote = (fullName: string, defaultBranch = '') => { apply({ path: '', repo: fullName, provider: 'GitHub', defaultBranch: defaultBranch || 'main' }, { type: 'github' }); setStatus(null); setMode(''); setUrl(''); toast(`Using ${fullName} on GitHub`); };
  const ghName = (u: string) => (u.trim().match(/^(?:https?:\/\/github\.com\/|git@github\.com:)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i) || [])[1] || '';
  const working = busy === 'clone';
  const name = d.repo || String(lpath || '').split('/').pop();
  void has;
  return <div className="rc">
    {has && !mode && <div className="rc-current">
      <div className="rc-top">
        <span className="rc-icon"><Ico svg={isClone || isGh ? I.pr : I.folder} /></span>
        <div className="rc-name"><b>{name}</b>
          <span className="rc-badges"><span className="ag-chip tiny">{isGh ? 'On GitHub' : isClone ? 'Cloned by TicketForge' : 'Local folder'}</span>{d.provider && <span className="ag-chip tiny">{d.provider}</span>}</span></div>
        <span className="spacer" />
        {(ed || mineOk) && <>{isGh ? null : isClone ? <button className="btn sm" disabled={!local || !!busy} onClick={() => clone(src.url, src.branch || '')}>{working ? <Spinner /> : <Ico svg={I.refresh} />}Update</button>
          : <button className="btn sm" disabled={!local || !!busy} onClick={() => inspect(lpath)}>{busy === 'check' ? <Spinner /> : null}Check</button>}
          <button className="btn sm subtle" disabled={!!busy} onClick={() => { setErr(''); setMode(isGh ? 'github' : isClone ? (src?.url && /github/i.test(src.url) ? 'github' : 'url') : 'folder'); }}>Change</button></>}
      </div>
      <div className="rc-meta small muted">
        {isGh ? <span>Used through GitHub: code jobs use your AI provider and GitHub{d.baseBranch ? <> · base branch <code>{d.baseBranch}</code></> : null}</span> : <code title={lpath}>{lpath}</code>}
        {status?.ok && <span>default branch <code>{status.defaultBranch}</code> · on <code>{status.currentBranch}</code>{status.uncommitted ? ` · ${status.uncommitted} uncommitted change${status.uncommitted === 1 ? '' : 's'} (never touched)` : ''}</span>}
        {isClone && src?.clonedAt && <span>updated {ago(src.clonedAt)}</span>}
      </div>
      {status && !status.ok && <div className="warn-banner danger" style={{ marginTop: 8 }}><Ico svg={I.warn} /><span>{status.error}</span></div>}
    </div>}
    {(mode || !has) && <div className="rc-pick">
      <div className="rc-sources" role="radiogroup" aria-label="Where the repository comes from">{SOURCES.map(([k, l, h]) => (
        <button key={k} role="radio" aria-checked={mode === k} className={mode === k ? 'on' : ''} disabled={!(ed || mineOk) || (k === 'folder' && !local)} onClick={() => { picked.current = true; setMode(k); setErr(''); }}>
          <Ico svg={k === 'folder' ? I.folder : I.pr} /><b>{l}</b><span className="muted small">{local ? h : DEPLOYED_HINT[k]}</span></button>))}</div>
      {mode === 'github' && <div className="rc-form">
        {canList ? <><p className="small muted" style={{ margin: 0 }}>Personal and organisation repositories your GitHub sign-in can see.</p>
          <button className="btn primary" disabled={!(ed || mineOk) || working} onClick={() => openModal(<RepoPickerModal onPick={(r) => (local && runPlace() !== 'github' ? clone(r.cloneUrl, '') : pickRemote(r.fullName, r.defaultBranch))} />)}><Ico svg={I.search} />Choose a repository</button></>
          : <><p className="small muted" style={{ margin: 0 }}>{local ? 'Listing your repositories needs a GitHub sign-in (optional on this computer). Or use a Git URL: it is cloned with your own git sign-in, no token needed.' : 'Connect GitHub first (GitHub account, above), or use a GitHub URL.'}</p>
            <button className={local ? 'btn' : 'btn primary'} disabled={!ed} onClick={() => openModal(<GitHubConnectModal env={env} onDone={(a) => { setDev('githubAccount', { ...a, connectedAt: new Date().toISOString() }); setEnv({ ...env, hasToken: true }); }} />)}><Ico svg={I.pr} />{local ? 'Connect GitHub (optional)' : 'Connect GitHub'}</button></>}
      </div>}
      {mode === 'url' && <div className="rc-form dev-path">
        <label className="field" style={{ flex: 2, margin: 0 }}><span>Repository URL</span><TF disabled={!(ed || mineOk) || working} value={url} spellCheck={false} placeholder="https://github.com/owner/repo, git@gitlab.com:group/repo.git or owner/repo" onChange={(e) => setUrl(e.target.value)} /></label>
        <label className="field" style={{ flex: 1, margin: 0 }}><span>Branch (optional)</span><TF disabled={!(ed || mineOk) || working} value={branch} spellCheck={false} placeholder="default branch" onChange={(e) => setBranch(e.target.value)} /></label>
        <button className="btn primary" disabled={!(ed || mineOk) || working || !url.trim()} onClick={() => { if (local) clone(url.trim(), branch.trim()); else if (ghName(url)) pickRemote(ghName(url), branch.trim()); else setErr('From the deployed TicketForge, use a GitHub repository (owner/name or its GitHub URL).'); }}>{local ? 'Clone' : 'Use'}</button>
      </div>}
      {mode === 'folder' && <div className="rc-form dev-path">
        <label className="field" style={{ flex: 1, margin: 0 }}><span>Folder</span><TF disabled={!(ed || mineOk)} value={folder} spellCheck={false} placeholder="/Users/you/code/my-app" onChange={(e) => setFolder(e.target.value)} /></label>
        <button className="btn" disabled={!(ed || mineOk) || !local} onClick={() => openModal(<FolderPicker start={folder || lpath || ''} onPick={(p) => { setFolder(p); useFolder(p); }} />)}><Ico svg={I.folder} />Browse…</button>
        <button className="btn primary" disabled={!(ed || mineOk) || !local || !folder.trim() || !!busy} onClick={() => useFolder(folder.trim())}>{busy === 'check' ? <><Spinner />Checking…</> : 'Use this folder'}</button>
      </div>}
      {!local && env?.saasBlocksLocal && <div className="warn-banner" style={{ marginTop: 8 }}><Ico svg={I.warn} /><span>You opened TicketForge on this computer, but it is running in hosted mode (<code>TICKETFORGE_MODE=saas</code> in <code>.env</code>), which keeps this computer’s folders off. To use a folder here, add <code>TICKETFORGE_ALLOW_LOCAL=1</code> to <code>.env</code> (or remove <code>TICKETFORGE_MODE=saas</code>) and restart TicketForge.</span></div>}
      {!local && <p className="small muted" style={{ margin: '8px 0 0' }}>Deployed: your GitHub repositories and GitHub URLs are used through GitHub (no copy here); folders on a computer work when TicketForge runs on that computer.</p>}
      {has && mode && <button className="btn sm subtle" style={{ marginTop: 8 }} disabled={working} onClick={() => { setMode(''); setErr(''); }}>Keep {name}</button>}
    </div>}
    {working && <div className="rp-step small muted"><Spinner /> {step}</div>}
    {err && <div className="warn-banner danger" style={{ marginTop: 8 }}><Ico svg={I.warn} /><span>{err}</span></div>}
  </div>;
}

/**
 * Project settings → Code & GitHub → Where code jobs run: on this computer (Claude Code next to the checkout) or through
 * your AI provider and the GitHub API (works from the deployed TicketForge; nothing to set up beyond GitHub access).
 */
function CodeRunnerCard({ ed, env }: { ed: boolean; env: Any }) {
  const d = dev();
  const local = env?.local !== false;
  const onGh = !local || runPlace() === 'github';
  return <SetCard id="code-runner" title="Where code jobs run" desc="Write code with AI either runs a Claude Code agent next to the checkout on this computer, or asks your AI provider for the change and commits it to the issue’s branch through GitHub. The second works from the deployed TicketForge.">
    <p className="muted small" style={{ margin: '0 0 8px' }}>{local ? <>Your choice on this computer, for code jobs <b>and</b> test runs (it’s remembered in this browser, not saved in the project). The deployed TicketForge always uses the AI API and GitHub.</> : <>This TicketForge is deployed, so code jobs use your AI provider and GitHub.</>}</p>
    <div className="rc-sources" role="radiogroup" aria-label="Where code jobs run">
      <button role="radio" aria-checked={!onGh} className={!onGh ? 'on' : ''} disabled={!local} onClick={() => { setRunPlace('local'); toast('Code jobs and test runs now run on this computer'); }}>
        <Ico svg={I.folder} /><b>This computer</b><span className="muted small">{local ? 'Claude Code next to the repository; live progress; reviews and CodeRabbit.' : 'Only when TicketForge runs on your computer (localhost).'}</span></button>
      <button role="radio" aria-checked={onGh} className={onGh ? 'on' : ''} disabled={!local} onClick={() => { setRunPlace('github'); toast('Code jobs now use the AI API and GitHub; test runs use GitHub Actions'); }}>
        <Ico svg={I.pr} /><b>AI API + GitHub</b><span className="muted small">{local ? 'Your AI provider writes the change and TicketForge commits it to the issue’s branch. Works from the deployed app.' : 'Used here: this TicketForge is deployed.'}</span></button>
    </div>
    {onGh && <div className="crun">
      {!d.repo ? <p className="small muted" style={{ margin: 0 }}>Choose the GitHub repository above first.</p> : <div className="ok-banner"><Ico svg={I.check} /><span>Write code with AI works on <b>{d.repo}</b>. It needs an AI provider (Administration → AI) and a GitHub connection with write access to the repository; there is nothing to install or set up there.</span></div>}
      <p className="muted small" style={{ margin: '8px 0 0' }}>The AI reads the files that matter for the issue and returns exact edits; TicketForge checks each one against the file, then commits to the issue’s branch. It can’t run your tests or build, so review the diff before opening the pull request (use the checks on the pull request for the rest). It never changes workflow files, <code>.env</code> files or lock files.</p>
    </div>}
  </SetCard>;
}

/** Project settings → Code & GitHub. */
export function DevSettings({ ed }: { ed: boolean }) {
  const d = dev();
  const [env, setEnv] = useState<Any>(null);
  useEffect(() => { api(`/api/projects/${P().id}/dev`).then(setEnv).catch(() => setEnv({})); }, []);
  return <>
    {env && !env.local && env.saasBlocksLocal && <div className="warn-banner"><Ico svg={I.warn} /><span>This TicketForge runs in hosted mode (<code>TICKETFORGE_MODE=saas</code>), so it treats you as deployed even at localhost. Add <code>TICKETFORGE_ALLOW_LOCAL=1</code> to <code>.env</code> and restart to use folders, git and Claude Code on this computer.</span></div>}
    {env && !env.local && !env.saasBlocksLocal && <div className="ok-banner"><Ico svg={I.check} /><span>This TicketForge is deployed: choose a GitHub repository and code jobs use your AI provider and GitHub (see <b>Where code jobs run</b>). Folders on a computer and cloning work when TicketForge runs on your computer.</span></div>}
    <GitHubAccountCard ed={ed} env={env} setEnv={setEnv} />
    <SetCard id="repo" title="Repository" desc="Where the code agents work: one of your GitHub repositories, any Git URL, or a folder on this computer. Each issue gets its own branch and git worktree, so the checkout and any uncommitted work are never touched.">
      <RepoChooser side="frontend" ed={ed} env={env} setEnv={setEnv} />
      <h4 className="rc-sub">Branches and pull requests</h4>
      <div className="grid2">
        <label className="field"><span>Base branch</span><TF disabled={!ed} value={d.baseBranch || ''} placeholder="main" spellCheck={false} onChange={(e) => setDev('baseBranch', e.target.value.trim())} /></label>
        <label className="field"><span>Branch prefix</span><TF disabled={!ed} value={d.branchPrefix ?? 'tf/'} spellCheck={false} onChange={(e) => setDev('branchPrefix', e.target.value.trim())} />
          <small className="muted">Branches look like <code>{(d.branchPrefix ?? 'tf/')}pay-12-short-title</code></small></label>
        <label className="field"><span>Claude model</span><SF disabled={!ed} value={d.model || ''} onChange={(e) => setDev('model', e.target.value)}><MenuItem value="">Each agent’s own (Administration → Agents)</MenuItem>{['opus', 'sonnet', 'haiku'].map((m) => <MenuItem key={m} value={m}>{m} for every agent</MenuItem>)}</SF></label>
        <label className="field"><span>Approvals needed to merge</span><TF disabled={!ed} type="number" min={1} max={10} value={String(d.requiredApprovals ?? 1)} onChange={(e) => setDev('requiredApprovals', Math.min(10, Math.max(1, Math.floor(Number(e.target.value)) || 1)))} />
          <small className="muted">How many members must approve AI-written code before “Approve and merge” merges its pull request (1 to 10).</small></label>
      </div>
      <CB label="Open pull requests as drafts" disabled={!ed} checked={d.draft !== false} onChange={(e: Any) => setDev('draft', e.target.checked)} />
      <details className="rc-adv"><summary className="small">Advanced</summary>
        <div className="grid2" style={{ marginTop: 8 }}>
        <label className="field"><span>GitHub repository (owner/name)</span><TF disabled={!ed} value={d.repo || ''} placeholder="titoarvs/tito-payroll" spellCheck={false} onChange={(e) => setDev('repo', e.target.value.trim())} /><small className="muted">Found automatically from the repository; change it only if pull requests should go elsewhere.</small></label>
        </div>
      </details>
    </SetCard>
    <CodeRunnerCard ed={ed} env={env} />
    <SetCard id="agent" title="Coding agent" desc="What the code agents (Build a Ticket, Feature Tests, Review…) may run and how your team writes code. They read and edit files only in the issue’s worktree; they can’t commit, push, switch branches or browse the web. What each agent does is set in Administration → Agents.">
      <label className="field"><span>Check command (optional)</span><TF disabled={!ed} value={d.checkCommand || ''} placeholder="e.g. npm test, or npm run lint" spellCheck={false} onChange={(e) => setDev('checkCommand', e.target.value)} />
        <small className="muted">The only command it may run, to check its work. Leave empty and it only reads and edits code.</small></label>
      <label className="field"><span>Team conventions</span><TA disabled={!ed} rows={4} value={d.notes || ''} placeholder="e.g. Next.js App Router, server actions for writes, Tailwind, tests with Vitest next to the file. Don’t touch the payments module." onChange={(e) => setDev('notes', e.target.value)} /></label>
      <RepoProfile side="frontend" ed={ed} />
    </SetCard>
    <BackendRepoCard ed={ed} local={env?.local !== false} env={env} setEnv={setEnv} />
    <CodeRabbitCard ed={ed} env={env} setEnv={setEnv} />
  </>;
}

/**
 * Project settings → Code & GitHub → Repository profile: "Learn from repository" runs a read-only agent that writes
 * how this codebase is built (stack, structure, how features are built, conventions, tests, commands). Every code
 * job gets it, so new code follows the repo. It can be edited by hand and learned again after big changes.
 */
function RepoProfile({ side, ed }: { side: 'frontend' | 'backend'; ed: boolean }) {
  const d = side === 'backend' ? be() : dev();
  const set = side === 'backend' ? setBe : setDev;
  const prof = d.repoProfile;
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [steps, setSteps] = useState(0);
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState('');
  const learn = async () => {
    setBusy(true); setStep('Starting Claude Code…'); setSteps(0);
    try {
      const res = await api(`/api/projects/${P().id}/dev`, { method: 'POST', raw: true, body: { action: 'learn', side } });
      let got: Any = null;
      await readNdjson(res, (ev) => {
        if (ev.type === 'step') { setStep(ev.text); setSteps((n) => n + 1); }
        else if (ev.type === 'profile') got = ev;
        else if (ev.type === 'error') throw new Error(ev.message);
      });
      if (got) { set('repoProfile', { markdown: got.markdown, commit: got.commit, learnedAt: got.learnedAt }); toast(`Learned ${side === 'backend' ? 'the backend repository' : 'the repository'}${got.costUsd ? ` ($${got.costUsd.toFixed(2)})` : ''}. Code jobs follow it now.`); }
    } catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(false); setStep(''); }
  };
  return <div className="rp">
    <div className="rp-h"><b>Repository profile</b>
      <span className="muted small">{prof ? <>Learned {ago(prof.learnedAt)}{prof.commit ? <> at <code>{prof.commit}</code></> : null}{prof.editedAt ? ' · edited' : ''} · {Math.round(prof.markdown.length / 100) / 10}k characters</> : 'Not learned yet: agents only see the conventions above.'}</span>
      <span className="spacer" />
      {ed && <button className="btn sm ai" disabled={busy || !myPath(side)} onClick={learn} title="A read-only Claude Code agent reads the repository and writes how it’s built">{busy ? <><Spinner />Learning…</> : <><Ico svg={I.sparkle} />{prof ? 'Learn again' : 'Learn from repository'}</>}</button>}
    </div>
    {busy && <div className="rp-step small muted"><Spinner /> {step}{steps ? ` · ${steps} files and searches` : ''}</div>}
    {!busy && <p className="muted small" style={{ margin: '4px 0 0' }}>A read-only agent reads the code (never changes it) and writes its stack, structure, how a feature is built end to end, conventions, tests and commands. Every code job gets it, so new code is built the way this repository already works. Learn again after big changes.</p>}
    {prof && !busy && <details className="rp-view" open={edit}><summary className="small">View{ed ? ' or edit' : ''} the profile</summary>
      {edit ? <>
        <TA mono rows={18} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} />
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button className="btn sm primary" onClick={() => { set('repoProfile', { ...prof, markdown: text.slice(0, 14000), editedAt: new Date().toISOString() }); setEdit(false); toast('Profile saved'); }}>Save</button>
          <button className="btn sm subtle" onClick={() => setEdit(false)}>Cancel</button></div>
      </> : <>
        <div className="rp-md small code-md"><Markdown text={prof.markdown} /></div>
        {ed && <div className="row" style={{ gap: 8, marginTop: 8 }}><button className="btn sm" onClick={() => { setText(prof.markdown); setEdit(true); }}>Edit</button>
          <button className="btn sm subtle" onClick={() => saveBlob(new Blob([prof.markdown], { type: 'text/markdown' }), `repository-profile-${side}.md`)}>Download .md</button>
          <button className="btn sm danger-subtle" onClick={() => set('repoProfile', null)}>Clear profile</button></div>}
      </>}
    </details>}
  </div>;
}

/** Project settings → Code & GitHub → CodeRabbit: the CLI's status and an optional Agentic API key. */
function CodeRabbitCard({ ed, env, setEnv }: { ed: boolean; env: Any; setEnv: (e: Any) => void }) {
  const cr = env?.coderabbit;
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState('');
  const recheck = async () => { setBusy('check'); try { setEnv(await api(`/api/projects/${P().id}/dev?fresh=1`)); } catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const save = async (clear = false) => {
    setBusy('key');
    try { const r = await api(`/api/projects/${P().id}/dev`, { method: 'POST', body: clear ? { action: 'clearCoderabbitKey' } : { action: 'saveCoderabbitKey', key } }); setEnv({ ...env, coderabbit: { ...cr, hasKey: r.hasKey } }); setKey(''); toast(clear ? 'CodeRabbit key removed' : 'CodeRabbit key saved (encrypted)'); }
    catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  return <SetCard id="coderabbit" title="CodeRabbit" desc="An independent AI review of the code the agents write, before you open the pull request. Findings come with a severity and fix instructions: send them to the Build agent, or file them as Bug issues. They are kept on the issue and counted in Reports → Code review findings.">
    {!env ? <p className="muted small">Checking…</p> : cr === null ? <p className="muted small">Works when TicketForge runs on your computer (opened at localhost).</p> : <>
      <p className="small" style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className={`dot ${cr?.installed && (cr.signedIn || cr.hasKey) ? 'ok' : 'bad'}`} />
        {!cr?.installed ? 'The CodeRabbit CLI isn’t installed on this computer.' : `CodeRabbit CLI ${cr.version} · ${cr.signedIn ? 'signed in' : cr.hasKey ? 'uses the saved API key' : 'not signed in'}`}
        <button className="btn sm subtle" disabled={!!busy} onClick={recheck}>{busy === 'check' ? <Spinner /> : <Ico svg={I.refresh} />}Check again</button></p>
      {!cr?.installed && <div className="cr-install small"><span>Install it in a terminal, then sign in once:</span>
        <code>brew install coderabbit</code><span className="muted">or</span><code>curl -fsSL https://cli.coderabbit.ai/install.sh | sh</code><code>coderabbit auth login</code></div>}
      {cr?.installed && !cr.signedIn && !cr.hasKey && <p className="small muted" style={{ margin: '0 0 8px' }}>Run <code>coderabbit auth login</code> in a terminal, or save an Agentic API key below.</p>}
      {ed && <div className="dev-path">
        <TF type="password" autoComplete="off" value={key} placeholder={cr?.hasKey ? 'Replace the saved Agentic API key' : 'Agentic API key (optional), cr-…'} onChange={(e) => setKey(e.target.value)} />
        <button className="btn" disabled={!key.trim() || !!busy} onClick={() => save()}>Save key</button>
        {cr?.hasKey && <button className="btn subtle" disabled={!!busy} onClick={() => save(true)}>Remove</button>}
      </div>}
    </>}
  </SetCard>;
}

/** Project settings → Code & GitHub: a separate backend repository (pull requests on GitHub, merge requests on GitLab) and the frontend/backend split of issues. */
function BackendRepoCard({ ed, local, env, setEnv }: { ed: boolean; local: boolean; env: Any; setEnv: (e: Any) => void }) {
  const d = be();
  const [check, setCheck] = useState<Any>(null);
  const [glToken, setGlToken] = useState('');
  const gitlab = (check?.provider || d.provider) === 'GitLab';
  const saveGl = async (clear = false) => {
    setBusy('gl');
    try { const r = await api(`/api/projects/${P().id}/dev`, { method: 'POST', body: clear ? { action: 'clearGitlabToken' } : { action: 'saveGitlabToken', token: glToken } }); setEnv({ ...env, hasGitlabToken: r.hasGitlabToken }); setGlToken(''); toast(clear ? 'GitLab token removed' : 'GitLab token saved'); }
    catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const [busy, setBusy] = useState('');
  const issues = P().tickets.filter((t: Any) => !t.parentId);
  const marked = issues.filter((t: Any) => t.layer).length;
  const inspect = async (localPath?: string) => {
    setBusy('check'); setCheck(null);
    try {
      const r = await api(`/api/projects/${P().id}/dev`, { method: 'POST', body: { action: 'inspect', localPath: localPath ?? be().localPath } });
      setCheck({ ok: true, ...r });
      mutate((pp) => { pp.devBackend = { ...(pp.devBackend || {}), enabled: true, localPath: r.path, repo: r.repo || pp.devBackend?.repo || '', provider: r.provider || '', baseBranch: pp.devBackend?.baseBranch || r.defaultBranch }; });
    } catch (e: Any) { setCheck({ ok: false, error: e.message }); } finally { setBusy(''); }
  };
  const classify = async (all: boolean) => {
    setBusy('classify');
    const task = startTask('Marking issues frontend / backend', { detail: `${all ? issues.length : issues.length - marked} issues`, kind: 'ai' });
    try {
      const r = await api(`/api/projects/${P().id}/layers`, { method: 'POST', body: aiBody({ all }) });
      const ids = Object.keys(r.layers);
      mutate((pp) => { for (const t of pp.tickets) if (r.layers[t.id] && t.layer !== r.layers[t.id]) { setField(t, 'layer', r.layers[t.id], 'Claude'); } });
      const n = (l: string) => ids.filter((id) => r.layers[id] === l).length;
      task.finish(`${ids.length} marked`);
      toast(`${n('frontend')} frontend · ${n('backend')} backend · ${n('both')} both. Change any issue in its details (Implementation); ⌘Z undoes this.`, 'ok', { title: `${ids.length} issues marked` });
    } catch (e: Any) { task.fail(`Couldn’t mark the issues: ${e.message}`); } finally { setBusy(''); }
  };
  return (
    <SetCard id="backend" title="Backend repository" desc="For projects whose backend lives in its own repository (GitHub or GitLab). Issues marked Backend run their code agents there, Frontend in the repository above, and Frontend + Backend in both: backend first, then the frontend builds on its API.">
      <CB label="This project has a separate backend repository" disabled={!ed} checked={Boolean(d.enabled)} onChange={(e: Any) => setBe('enabled', e.target.checked)} />
      {d.enabled && <>
        <RepoChooser side="backend" ed={ed} env={env} setEnv={setEnv} />
        <h4 className="rc-sub">Branches and pull requests</h4>
        <div className="grid2">
          <label className="field"><span>{gitlab ? 'GitLab project (group/name)' : 'GitHub repository (owner/name)'}</span><TF disabled={!ed} value={d.repo || ''} placeholder={gitlab ? 'tito-solutions/hris/tito-hris-api' : 'owner/my-app-api'} spellCheck={false} onChange={(e) => setBe('repo', e.target.value.trim())} />
            <small className="muted">Found automatically from the repository. Pull requests open {gitlab ? 'as GitLab merge requests' : 'on GitHub'}.</small></label>
          <label className="field"><span>Base branch</span><TF disabled={!ed} value={d.baseBranch || ''} placeholder="develop" spellCheck={false} onChange={(e) => setBe('baseBranch', e.target.value.trim())} /></label>
          <label className="field"><span>Branch prefix</span><TF disabled={!ed} value={d.branchPrefix ?? dev().branchPrefix ?? 'tf/'} spellCheck={false} onChange={(e) => setBe('branchPrefix', e.target.value.trim())} /></label>
          <label className="field"><span>Check command (optional)</span><TF disabled={!ed} value={d.checkCommand || ''} placeholder="e.g. npm test" spellCheck={false} onChange={(e) => setBe('checkCommand', e.target.value)} /></label>
        </div>
        <label className="field"><span>Backend conventions</span><TA disabled={!ed} rows={3} value={d.notes || ''} placeholder="e.g. Express + Drizzle, routes in src/routes, migrations with drizzle-kit, Vitest tests next to the file. Never edit existing migrations." onChange={(e) => setBe('notes', e.target.value)} /></label>
        <RepoProfile side="backend" ed={ed} />
        {gitlab ? <div className="field" style={{ marginTop: 4 }}><span>GitLab access token</span>
          <p className="small" style={{ margin: '0 0 6px' }}><span className={`dot ${env?.hasGitlabToken || env?.envGitlabToken ? 'ok' : 'bad'}`} style={{ marginRight: 6 }} />
            {env?.hasGitlabToken ? 'A token is saved for this project (encrypted).' : env?.envGitlabToken ? 'Using GITLAB_TOKEN from the server.' : 'No token: the branch is pushed with your own git sign-in, and you open the merge request on GitLab from the link given.'}</p>
          {ed && <div className="dev-path">
            <TF type="password" autoComplete="off" value={glToken} placeholder={env?.hasGitlabToken ? 'Replace the saved token' : 'glpat-… (scopes: api, write_repository)'} onChange={(e) => setGlToken(e.target.value)} />
            <button className="btn" disabled={!glToken.trim() || !!busy} onClick={() => saveGl()}>Save token</button>
            {env?.hasGitlabToken && <button className="btn subtle" disabled={!!busy} onClick={() => saveGl(true)}>Remove</button>}
          </div>}</div>
          : <p className="small muted" style={{ margin: '4px 0 0' }}>Pull requests use the GitHub account above.</p>}
        <div className="be-classify">
          <span className="small"><b>Issues:</b> {marked} of {issues.length} marked frontend, backend or both.</span>
          {can('ai.use') && can('issue.edit') && <>
            <button className="btn sm ai" disabled={!!busy || marked === issues.length} onClick={() => classify(false)}>{busy === 'classify' ? <><Spinner />Marking…</> : <><Ico svg={I.sparkle} />Mark {issues.length - marked} unmarked with AI</>}</button>
            {marked > 0 && <button className="btn sm subtle" disabled={!!busy} onClick={() => classify(true)}>Re-check all</button>}</>}
        </div>
      </>}
    </SetCard>
  );
}

/** Whether "Write code with AI" can be offered for issues in this project. */
export const codeReady = () => feat('code') && Boolean(myPath('frontend') || dev().repo);

const STATUS: Record<string, string> = { committed: 'Committed locally', report: 'Report ready', starting: 'Starting…', queued: 'Waiting for a free agent slot', running: 'Claude Code is working…', review: 'Ready for review', empty: 'No changes', failed: 'Failed', cancelled: 'Stopped', pr: 'Pull request open', merged: 'Merged', discarded: 'Discarded' };

/**
 * Approvals on a code job (TF-123): who approved, the count against what the project asks for, and Approve / Approve and
 * merge. Any member who can open the project can approve; merging needs the pull request to be open. Not enough
 * approvals blocks the merge with how many are still needed (the server's message).
 */
function ApprovalBox({ job, busy, onApprove, onMerge }: { job: Any; busy: string; onApprove: () => void; onMerge: () => void }) {
  const approvals: Any[] = job.approvals || [];
  const need = job.required || 1;
  const mine = approvals.some((a) => a.userId === S.user?.id);
  if (job.status === 'merged') return <div className="ok-banner" role="status"><Ico svg={I.check} /><span>{job.pr?.url ? <>Pull request <a href={job.pr.url} target="_blank" rel="noopener noreferrer">#{job.pr.number}</a> merged</> : 'Merged'}{job.merged?.by ? <> by <b>{job.merged.by}</b></> : ''}{job.merged?.at ? ` ${ago(job.merged.at)}` : ''}{job.merged?.sha ? <> (<code>{job.merged.sha}</code>)</> : ''} with <b>{approvals.length} of {need}</b> approval{need === 1 ? '' : 's'}{approvals.length ? `: ${approvals.map((a) => a.name).join(', ')}` : ''}.</span></div>;
  return <div className="cj-approve">
    <div className="cj-approve-h"><b>Approvals</b>
      <span className={`cj-approve-n ${approvals.length >= need ? 'ok' : ''}`} aria-live="polite">{approvals.length} of {need}</span>
      <span className="muted small">{approvals.length >= need ? 'Enough approvals to merge.' : `${need - approvals.length} more approval${need - approvals.length === 1 ? '' : 's'} needed.`}</span></div>
    {approvals.length > 0 && <ul className="cj-approve-list small">{approvals.map((a) => <li key={a.userId}><Ico svg={I.check} />{a.name}<span className="muted"> · {ago(a.at)}</span></li>)}</ul>}
    <div className="cj-approve-btns">
      <button className="btn" disabled={!!busy || mine} onClick={onApprove} title={mine ? 'You already approved this code' : 'Approve this code'}>{busy === 'approve' ? <><Spinner />Approving…</> : <><Ico svg={I.check} />{mine ? 'You approved' : 'Approve'}</>}</button>
      {job.status === 'pr' && job.pr
        ? <button className="btn primary" disabled={!!busy} onClick={onMerge} title={`Approves, then merges pull request #${job.pr.number} on GitHub once there are ${need} approval${need === 1 ? '' : 's'}`}>{busy === 'merge' ? <><Spinner />Merging…</> : <><Ico svg={I.pr} />Approve and merge</>}</button>
        : <span className="muted small">Open the pull request to merge it.</span>}
    </div>
  </div>;
}

/** Where the job is: set up → agent working → your review → shipped (or the report, for read-only agents). */
function JobSteps({ job }: { job: Any }) {
  const report = job.status === 'report' || job.kind === 'pr-review';
  const steps = report ? ['Set up', 'Agent reading', 'Report ready'] : ['Set up', 'Agent working', 'Your review', job.target ? 'Pushed' : 'Pull request'];
  const at: Record<string, number> = { starting: 0, queued: 0, running: 1, review: 2, empty: 2, failed: 1, cancelled: 1, report: 2, committed: 3, pr: 3, merged: 3 };
  const cur = at[job.status] ?? 1;
  const bad = ['failed', 'cancelled'].includes(job.status);
  const finished = report ? job.status === 'report' : ['committed', 'pr', 'merged'].includes(job.status);
  return <ol className="cj-steps">{steps.map((label, i) => {
    const state = i < cur || (finished && i === cur) ? 'done' : i === cur ? (bad ? 'bad' : 'on') : '';
    return <li key={label} className={state}><span className="dot">{state === 'done' ? <Ico svg={I.check} /> : state === 'bad' ? '!' : i + 1}</span><span>{job.status === 'committed' && i === 3 ? 'Committed' : job.status === 'merged' && i === 3 ? 'Merged' : label}</span></li>;
  })}</ol>;
}

const VERB_RE = /^(\s*↳\s*)?(Reading|Editing|Writing|Finding files|Searching|Listing|Running|Planning:|Delegating to)\s*([\s\S]*)$/;
const VERB_ICON: Record<string, string> = { Reading: I.doc, Editing: I.pencil, Writing: I.pencil, 'Finding files': I.search, Searching: I.search, Listing: I.folder, Running: I.play, 'Planning:': I.check, 'Delegating to': I.bot };
const KIND_ICON: Record<string, string> = { info: I.clock, text: I.comment, done: I.check, error: I.warn, warn: I.warn, you: I.user };
const hhmm = (at: string) => { try { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return ''; } };
/** The agent's steps as a timeline: tool calls as compact rows, messages as text. */
function Activity({ log, running }: { log: Any[]; running: boolean }) {
  return <ol className="cj-feed">
    {log.map((l: Any, i: number) => {
      const m = l.kind === 'tool' ? String(l.text).match(VERB_RE) : null;
      if (m) return <li key={i} className={`ev tool${m[1] ? ' sub' : ''}`}><span className="ev-ic"><Ico svg={VERB_ICON[m[2]] || I.play} /></span>
        <span className="ev-verb">{m[2].replace(':', '')}</span><code className="ev-arg" title={m[3]}>{m[3].split('\n')[0]}</code><time>{hhmm(l.at)}</time></li>;
      return <li key={i} className={`ev k-${l.kind}`}><span className="ev-ic"><Ico svg={KIND_ICON[l.kind] || I.clock} /></span><span className="ev-text">{l.text}</span><time>{hhmm(l.at)}</time></li>;
    })}
    {running && <li className="ev live"><span className="ev-ic"><Spinner /></span><span className="ev-text muted">Working…</span></li>}
  </ol>;
}
/** Issue panel → Write code with AI: start, watch, review, ask for changes, open the pull request. */
export function CodeModal({ t, agentId: initialAgent = 'build', initialSide }: { t: Any; agentId?: string; initialSide?: string }) {
  // Projects with a separate backend: one job per repository (Frontend / Backend). "Both" issues start with the backend.
  const [jobs, setJobs] = useState<Record<string, Any>>({});
  const [backend, setBackend] = useState(hasBackend());
  const [side, setSide] = useState<string>(initialSide || (hasBackend() && (t.layer === 'backend' || t.layer === 'both') ? 'backend' : 'frontend'));
  const job = jobs[side] || null;
  const setJob = (v: Any) => setJobs((js) => ({ ...js, [side]: typeof v === 'function' ? v(js[side]) : v }));
  const [agents, setAgents] = useState<Any[]>([]);
  const [agentId, setAgentId] = useState(initialAgent);
  const [reviewTab, setReviewTab] = useState(0);
  const [roles, setRoles] = useState<Record<string, string | null>>({});
  const [tab, setTab] = useState('');
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [follow, setFollow] = useState('');
  const [busy, setBusy] = useState('');
  const [contract, setContract] = useState('');
  const [title, setTitle] = useState(`${t.key}: ${t.title}`);
  const [prBody, setPrBody] = useState('');
  const [draft, setDraft] = useState(dev().draft !== false);
  const logRef = useRef<HTMLDivElement>(null);
  const base = `/api/projects/${P().id}/code`;
  useEffect(() => { api(`${base}?ticketId=${t.id}`).then((r) => {
    setJobs(r.jobs || { frontend: r.job }); setBackend(Boolean(r.backend)); setAgents(r.agents || []); setRoles(r.roles || {});
    if (initialAgent === 'build' && r.roles?.build) setAgentId(r.roles.build);
    // A "both" issue whose backend is done: open on the frontend.
    if (r.backend && t.layer === 'both' && r.jobs?.backend && ['committed', 'review'].includes(r.jobs.backend.status) && !r.jobs?.frontend) setSide('frontend');
  }).catch((e) => toast(e.message, 'err')).finally(() => setLoading(false)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // With two repositories, default to the agent made for that side (unless an agent was chosen for you).
  // With two repositories, default to that repository's agent (Administration → Agents → Default agents).
  useEffect(() => { if (backend && initialAgent === 'build' && roles[side]) setAgentId(roles[side]); }, [side, backend, roles]); // eslint-disable-line react-hooks/exhaustive-deps
  // Follow every running job (both repositories when they run at once).
  useEffect(() => {
    const live = Object.entries(jobs).filter(([, j]) => j && (['starting', 'queued', 'running'].includes(j.status) || j.coderabbit?.status === 'running'));
    if (!live.length) return;
    const h = setTimeout(async () => {
      const got = await Promise.all(live.map(async ([k, j]) => { try { return [k, j.id, await api(`${base}?jobId=${j.id}&since=${j.logSize || 0}`)] as const; } catch { return null; } }));
      setJobs((js) => {
        const next = { ...js };
        for (const g of got) { if (!g) continue; const [k, id, r] = g; if (next[k]?.id !== id) continue; next[k] = { ...r, log: [...(next[k]?.log || []), ...r.log] }; }
        return next;
      });
    }, live.some(([, j]) => j.remote) ? 6000 : 1500);
    return () => clearTimeout(h);
  }, [jobs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { logRef.current?.scrollTo({ top: 1e9 }); }, [job?.log?.length]);
  useEffect(() => { setTab(''); }, [job?.id]);
  // A finished CodeRabbit review is saved on the issue (findings, then their status: bug, sent to agent, dismissed).
  useEffect(() => { if (job?.coderabbit?.status === 'done') saveReview(t, job); }, [job?.coderabbit?.status, job?.coderabbit?.round]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (kind: string, body: Any) => {
    setBusy(kind);
    try { const r = await api(base, { method: 'POST', body: { ...body, jobId: job?.id } }); refreshCodeStatus(); if (r?.id) setJob((j: Any) => ({ ...r, log: kind === 'start' ? r.log : [...(j?.log || []), ...r.log.slice(j?.logSize ?? 0)] })); return r; }
    catch (e: Any) { toast(e.message, 'err'); return null; } finally { setBusy(''); }
  };
  // Frontend + Backend issue: agree the API, then build both repositories in parallel.
  const startBoth = async () => {
    setBusy('both');
    try { const r = await api(base, { method: 'POST', body: { action: 'start-both', ticketId: t.id, instructions: text } }); refreshCodeStatus(); setJobs((js) => ({ ...js, ...r.jobs })); setContract(r.contract || ''); }
    catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const idle = (k: string) => !jobs[k] || jobs[k].status === 'discarded';
  const canBoth = backend && t.layer === 'both' && idle('backend') && idle('frontend');
  const commitLocal = async () => {
    const r = await act('commit', { action: 'commit', title });
    if (!r?.commit) return;
    setJob(r.job);
    mutate(() => { logEvent(t, `committed the ${side} changes written by AI on the local branch ${r.commit.branch} (${r.commit.sha}) in ${r.commit.repoPath}`, 'Development'); });
    toast(`On branch ${r.commit.branch} in ${r.commit.repoPath}. Nothing was pushed.`, 'ok', { title: `Committed ${r.commit.sha} locally` });
  };
  /** The AI drafts the title and description from the diff, the agent's summary and the issue. */
  const draftPr = async () => {
    setBusy('draft');
    try { const r = await api(base, { method: 'POST', body: aiBody({ action: 'prDraft', jobId: job?.id }) }); setTitle(r.title); setPrBody(r.body); }
    catch (e: Any) { toast(`Couldn’t write the description: ${e.message}`, 'err'); } finally { setBusy(''); }
  };
  const pushUpdate = async () => {
    const r = await act('push', { action: 'push', message: title });
    if (!r?.job) return;
    setJob(r.job);
    mutate(() => { logEvent(t, `pushed ${r.commit} to ${job.target.provider === 'GitLab' ? 'merge request !' : 'pull request #'}${job.target.number} with changes written by AI`, 'Development'); });
    toast(`Pushed ${r.commit} to ${job.target.provider === 'GitLab' ? '!' : '#'}${job.target.number}: the ${job.target.provider === 'GitLab' ? 'merge request' : 'pull request'} is updated.`, 'ok', { title: 'Changes pushed', action: { label: 'Open', onClick: () => window.open(job.target.url, '_blank', 'noopener') } });
  };
  const openPr = async () => {
    const r = await act('pr', { action: 'pr', title, draft, body: prBody.trim() || undefined });
    if (!r?.pr) return;
    setJob(r.job);
    const noun = job.provider === 'GitLab' ? 'merge request' : 'pull request';
    if (r.pr.compare) {
      // Pushed with your git setup; the request opens on GitHub/GitLab (no token to open it from here).
      mutate(() => { logEvent(t, `pushed ${r.pr.branch} with code written by AI`, 'Development'); });
      toast(`Pushed ${r.pr.branch}. Open the ${noun} on ${job.provider || 'GitHub'} to finish.`, 'ok', { title: 'Branch pushed', action: { label: `Open ${noun}`, onClick: () => window.open(r.pr.url, '_blank', 'noopener') } });
      window.open(r.pr.url, '_blank', 'noopener');
      return;
    }
    mutate(() => { t.prs.push({ id: uid(), ...r.pr, checkedAt: nowIso() }); logEvent(t, `opened ${noun} ${r.pr.repo} #${r.pr.number} with code written by AI`, 'Development'); });
    toast(`Opened ${r.pr.repo} #${r.pr.number}`);
  };
  /** Approve the code (TF-123). Approve and merge also records the approval; when it is blocked the approval stays, so the job is read again for the new count. */
  const reloadJob = async () => { try { const r = await api(`${base}?jobId=${job.id}&since=${job.logSize || 0}`); setJob((j: Any) => ({ ...r, log: [...(j?.log || []), ...r.log] })); } catch { /* the next poll or reopening shows it */ } };
  const approve = async () => {
    const r = await act('approve', { action: 'approve' });
    if (r) toast(`Approved ${r.approvals?.length || 0} of ${r.required}`); else await reloadJob();
  };
  const merge = async () => {
    const r = await act('merge', { action: 'merge' });
    if (!r) { await reloadJob(); return; }
    mutate(() => { const pr = t.prs.find((x: Any) => (x.url && x.url === r.pr?.url) || (x.number && x.number === r.pr?.number && x.repo === r.repo)); if (pr) { pr.status = 'Merged'; pr.mergedAt = r.merged?.at || nowIso(); } logEvent(t, `merged pull request #${r.pr?.number} after ${r.approvals?.length || 0} of ${r.required} approvals`, 'Development'); });
    toast(`${r.repo} #${r.pr?.number} is merged.`, 'ok', { title: 'Code merged', action: r.pr?.url ? { label: 'Open', onClick: () => window.open(r.pr.url, '_blank', 'noopener') } : undefined });
  };
  const running = job && ['starting', 'queued', 'running'].includes(job.status);
  const d = dev();
  // An AI review of an open pull request: remember the verdict on the linked request (Pull requests page).
  const isPrReview = job?.kind === 'pr-review';
  const reviewedPr = isPrReview ? t.prs.find((r: Any) => r.url === job.target?.url) : null;
  useEffect(() => {
    if (!isPrReview || job.status !== 'report' || !reviewedPr || reviewedPr.aiReview?.jobId === job.id) return;
    const verdict = /request(ed)? changes/i.test(job.summary || '') ? 'Changes requested' : /approve with comments/i.test(job.summary || '') ? 'Approve with comments' : /approve/i.test(job.summary || '') ? 'Approve' : 'Reviewed';
    mutate(() => { reviewedPr.aiReview = { jobId: job.id, at: job.finishedAt || nowIso(), agent: job.agentName, verdict, posted: null }; logEvent(t, `${job.agentName} agent reviewed ${reviewedPr.provider === 'GitLab' ? '!' : '#'}${reviewedPr.number}: ${verdict}`, 'Development'); });
  }, [isPrReview, job?.status, job?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const postReview = async () => {
    const r = await act('postReview', { action: 'postReview' });
    if (!r?.id) return;
    if (reviewedPr) mutate(() => { reviewedPr.aiReview = { ...(reviewedPr.aiReview || {}), posted: r.posted }; });
    toast(`The review is a comment on ${job.target.provider === 'GitLab' ? '!' : '#'}${job.target.number} now.`, 'ok', { title: 'Review posted', action: { label: 'Open', onClick: () => window.open(job.target.url, '_blank', 'noopener') } });
  };
  return (
    <Modal title={`${isPrReview ? `Code review · ${job.target.provider === 'GitLab' ? '!' : '#'}${job.target.number}` : 'Write code'} · ${t.key}`} wide="xl" persistent={running} actions={[{ label: running ? 'Close (keeps running)' : 'Close' }]}>
      {backend && !loading && <div className="side-tabs" role="tablist" aria-label="Repository">
        {(['backend', 'frontend'] as const).map((k) => { const jj = jobs[k]; const busyK = jj && ['starting', 'queued', 'running'].includes(jj.status); return (
          <button key={k} role="tab" aria-selected={side === k} className={side === k ? 'on' : ''} onClick={() => setSide(k)}>
            <span className={`layer-chip l-${k}`}>{k === 'backend' ? 'Backend' : 'Frontend'}</span>
            <span className="muted small">{k === 'backend' ? (be().repo || myPath('backend')) : (d.repo || myPath('frontend'))}</span>
            <span className="side-state small">{busyK ? <><Spinner /> {jj.status === 'queued' ? 'waiting' : 'working'}</> : jj && jj.status !== 'discarded' ? STATUS[jj.status] || jj.status : 'Not started'}</span>
          </button>); })}
        <span className="side-hint small muted">{t.layer ? <>This issue is marked <b>{LAYER_LABEL[t.layer]}</b>.{t.layer === 'both' ? ' Build both at once, or the backend first so the frontend gets its API summary.' : ''}</> : 'Mark the issue frontend, backend or both in its details.'}</span>
      </div>}
      {contract && <details className="contract-box"><summary className="small"><b>API contract</b> <span className="muted">shared by the backend and frontend jobs</span></summary><pre>{contract}</pre></details>}
      {loading ? <div className="muted"><Spinner /> Loading…</div> : !job || ['discarded'].includes(job.status) ? <>
        {agents.length > 0 && <>
          <div className="pick-label small">Which agent?</div>
          {!agents.some((a: Any) => a.writes && a.enabled) && <div className="warn-banner" style={{ marginBottom: 8 }}><Ico svg={I.warn} /><span>No agent can write code yet. Create one in Administration → Agents (kind: <b>Code</b>).</span></div>}
          <div className="agent-pick" role="radiogroup" aria-label="Agent">{agents.filter((a: Any) => !['review', 'review-panel'].includes(a.id)).map((a: Any) => (
            <button key={a.id} role="radio" aria-checked={agentId === a.id} className={`${agentId === a.id ? 'on' : ''} ph-${String(a.phase).toLowerCase()}`} disabled={!a.enabled} onClick={() => setAgentId(a.id)} title={a.does.join(' ')}>
              <span className="agent-icon sm" aria-hidden>{a.icon}</span>
              <span className="ap-text"><b>{a.name}</b><span className="muted small">{a.summary}{!a.enabled ? ' (turned off)' : ''}</span>
                <span className="ap-meta">{a.workspaceLabel} · {a.model}{a.effort ? ` · ${a.effort}` : ''}</span></span></button>))}</div>
          {(() => { const a = agents.find((x: Any) => x.id === agentId); return a ? <ul className="ap-does small">{a.does.map((x: string) => <li key={x}>{x}</li>)}</ul> : null; })()}
        </>}
        <p className="muted small" style={{ marginTop: 0 }}>It runs as a Claude Code agent on <b>{t.title}</b> from its story, {t.acceptanceCriteria?.length || 0} acceptance criteria and {t.testCases?.length || 0} test cases, in a new branch <code>{(d.branchPrefix ?? 'tf/')}{String(t.key).toLowerCase()}-…</code> from <code>{d.baseBranch || 'the default branch'}</code> of <b>{d.repo || d.localPath}</b>, in its own worktree. Nothing is pushed until you review the changes and open the pull request.</p>
        <label className="field"><span>Extra instructions (optional)</span><TA rows={4} value={text} placeholder="e.g. Put the API in app/api/payslips. Reuse the PayslipTable component. Add a Vitest test." onChange={(e) => setText(e.target.value)} /></label>
        {canBoth && <div className="both-box">
          <div><b>Build both at once</b><span className="muted small">Agrees the API in a few seconds, then the backend and frontend agents work in parallel, each in its own repository. About twice as fast as one after the other.</span></div>
          <button className="btn ai" disabled={!!busy} onClick={startBoth}>{busy === 'both' ? <><Spinner />Agreeing the API…</> : <><Ico svg={I.sparkle} />Build both at once</>}</button>
        </div>}
        {backend && side === 'frontend' && t.layer === 'both' && !canBoth && !['committed', 'review', 'starting', 'running'].includes(jobs.backend?.status) && <div className="warn-banner" style={{ marginBottom: 8 }}><Ico svg={I.warn} /><span>The backend part isn’t done yet. You can start the frontend now, but it won’t know the final API.</span>
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setSide('backend')}>Go to Backend</button></div>}
        {backend && side === 'backend' && <p className="small muted" style={{ marginTop: 0 }}>Runs in <code>{myPath('backend')}</code>{be().repo ? <> · {be().provider === 'GitLab' ? 'merge request on GitLab' : 'pull request on GitHub'} <code>{be().repo}</code></> : ''}.</p>}
        <button className="btn ai" disabled={!!busy} onClick={() => act('start', { action: 'start', ticketId: t.id, instructions: text, agentId, side })}>{busy ? <><Spinner />Starting…</> : <><Ico svg={I.sparkle} />{agentId === 'feature-tests' ? 'Write the tests' : 'Start the agent'}</>}</button>
      </> : <>
        <div className="cj-head">
          <div className="cj-title">
            <span className={`cj-badge s-${job.status}`}>{running ? <Spinner /> : <Ico svg={['failed', 'cancelled'].includes(job.status) ? I.warn : ['empty', 'discarded'].includes(job.status) ? I.clock : I.check} />}{STATUS[job.status] || job.status}</span>
            {job.agentName && <span className="cj-agent"><Ico svg={I.bot} />{job.agentName}</span>}
            {job.rounds > 1 && <span className="cj-agent">Round {job.rounds}</span>}
            <span className="spacer" />
            {running && <button className="btn sm" onClick={() => act('cancel', { action: 'cancel' })}><Ico svg={I.stop} />Stop</button>}
            {!running && !['pr', 'merged'].includes(job.status) && <button className="btn sm subtle" onClick={() => openModal(<Confirm title="Discard these changes?" label="Discard" text={`The worktree and the local branch ${job.branch} are removed. Nothing was pushed.`} onYes={async () => { await act('discard', { action: 'discard' }); setJob(null); openModal(<CodeModal t={t} />); }} />)}><Ico svg={I.trash} />Discard</button>}
          </div>
          <div className="cj-meta small">
            <span className="cj-branch" title={`${job.branch} → ${job.base}`}><Ico svg={I.pr} /><code>{job.branch}</code><span className="muted">→</span><code>{job.base}</code></span>
            <span><Ico svg={I.folder} />{job.repo || 'local repository'}</span>
            <span><Ico svg={I.clock} />Started {ago(job.startedAt)}</span>
            {job.remote && <span><Ico svg={I.external} />{job.runUrl ? <a href={job.runUrl} target="_blank" rel="noopener noreferrer">GitHub Actions run</a> : 'AI API + GitHub'}</span>}
            {job.costUsd ? <span>${job.costUsd.toFixed(2)}</span> : null}
          </div>
        </div>
        <JobSteps job={job} />
        {job.error && <div className="warn-banner danger"><Ico svg={I.warn} /><span>{job.error}</span></div>}
        {(() => {
          const tabs = [
            job.summary && !running && { id: 'summary', label: job.status === 'report' ? 'Report' : 'Summary' },
            job.files?.length > 0 && { id: 'changes', label: 'Changes', n: job.files.length },
            job.reviews?.length > 0 && { id: 'reviews', label: 'Reviews', n: job.reviews.length },
            job.coderabbit && { id: 'coderabbit', label: 'CodeRabbit', n: job.coderabbit.status === 'running' ? undefined : (job.coderabbit.findings || []).length },
            { id: 'activity', label: running ? 'Live activity' : 'Activity', n: job.log.filter((l: Any) => l.kind === 'tool').length },
          ].filter(Boolean) as { id: string; label: string; n?: number }[];
          const cur = tabs.find((x) => x.id === tab)?.id || (running ? 'activity' : tabs.find((x) => x.id === 'changes')?.id || tabs[0].id); // finished code opens on its diff (TF-123)
          const rawVerdict = (job.summary || '').match(/^\s*\*\*Verdict:\s*([^*]+?)\.?\*\*/i)?.[1] || '';
          const vClass = /request|block|reject/i.test(rawVerdict) ? 'bad' : /comment/i.test(rawVerdict) ? 'warn' : /approve/i.test(rawVerdict) ? 'ok' : '';
          return <div className="cj-box">
            <div className="cj-tabs" role="tablist">{tabs.map((x) => <button key={x.id} role="tab" aria-selected={cur === x.id} className={cur === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>{x.id === 'activity' && running && <span className="live-dot" />}{x.label}{x.n != null && <span className="cj-n">{x.n}</span>}</button>)}</div>
            <div className={`cj-panel ${cur === 'changes' ? 'cj-panel-diff' : ''}`} ref={cur === 'activity' ? logRef : undefined}>
              {cur === 'summary' && <>
                {(rawVerdict || (job.status === 'report' && (isPrReview || can('export')))) && <div className="cj-toolbar">
                  {rawVerdict && <span className={`cj-verdict v-${vClass}`}><Ico svg={vClass === 'ok' ? I.check : I.warn} />{rawVerdict}</span>}
                  <span className="spacer" />
                  {isPrReview && job.status === 'report' && <>
                    {job.posted ? <span className="muted small"><Ico svg={I.check} /> Posted on {job.target.provider === 'GitLab' ? '!' : '#'}{job.target.number} {ago(job.posted)}</span>
                      : <button className="btn sm primary" disabled={!!busy} onClick={postReview}>{busy === 'postReview' ? <><Spinner />Posting…</> : <><Ico svg={I.comment} />Post on {job.target.provider === 'GitLab' ? '!' : '#'}{job.target.number}</>}</button>}
                    <a className="btn sm subtle" href={job.target.url} target="_blank" rel="noopener noreferrer"><Ico svg={I.external} />Open</a></>}
                  {job.status === 'report' && can('export') && <>
                    <button className="btn sm subtle" onClick={async () => { try { toast(`Downloaded ${await downloadFrom(`/api/projects/${P().id}/code`, { body: { action: 'docx', jobId: job.id }, fallbackName: `${job.agentName} - ${job.ticketKey}.docx` })}`); } catch (e: Any) { toast(`Couldn’t download the report: ${e.message}`, 'err'); } }}><Ico svg={I.download} />.docx</button>
                    <button className="btn sm subtle" onClick={() => saveBlob(new Blob([job.summary], { type: 'text/markdown' }), `${job.agentName} - ${job.ticketKey}.md`)}><Ico svg={I.download} />.md</button></>}
                </div>}
                <div className="cj-doc code-md"><Markdown text={rawVerdict ? job.summary.replace(/^\s*\*\*Verdict:[^*]*\*\*\s*/i, '') : job.summary} /></div>
              </>}
              {cur === 'changes' && <DiffReview job={job} />}
              {cur === 'reviews' && (() => { const rv = job.reviews[job.reviews.length - 1]; const lens = rv.lenses?.[Math.min(reviewTab, rv.lenses.length - 1)]; return <>
                <div className="cj-toolbar"><b className="small">{rv.panel ? 'Review Panel' : rv.agent || 'Review agent'} · round {rv.round}</b><span className="spacer" />
                  {job.status === 'review' && <button className="btn sm ai" disabled={!!busy} onClick={() => act('follow', { action: 'follow', text: `Fix these review findings (skip any you disagree with and say why):\n\n${rv.text}` })}><Ico svg={I.sparkle} />Fix the findings</button>}</div>
                {rv.panel && <div className="review-tabs" role="tablist">{rv.lenses.map((l: Any, i: number) => <button key={l.id} role="tab" aria-selected={reviewTab === i} className={reviewTab === i ? 'on' : ''} onClick={() => setReviewTab(i)}>{l.name}</button>)}</div>}
                <div className="cj-doc code-md"><Markdown text={rv.panel ? lens?.text || '' : rv.text} /></div></>; })()}
              {cur === 'coderabbit' && <CodeRabbitPanel t={t} job={job} busy={busy} run={() => { act('coderabbit', { action: 'coderabbit' }); setTab('coderabbit'); }} follow={(text) => act('follow', { action: 'follow', text })} />}
              {cur === 'activity' && <>
                {job.todos?.length > 0 && <div className="cj-plan"><div className="small"><b>Plan</b> <span className="muted">{job.todos.filter((x: Any) => x.status === 'completed').length} of {job.todos.length} done</span></div>
                  <ul>{job.todos.map((x: Any, i: number) => <li key={i} className={x.status}><span className="tick">{x.status === 'completed' ? <Ico svg={I.check} /> : x.status === 'in_progress' ? <Spinner /> : null}</span>{x.content}</li>)}</ul></div>}
                <Activity log={job.log} running={running} />
              </>}
            </div>
          </div>;
        })()}
        {job.remote && ['review', 'pr', 'merged'].includes(job.status) && <ApprovalBox job={job} busy={busy} onApprove={approve} onMerge={merge} />}
        {['review', 'report', 'empty', 'failed', 'cancelled'].includes(job.status) && <div className="code-follow cj-compose">
          <TA rows={2} value={follow} placeholder="Ask for changes: e.g. also handle the empty state, and rename the hook to usePayslips" onChange={(e) => setFollow(e.target.value)} />
          <button className="btn ai" disabled={!follow.trim() || !!busy} onClick={async () => { if (await act('follow', { action: 'follow', text: follow })) setFollow(''); }}><Ico svg={I.sparkle} />Make changes</button>
        </div>}
        {job.status === 'review' && !job.pr && !job.remote && <div className="review-actions">
          {roles.review && <button className="agent-btn hire sm" disabled={!!busy} onClick={() => act('review', { action: 'review' })} title={`Reviewed by ${agents.find((a: Any) => a.id === roles.review)?.name || 'the review agent'}`}>🔍 {job.reviews?.length ? 'Review again' : 'Review changes'}</button>}
          {roles.review && agents.some((a: Any) => a.id === 'review-panel' && a.enabled) && <button className="agent-btn hire sm" disabled={!!busy} onClick={() => { setReviewTab(0); act('review', { action: 'review', panel: true }); }} title="Three Review agents in parallel: correctness, security, tests & acceptance">🤝 Review panel</button>}
          {agents.some((a: Any) => a.id === 'ui-review' && a.enabled) && <button className="agent-btn hire sm" disabled={!!busy} onClick={() => act('review', { action: 'review', agent: 'ui-review' })} title="Usability, accessibility, states, copy and responsive layout">🧐 UI/UX review</button>}
          {agents.filter((a: Any) => a.custom && !a.writes && a.enabled && a.id !== roles.review).map((a: Any) => <button key={a.id} className="agent-btn hire sm" disabled={!!busy} onClick={() => act('review', { action: 'review', agent: a.id })} title={a.summary}>{a.icon} {a.name}</button>)}
          <button className="agent-btn hire sm" disabled={!!busy || job.coderabbit?.status === 'running'} onClick={() => { act('coderabbit', { action: 'coderabbit' }); setTab('coderabbit'); }} title="An independent review by the CodeRabbit CLI: findings by severity, with fix instructions">🐇 {job.coderabbit?.status === 'running' ? 'CodeRabbit is reviewing…' : 'CodeRabbit review'}</button>
          <span className="muted small">Read-only reviewers. They never edit files.</span></div>}
        {job.status === 'committed' && <div className="ok-banner"><Ico svg={I.check} /><span>Committed on the local branch <code>{job.branch}</code> in <code>{job.repoPath}</code>. Nothing was pushed.{side === 'backend' && t.layer === 'both' ? ' Next: the Frontend tab, which builds on this API.' : ''}</span>
          {side === 'backend' && t.layer === 'both' && <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setSide('frontend')}>Go to Frontend</button>}</div>}
        {job.status === 'review' && can('issue.edit') && job.target && <div className="code-pr pr-compose">
          <div className="pr-compose-h"><Ico svg={I.pr} /><b>Update {job.target.provider === 'GitLab' ? `merge request !${job.target.number}` : `pull request #${job.target.number}`}</b>
            <a className="muted small" href={job.target.url} target="_blank" rel="noopener noreferrer">{job.target.title}</a></div>
          <label className="field" style={{ margin: 0 }}><span>Commit message</span><TF value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" disabled={!!busy || !title.trim()} onClick={pushUpdate}>{busy === 'push' ? <><Spinner />Pushing…</> : <><Ico svg={I.pr} />Commit and push to {job.target.provider === 'GitLab' ? '!' : '#'}{job.target.number}</>}</button>
            <span className="muted small">Pushes to <code>{job.branch}</code>; the {job.target.provider === 'GitLab' ? 'merge request' : 'pull request'} updates itself, and a comment says what changed.</span></div>
        </div>}
        {job.status === 'review' && can('issue.edit') && !job.target && <div className="code-pr pr-compose">
          <div className="pr-compose-h"><Ico svg={I.pr} /><b>{job.provider === 'GitLab' ? 'Merge request' : 'Pull request'}</b><span className="muted small"><code>{job.branch}</code> → <code>{job.base}</code></span>
            {can('ai.use') && <button className="btn sm ai" style={{ marginLeft: 'auto' }} disabled={!!busy} onClick={draftPr}>{busy === 'draft' ? <><Spinner />Writing…</> : <><Ico svg={I.sparkle} />{prBody ? 'Rewrite with AI' : 'Write title & description with AI'}</>}</button>}</div>
          <label className="field" style={{ margin: 0 }}><span>Title</span><TF value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="field" style={{ margin: 0 }}><span>Description (Markdown)</span>
            <TA rows={prBody ? 10 : 3} value={prBody} placeholder="Leave empty for the standard description (story, acceptance criteria, the agent’s summary), or write it with AI: Summary, Changes, How to test, Acceptance criteria." onChange={(e) => setPrBody(e.target.value)} /></label>
          <div className="row" style={{ gap: 8 }}>
            <CB label="Draft" checked={draft} onChange={(e: Any) => setDraft(e.target.checked)} />
            <span className="spacer" />
            {!job.remote && <button className="btn subtle" disabled={!!busy || !title.trim()} onClick={commitLocal} title="Commit on the local branch without pushing">{busy === 'commit' ? <Spinner /> : 'Commit locally only'}</button>}
            <button className="btn primary" disabled={!!busy || !title.trim()} onClick={openPr}>{busy === 'pr' ? <><Spinner />Opening…</> : <><Ico svg={I.pr} />{job.remote ? 'Open pull request' : <>Commit, push and open {job.provider === 'GitLab' ? 'MR' : 'PR'}</>}</>}</button>
          </div>
          <div className="muted small">{job.remote ? 'Opens the pull request for the branch the job pushed to GitHub.' : <>Commits with your git name and email, pushes <code>{job.branch}</code> to the repository’s <code>origin</code> with your own git setup (SSH key or credential helper; the project’s token only if that’s refused), then opens the {job.provider === 'GitLab' ? 'merge request' : 'pull request'}.</>}
          </div>
        </div>}
        {job.pr?.compare && <div className="ok-banner"><Ico svg={I.check} /><span>Committed and pushed <code>{job.branch}</code> with your git setup. <a href={job.pr.url} target="_blank" rel="noopener noreferrer">Open the {job.provider === 'GitLab' ? 'merge request' : 'pull request'} on {job.provider || 'GitHub'}</a> to finish; link it to this issue in Development once it’s open.</span></div>}
        {job.pr && !job.pr.compare && job.status !== 'merged' && <div className="ok-banner"><Ico svg={I.check} /><span>{job.provider === 'GitLab' ? 'Merge request' : 'Pull request'} <a href={job.pr.url} target="_blank" rel="noopener noreferrer">{job.provider === 'GitLab' ? '!' : '#'}{job.pr.number} {job.pr.title}</a> {job.target ? 'is updated with these changes.' : `is open${job.pr.draft ? ' as a draft' : ''} and linked to this issue.`}</span></div>}
      </>}
    </Modal>
  );
}
export const openCode = (t: Any, side?: string) => openModal(<CodeModal t={t} initialSide={side} />);
/** "Write code" on an issue or an epic's issue (TF-124): Code Jobs in a new tab with the issue; this tab stays as it is. The page loads the prompt and the linked repository or spec itself. */
export const openWriteCode = (t: Any) => { window.open(`/code-jobs?project=${encodeURIComponent(P().id)}&ticket=${encodeURIComponent(t.id)}`, '_blank', 'noopener'); };

// ---------------------------------------------------------------- update an open pull / merge request with AI
const UPDATE_MODES: [string, string, string][] = [
  ['prompt', 'Apply changes', 'Tell the agent what to change; it works on the request’s branch.'],
  ['enhance', 'Enhance', 'Better tests, edge cases and error handling, without changing what it does.'],
  ['review', 'Address review comments', 'Reads the open review comments and fixes what they ask.'],
  ['describe', 'Improve description', 'Rewrites the title and description from the real diff. No code changes.'],
];
function UpdatePrModal({ t, pr }: { t: Any; pr: Any }) {
  const [mode, setMode] = useState('prompt');
  const [text, setText] = useState('');
  const [comments, setComments] = useState<Any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/projects/${P().id}/code`;
  const noun = pr.provider === 'GitLab' ? 'merge request' : 'pull request';
  const ref = `${pr.provider === 'GitLab' ? '!' : '#'}${pr.number}`;
  const loadComments = async () => {
    setComments(null);
    try { setComments((await api(base, { method: 'POST', body: { action: 'comments', ticketId: t.id, prId: pr.id } })).comments); } catch (e: Any) { setComments([]); toast(e.message, 'err'); }
  };
  const pick = (m: string) => { setMode(m); if (m === 'review' && comments === null) loadComments(); };
  const go = async () => {
    setBusy(true);
    try {
      if (mode === 'describe') {
        const r = await api(base, { method: 'POST', body: aiBody({ action: 'describe', ticketId: t.id, prId: pr.id }) });
        mutate(() => { pr.title = r.title; logEvent(t, `rewrote the description of ${noun} ${ref} with AI`, 'Development'); });
        closeModal(); toast(`${ref} now reads “${r.title}”.`, 'ok', { title: 'Description updated', action: { label: 'Open', onClick: () => window.open(pr.url, '_blank', 'noopener') } });
        return;
      }
      const job = await api(base, { method: 'POST', body: aiBody({ action: 'update', ticketId: t.id, prId: pr.id, mode, prompt: text }) });
      closeModal(); openCode(t, job.side);
    } catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const ready = mode === 'prompt' ? Boolean(text.trim()) : mode === 'review' ? Boolean(comments?.length) : true;
  return (
    <Modal title={`Update ${ref} with AI`} wide actions={[{ label: 'Cancel' }, { label: busy ? 'Starting…' : mode === 'describe' ? 'Rewrite description' : 'Start', kind: 'ai', disabled: busy || !ready, onClick: go }]}>
      <p className="muted small" style={{ marginTop: 0 }}><b>{pr.title}</b> · {pr.repo} · <code>{pr.branch}</code> → <code>{pr.base}</code>. Code changes run on the {noun}’s own branch; you review the diff, then push to the same {noun}.</p>
      <div className="upd-modes" role="radiogroup" aria-label="What to do">{UPDATE_MODES.map(([k, l, d]) => (
        <button key={k} role="radio" aria-checked={mode === k} className={mode === k ? 'on' : ''} onClick={() => pick(k)}><b>{l}</b><span className="muted small">{d}</span></button>))}</div>
      {mode === 'review' && <div className="upd-comments">{comments === null ? <span className="muted small"><Spinner /> Reading the review comments…</span>
        : comments.length ? <ul className="small">{comments.slice(0, 12).map((c, i) => <li key={i}><b>{c.author ? `@${c.author}` : 'Reviewer'}</b>{c.file ? <code> {c.file}{c.line ? `:${c.line}` : ''}</code> : null} — {c.body.slice(0, 220)}{c.body.length > 220 ? '…' : ''}</li>)}{comments.length > 12 && <li className="muted">…and {comments.length - 12} more</li>}</ul>
        : <span className="muted small">No open review comments on it.</span>}</div>}
      {mode !== 'describe' && <label className="field" style={{ marginTop: 10 }}><span>{mode === 'prompt' ? 'What to change' : 'Anything else (optional)'}</span>
        <TA rows={4} value={text} autoFocus={mode === 'prompt'} placeholder={mode === 'prompt' ? 'e.g. Rename the endpoint to /salary-proposals/:id/notify, and return 404 when the proposal is missing.' : 'e.g. Focus the tests on the approval rules.'} onChange={(e) => setText(e.target.value)} /></label>}
    </Modal>
  );
}
export const openUpdatePr = (t: Any, pr: Any) => openModal(<UpdatePrModal t={t} pr={pr} />);
// CodeRabbit findings on a pull request → an agent round on that request's branch (same as Update → What to change).
setPrFixer(async (t, pr, text) => {
  if (!codeReady()) { toast('Writing code needs TicketForge on your computer with the local repository set (Project settings → Code & GitHub).', 'err'); return; }
  try { const job = await api(`/api/projects/${P().id}/code`, { method: 'POST', body: aiBody({ action: 'update', ticketId: t.id, prId: pr.id, mode: 'prompt', prompt: text }) }); closeModal(); openCode(t, job.side); }
  catch (e: Any) { toast(e.message, 'err'); }
});
void S; void closeModal; void emit;

// ---------------------------------------------------------------- many issues at once
const LIVE = ['starting', 'queued', 'running'];
const sideOf = (t: Any) => (hasBackend() ? (t.layer === 'both' ? 'both' : t.layer === 'backend' ? 'backend' : 'frontend') : 'frontend');

/** Backlog → select issues → Write code with AI: one job per issue (both repositories for Frontend + Backend issues). */
export function BulkCodeModal({ ids }: { ids: string[] }) {
  const tickets = P().tickets.filter((x: Any) => ids.includes(x.id));
  const [agents, setAgents] = useState<Any[]>([]);
  const [agentId, setAgentId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Any>(null);
  const base = `/api/projects/${P().id}/code`;
  useEffect(() => { api(`${base}?ticketId=`).then((r) => setAgents((r.agents || []).filter((a: Any) => a.enabled && a.writes))).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const jobsCount = tickets.reduce((n: number, x: Any) => n + (sideOf(x) === 'both' ? 2 : 1), 0);
  const start = async (only?: string[]) => {
    setBusy(true);
    try {
      const ticketIds = only || tickets.map((x: Any) => x.id);
      const r = await api(base, { method: 'POST', body: aiBody({ action: 'start-many', ticketIds, instructions: text, agentId }) });
      setResult({ ...r, held: tickets.filter((x: Any) => !ticketIds.includes(x.id)).map((x: Any) => x.key) }); refreshCodeStatus();
      mutate(() => { for (const x of tickets) if (r.started.some((j: Any) => j.ticketId === x.id)) logEvent(x, 'started writing code with AI (batch)', 'Development'); });
      S.checked.clear(); emit();
    } catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  if (result) return <Modal title="Code jobs" wide actions={[{ label: 'Close (jobs keep running)' }]}>
    <div className={`warn-banner ${result.skipped.length ? '' : 'ok-banner'}`} style={{ marginBottom: 12 }}><Ico svg={result.skipped.length ? I.warn : I.check} />
      <span>Started {result.started.length} job{result.started.length === 1 ? '' : 's'}{result.skipped.length ? `; skipped ${result.skipped.map((x: Any) => `${x.key} (${x.reason})`).join(', ')}` : ''}. Up to {result.queue.max} run at once; the rest wait in line.{result.held?.length ? ` Held back to avoid conflicts: ${result.held.join(', ')}. Start them once the first round is merged.` : ''}</span></div>
    <CodeJobs />
  </Modal>;
  return <Modal title={`Write code for ${tickets.length} issue${tickets.length === 1 ? '' : 's'}`} wide actions={[{ label: 'Cancel' }]}>
    <p className="muted small" style={{ marginTop: 0 }}>Each issue gets its own branch, worktree and Claude Code agent. Frontend + Backend issues get an API contract and a job in each repository. Jobs run a few at a time; the rest wait in line, and you review each one as it finishes.</p>
    <ul className="bulk-code-list">{tickets.map((x: Any) => <li key={x.id}><code>{x.key}</code><span className="bcl-title">{x.title}</span>
      {hasBackend() ? <span className={`layer-chip l-${sideOf(x)}`}>{{ frontend: 'Frontend', backend: 'Backend', both: 'FE + BE' }[sideOf(x) as 'frontend']}</span> : null}
      <span className="muted small">{x.acceptanceCriteria?.length || 0} AC</span></li>)}</ul>
    <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label className="field" style={{ minWidth: 240 }}><span>Agent</span>
        <SF value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <MenuItem value="">{hasBackend() ? 'Automatic: Frontend / Backend Developer per repository' : 'Build a Ticket'}</MenuItem>
          {agents.map((a: Any) => <MenuItem key={a.id} value={a.id}>{a.icon} {a.name} · {a.model}</MenuItem>)}</SF></label>
    </div>
    <label className="field"><span>Extra instructions for every issue (optional)</span><TA rows={3} value={text} placeholder="e.g. Follow the patterns in src/features/orders. Add a Vitest test for each acceptance criterion." onChange={(e) => setText(e.target.value)} /></label>
    <ParallelCheck ids={tickets.map((x: Any) => x.id)} busy={busy} onStart={(ids) => start(ids)} />
    <button className="btn ai" disabled={busy || !tickets.length} onClick={() => start()}>{busy ? <><Spinner />Starting…</> : <><Ico svg={I.sparkle} />{tickets.length > 1 ? `Start all ${jobsCount} job${jobsCount === 1 ? '' : 's'}` : `Start ${jobsCount} job${jobsCount === 1 ? '' : 's'}`}</>}</button>
  </Modal>;
}

/** Every code job in the project, live: status, progress, changes and cost; click one to open it. */
export function CodeJobs() {
  const [data, setData] = useState<Any>(null);
  const base = `/api/projects/${P().id}/code`;
  const load = () => api(`${base}?list=1`).then(setData).catch((e: Any) => toast(e.message, 'err'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!data?.jobs?.some((j: Any) => LIVE.includes(j.status))) return;
    const h = setTimeout(load, 2500);
    return () => clearTimeout(h);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <div className="muted"><Spinner /> Loading…</div>;
  const jobs = data.jobs || [];
  if (!jobs.length) return <p className="muted">No code jobs yet. Select issues in the backlog and choose <b>Write code with AI</b>, or open an issue’s Development section.</p>;
  const n = (s: string[]) => jobs.filter((j: Any) => s.includes(j.status)).length;
  const stop = async (j: Any) => { try { await api(base, { method: 'POST', body: { action: 'cancel', jobId: j.id } }); load(); } catch (e: Any) { toast(e.message, 'err'); } };
  const open = (j: Any) => { const t = P().tickets.find((x: Any) => x.id === j.ticketId); if (t) { closeModal(); openCode(t, j.side); } };
  return <div className="jobs-ov">
    <div className="jobs-sum">
      <span><b>{n(['running', 'starting'])}</b> running</span><span><b>{n(['queued'])}</b> waiting</span>
      <span><b>{n(['review', 'report'])}</b> ready for review</span><span><b>{n(['pr', 'committed'])}</b> shipped</span>
      {n(['failed', 'cancelled', 'empty']) > 0 && <span className="bad"><b>{n(['failed', 'cancelled', 'empty'])}</b> need attention</span>}
      <span className="spacer" /><span className="muted small">{data.queue.max === 'GitHub' ? 'Runs through the AI API and GitHub' : `${data.queue.running} of ${data.queue.max} agent slots busy`}</span>
    </div>
    <div className="jobs-list">{jobs.map((j: Any) => {
      const t = P().tickets.find((x: Any) => x.id === j.ticketId);
      const add = (j.files || []).reduce((s: number, f: Any) => s + f.added, 0), del = (j.files || []).reduce((s: number, f: Any) => s + f.removed, 0);
      return <div key={j.id} className={`job-row s-${j.status}`} role="button" tabIndex={0} onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) open(j); }} onKeyDown={(e) => { if (e.key === 'Enter') open(j); }}>
        <span className={`cj-badge s-${j.status}`}>{LIVE.includes(j.status) ? <Spinner /> : <Ico svg={['failed', 'cancelled'].includes(j.status) ? I.warn : I.check} />}{({ queued: 'Waiting', running: 'Working', starting: 'Starting' } as Record<string, string>)[j.status] || STATUS[j.status] || j.status}</span>
        <div className="job-main">
          <div className="job-l1"><code>{j.ticketKey}</code><span className="job-title">{t?.title || ''}</span>{hasBackend() && <span className={`layer-chip l-${j.side}`}>{j.side === 'backend' ? 'Backend' : 'Frontend'}</span>}</div>
          <div className="job-l2 muted small"><span>{j.agentName}</span>
            {j.todosTotal > 0 && <span>Plan {j.todosDone}/{j.todosTotal}</span>}
            {LIVE.includes(j.status) && j.last ? <span className="job-last">{j.last}</span> : j.error ? <span className="job-last bad">{j.error}</span> : null}
            {j.files?.length > 0 && <span>{j.files.length} file{j.files.length === 1 ? '' : 's'} <span className="da">+{add}</span> <span className="dr">−{del}</span></span>}
            {j.costUsd > 0 && <span>${j.costUsd.toFixed(2)}</span>}<span>{ago(j.startedAt)}</span></div>
        </div>
        {LIVE.includes(j.status) ? <button className="btn sm subtle" onClick={() => stop(j)}><Ico svg={I.stop} />{j.status === 'queued' ? 'Remove' : 'Stop'}</button>
          : <button className="btn sm" onClick={() => open(j)}>{['review', 'report'].includes(j.status) ? 'Review' : 'Open'}</button>}
      </div>;
    })}</div>
  </div>;
}
export const openCodeJobs = () => openModal(<Modal title="Code jobs" wide actions={[{ label: 'Close' }]}><CodeJobs /></Modal>);

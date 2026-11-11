'use client';
// Code & GitHub: a project's local repository and GitHub settings, and the "Write code with AI" job for an issue:
// Claude Code implements it in its own git worktree, you review the diff, TicketForge opens the pull request.
import { useEffect, useRef, useState } from 'react';
import { S, P, api, startTask, aiBody, setField, downloadFrom, saveBlob, can, mutate, toast, openModal, closeModal, uid, nowIso, logEvent, ago, emit, type Any } from './core';
import { Ico, I, Modal, Spinner, Confirm, SetCard, LAYER_LABEL } from './ui';
import { TF, TA, SF, CB, MenuItem } from './fields';
import { Markdown } from './GuideCard';

const dev = () => P().dev || {};
const be = () => P().devBackend || {};
const setBe = (k: string, v: Any) => mutate((pp) => { pp.devBackend = { ...(pp.devBackend || {}), [k]: v }; }, { tag: `devBackend.${k}` });
/** The project has a separate backend repository set up. */
export const hasBackend = () => Boolean(be().enabled && be().localPath);
const setDev = (k: string, v: Any) => mutate((pp) => { pp.dev = { ...(pp.dev || {}), [k]: v }; }, { tag: `dev.${k}` });

/** Pick a folder on this computer: click through folders (git repositories are marked), then choose one. */
function FolderPicker({ start, onPick }: { start: string; onPick: (path: string) => void }) {
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
    <Modal title="Choose the repository folder" wide actions={[{ label: 'Cancel' }, { label: at?.git ? 'Use this repository' : 'Use this folder', kind: 'primary', disabled: !at, onClick: () => { closeModal(); onPick(at.path); } }]}>
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
        <p className="muted small" style={{ margin: '8px 0 0' }}>Open the folder of the project’s clone (marked <b>git</b>), then choose it. Only folder names are shown; files are never read here.</p>
      </>}
      {!at && <div className="muted"><Spinner /> Loading…</div>}
    </Modal>
  );
}

/** Project settings → Code & GitHub. */
export function DevSettings({ ed }: { ed: boolean }) {
  const d = dev();
  const [env, setEnv] = useState<Any>(null);
  const [check, setCheck] = useState<Any>(null);
  const [busy, setBusy] = useState('');
  const [token, setToken] = useState('');
  useEffect(() => { api(`/api/projects/${P().id}/dev`).then(setEnv).catch(() => setEnv({})); }, []);
  const inspect = async (localPath?: string) => {
    setBusy('check'); setCheck(null);
    try {
      const r = await api(`/api/projects/${P().id}/dev`, { method: 'POST', body: { action: 'inspect', localPath: localPath ?? dev().localPath } });
      setCheck({ ok: true, ...r });
      mutate((pp) => { pp.dev = { ...(pp.dev || {}), localPath: r.path, repo: pp.dev?.repo || r.repo, baseBranch: pp.dev?.baseBranch || r.defaultBranch }; });
    } catch (e: Any) { setCheck({ ok: false, error: e.message }); } finally { setBusy(''); }
  };
  const saveToken = async (clear = false) => {
    setBusy('token');
    try { const r = await api(`/api/projects/${P().id}/dev`, { method: 'POST', body: clear ? { action: 'clearToken' } : { action: 'saveToken', token } }); setEnv({ ...env, hasToken: r.hasToken }); setToken(''); toast(clear ? 'Token removed' : 'GitHub token saved (encrypted)'); }
    catch (e: Any) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const tokenLine = env?.hasToken ? 'A token is saved for this project (encrypted).' : env?.envToken ? 'Using GITHUB_TOKEN from the server.' : env?.ghSignedIn ? 'Using your GitHub CLI sign-in (gh) on this computer.' : 'No token: pull requests can’t be opened yet.';
  return <>
    {env && !env.local && <div className="warn-banner"><Ico svg={I.warn} /><span>Writing code works only when TicketForge runs on your computer (opened at localhost), next to the repository. You can still fill in these settings here.</span></div>}
    <SetCard id="repo" title="Repository" desc="A local clone of the project’s GitHub repository. Each issue gets its own branch and git worktree, so your own checkout and uncommitted work are never touched.">
      <div className="dev-path">
        <label className="field" style={{ flex: 1, margin: 0 }}><span>Local folder</span>
          <TF disabled={!ed} value={d.localPath || ''} placeholder="/Users/you/code/tito-payroll" spellCheck={false} onChange={(e) => setDev('localPath', e.target.value)} /></label>
        <button className="btn" disabled={!ed || env?.local === false} onClick={() => openModal(<FolderPicker start={d.localPath || ''} onPick={(p) => { setDev('localPath', p); setTimeout(() => inspect(p), 50); }} />)}><Ico svg={I.folder} />Browse…</button>
        <button className="btn" disabled={!ed || !d.localPath || !!busy || env?.local === false} onClick={() => inspect()}>{busy === 'check' ? <><Spinner />Checking…</> : 'Check'}</button>
      </div>
      {check && (check.ok
        ? <div className="ok-banner" style={{ marginTop: 8 }}><Ico svg={I.check} /><span>Git repository{check.repo ? <> for <b>{check.repo}</b></> : ' (no GitHub remote found)'} · default branch <code>{check.defaultBranch}</code> · you’re on <code>{check.currentBranch}</code>{check.uncommitted ? ` with ${check.uncommitted} uncommitted change${check.uncommitted === 1 ? '' : 's'} (left alone)` : ''}.</span></div>
        : <div className="warn-banner danger" style={{ marginTop: 8 }}><Ico svg={I.warn} /><span>{check.error}</span></div>)}
      <div className="grid2" style={{ marginTop: 12 }}>
        <label className="field"><span>GitHub repository (owner/name)</span><TF disabled={!ed} value={d.repo || ''} placeholder="titoarvs/tito-payroll" spellCheck={false} onChange={(e) => setDev('repo', e.target.value.trim())} /></label>
        <label className="field"><span>Base branch</span><TF disabled={!ed} value={d.baseBranch || ''} placeholder="main" spellCheck={false} onChange={(e) => setDev('baseBranch', e.target.value.trim())} /></label>
        <label className="field"><span>Branch prefix</span><TF disabled={!ed} value={d.branchPrefix ?? 'tf/'} spellCheck={false} onChange={(e) => setDev('branchPrefix', e.target.value.trim())} />
          <small className="muted">Branches look like <code>{(d.branchPrefix ?? 'tf/')}pay-12-short-title</code></small></label>
        <label className="field"><span>Claude model</span><SF disabled={!ed} value={d.model || ''} onChange={(e) => setDev('model', e.target.value)}><MenuItem value="">Each agent’s own (Administration → Agents)</MenuItem>{['opus', 'sonnet', 'haiku'].map((m) => <MenuItem key={m} value={m}>{m} for every agent</MenuItem>)}</SF></label>
      </div>
      <CB label="Open pull requests as drafts" disabled={!ed} checked={d.draft !== false} onChange={(e: Any) => setDev('draft', e.target.checked)} />
    </SetCard>
    <SetCard id="agent" title="Coding agent" desc="What the code agents (Build a Ticket, Feature Tests, Review…) may run and how your team writes code. They read and edit files only in the issue’s worktree; they can’t commit, push, switch branches or browse the web. What each agent does is set in Administration → Agents.">
      <label className="field"><span>Check command (optional)</span><TF disabled={!ed} value={d.checkCommand || ''} placeholder="e.g. npm test, or npm run lint" spellCheck={false} onChange={(e) => setDev('checkCommand', e.target.value)} />
        <small className="muted">The only command it may run, to check its work. Leave empty and it only reads and edits code.</small></label>
      <label className="field"><span>Team conventions</span><TA disabled={!ed} rows={4} value={d.notes || ''} placeholder="e.g. Next.js App Router, server actions for writes, Tailwind, tests with Vitest next to the file. Don’t touch the payments module." onChange={(e) => setDev('notes', e.target.value)} /></label>
    </SetCard>
    <BackendRepoCard ed={ed} local={env?.local !== false} env={env} setEnv={setEnv} />
    <SetCard id="gh-token" title="GitHub access" desc="To push the branch and open the pull request. A fine-grained token needs Contents and Pull requests (read and write) on this repository.">
      <p className="small" style={{ margin: '0 0 8px' }}><span className={`dot ${env?.hasToken || env?.envToken || env?.ghSignedIn ? 'ok' : 'bad'}`} style={{ marginRight: 6 }} />{env ? tokenLine : 'Checking…'}</p>
      {ed && <div className="dev-path">
        <TF type="password" autoComplete="off" value={token} placeholder={env?.hasToken ? 'Replace the saved token' : 'github_pat_… or ghp_…'} onChange={(e) => setToken(e.target.value)} />
        <button className="btn" disabled={!token.trim() || !!busy} onClick={() => saveToken()}>Save token</button>
        {env?.hasToken && <button className="btn subtle" disabled={!!busy} onClick={() => saveToken(true)}>Remove</button>}
      </div>}
    </SetCard>
  </>;
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
        <div className="dev-path">
          <label className="field" style={{ flex: 1, margin: 0 }}><span>Local folder</span>
            <TF disabled={!ed} value={d.localPath || ''} placeholder="/Users/you/code/my-app-api" spellCheck={false} onChange={(e) => setBe('localPath', e.target.value)} /></label>
          <button className="btn" disabled={!ed || !local} onClick={() => openModal(<FolderPicker start={d.localPath || dev().localPath || ''} onPick={(p) => { setBe('localPath', p); setTimeout(() => inspect(p), 50); }} />)}><Ico svg={I.folder} />Browse…</button>
          <button className="btn" disabled={!ed || !d.localPath || !!busy || !local} onClick={() => inspect()}>{busy === 'check' ? <><Spinner />Checking…</> : 'Check'}</button>
        </div>
        {check && (check.ok
          ? <div className="ok-banner" style={{ marginTop: 8 }}><Ico svg={I.check} /><span>{check.provider || 'Git'} repository{check.remote ? <> · <code>{check.remote}</code></> : ''} · default branch <code>{check.defaultBranch}</code> · you’re on <code>{check.currentBranch}</code>{check.uncommitted ? ` · ${check.uncommitted} uncommitted file${check.uncommitted > 1 ? 's' : ''} (left untouched)` : ''}</span></div>
          : <div className="warn-banner danger" style={{ marginTop: 8 }}><Ico svg={I.warn} /><span>{check.error}</span></div>)}
        <div className="grid2" style={{ marginTop: 12 }}>
          <label className="field"><span>{gitlab ? 'GitLab project (group/name)' : 'GitHub repository (owner/name)'}</span><TF disabled={!ed} value={d.repo || ''} placeholder={gitlab ? 'tito-solutions/hris/tito-hris-api' : 'owner/my-app-api'} spellCheck={false} onChange={(e) => setBe('repo', e.target.value.trim())} />
            <small className="muted">Found from the folder’s origin when you click Check. Pull requests open {gitlab ? 'as GitLab merge requests' : 'on GitHub'}.</small></label>
          <label className="field"><span>Base branch</span><TF disabled={!ed} value={d.baseBranch || ''} placeholder="develop" spellCheck={false} onChange={(e) => setBe('baseBranch', e.target.value.trim())} /></label>
          <label className="field"><span>Branch prefix</span><TF disabled={!ed} value={d.branchPrefix ?? dev().branchPrefix ?? 'tf/'} spellCheck={false} onChange={(e) => setBe('branchPrefix', e.target.value.trim())} /></label>
          <label className="field"><span>Check command (optional)</span><TF disabled={!ed} value={d.checkCommand || ''} placeholder="e.g. npm test" spellCheck={false} onChange={(e) => setBe('checkCommand', e.target.value)} /></label>
        </div>
        <label className="field"><span>Backend conventions</span><TA disabled={!ed} rows={3} value={d.notes || ''} placeholder="e.g. Express + Drizzle, routes in src/routes, migrations with drizzle-kit, Vitest tests next to the file. Never edit existing migrations." onChange={(e) => setBe('notes', e.target.value)} /></label>
        {gitlab ? <div className="field" style={{ marginTop: 4 }}><span>GitLab access token</span>
          <p className="small" style={{ margin: '0 0 6px' }}><span className={`dot ${env?.hasGitlabToken || env?.envGitlabToken ? 'ok' : 'bad'}`} style={{ marginRight: 6 }} />
            {env?.hasGitlabToken ? 'A token is saved for this project (encrypted).' : env?.envGitlabToken ? 'Using GITLAB_TOKEN from the server.' : 'No token: the branch is pushed with your own git sign-in, and you open the merge request on GitLab from the link given.'}</p>
          {ed && <div className="dev-path">
            <TF type="password" autoComplete="off" value={glToken} placeholder={env?.hasGitlabToken ? 'Replace the saved token' : 'glpat-… (scopes: api, write_repository)'} onChange={(e) => setGlToken(e.target.value)} />
            <button className="btn" disabled={!glToken.trim() || !!busy} onClick={() => saveGl()}>Save token</button>
            {env?.hasGitlabToken && <button className="btn subtle" disabled={!!busy} onClick={() => saveGl(true)}>Remove</button>}
          </div>}</div>
          : <p className="small muted" style={{ margin: '4px 0 0' }}>Pull requests use the project’s GitHub access below.</p>}
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
export const codeReady = () => Boolean(dev().localPath);

const STATUS: Record<string, string> = { committed: 'Committed locally', report: 'Report ready', starting: 'Starting…', running: 'Claude Code is working…', review: 'Ready for review', empty: 'No changes', failed: 'Failed', cancelled: 'Stopped', pr: 'Pull request open', discarded: 'Discarded' };

function DiffView({ jobId, file }: { jobId: string; file: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { api(`/api/projects/${P().id}/code?jobId=${jobId}&diff=1&file=${encodeURIComponent(file)}`, { raw: true }).then((r: Any) => r.text()).then(setText).catch((e: Any) => setText(`Couldn’t load the diff: ${e.message}`)); }, [jobId, file]);
  if (text === null) return <div className="muted small" style={{ padding: 8 }}><Spinner /> Loading…</div>;
  return <pre className="diff">{text.split('\n').filter((l) => !/^(diff --git|index |new file mode|deleted file mode)/.test(l)).map((l, i) =>
    <span key={i} className={l.startsWith('+++') || l.startsWith('---') ? 'dh' : l.startsWith('@@') ? 'dc' : l.startsWith('+') ? 'da' : l.startsWith('-') ? 'dr' : ''}>{l || ' '}{'\n'}</span>)}</pre>;
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
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [follow, setFollow] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [title, setTitle] = useState(`${t.key}: ${t.title}`);
  const [prBody, setPrBody] = useState('');
  const [draft, setDraft] = useState(dev().draft !== false);
  const logRef = useRef<HTMLDivElement>(null);
  const base = `/api/projects/${P().id}/code`;
  useEffect(() => { api(`${base}?ticketId=${t.id}`).then((r) => {
    setJobs(r.jobs || { frontend: r.job }); setBackend(Boolean(r.backend)); setAgents(r.agents || []);
    // A "both" issue whose backend is done: open on the frontend.
    if (r.backend && t.layer === 'both' && r.jobs?.backend && ['committed', 'review'].includes(r.jobs.backend.status) && !r.jobs?.frontend) setSide('frontend');
  }).catch((e) => toast(e.message, 'err')).finally(() => setLoading(false)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // With two repositories, default to the agent made for that side (unless an agent was chosen for you).
  useEffect(() => { if (backend && initialAgent === 'build' && agents.some((a: Any) => a.id === side && a.enabled)) setAgentId(side); }, [side, backend, agents.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Follow the job while it runs.
  useEffect(() => {
    if (!job || !['starting', 'running'].includes(job.status)) return;
    const h = setTimeout(async () => {
      try { const r = await api(`${base}?jobId=${job.id}&since=${job.logSize || 0}`); setJob((j: Any) => ({ ...r, log: [...(j?.log || []), ...r.log] })); } catch { /* keep polling */ }
    }, 1500);
    return () => clearTimeout(h);
  }, [job, side]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { logRef.current?.scrollTo({ top: 1e9 }); }, [job?.log?.length]);
  const act = async (kind: string, body: Any) => {
    setBusy(kind);
    try { const r = await api(base, { method: 'POST', body: { ...body, jobId: job?.id } }); if (r?.id) setJob((j: Any) => ({ ...r, log: kind === 'start' ? r.log : [...(j?.log || []), ...r.log.slice(j?.logSize ?? 0)] })); return r; }
    catch (e: Any) { toast(e.message, 'err'); return null; } finally { setBusy(''); }
  };
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
    mutate(() => { t.prs.push({ id: uid(), ...r.pr, checkedAt: nowIso() }); logEvent(t, `opened pull request ${r.pr.repo} #${r.pr.number} with code written by AI`, 'Development'); });
    toast(`Opened ${r.pr.repo} #${r.pr.number}`);
  };
  const running = job && ['starting', 'running'].includes(job.status);
  const d = dev();
  return (
    <Modal title={`Write code · ${t.key}`} wide persistent={running} actions={[{ label: running ? 'Close (keeps running)' : 'Close' }]}>
      {backend && !loading && <div className="side-tabs" role="tablist" aria-label="Repository">
        {(['backend', 'frontend'] as const).map((k) => { const jj = jobs[k]; const busyK = jj && ['starting', 'running'].includes(jj.status); return (
          <button key={k} role="tab" aria-selected={side === k} className={side === k ? 'on' : ''} onClick={() => setSide(k)}>
            <span className={`layer-chip l-${k}`}>{k === 'backend' ? 'Backend' : 'Frontend'}</span>
            <span className="muted small">{k === 'backend' ? (be().repo || be().localPath) : (d.repo || d.localPath)}</span>
            <span className="side-state small">{busyK ? <><Spinner /> working</> : jj && jj.status !== 'discarded' ? STATUS[jj.status] || jj.status : 'Not started'}</span>
          </button>); })}
        <span className="side-hint small muted">{t.layer ? <>This issue is marked <b>{LAYER_LABEL[t.layer]}</b>.{t.layer === 'both' ? ' Do the backend first: the frontend job gets its API summary.' : ''}</> : 'Mark the issue frontend, backend or both in its details.'}</span>
      </div>}
      {loading ? <div className="muted"><Spinner /> Loading…</div> : !job || ['discarded'].includes(job.status) ? <>
        {agents.length > 0 && <>
          <div className="pick-label small">Which agent?</div>
          <div className="agent-pick" role="radiogroup" aria-label="Agent">{agents.filter((a: Any) => !['review', 'review-panel'].includes(a.id)).map((a: Any) => (
            <button key={a.id} role="radio" aria-checked={agentId === a.id} className={`${agentId === a.id ? 'on' : ''} ph-${String(a.phase).toLowerCase()}`} disabled={!a.enabled} onClick={() => setAgentId(a.id)} title={a.does.join(' ')}>
              <span className="agent-icon sm" aria-hidden>{a.icon}</span>
              <span className="ap-text"><b>{a.name}</b><span className="muted small">{a.summary}{!a.enabled ? ' (turned off)' : ''}</span>
                <span className="ap-meta">{a.workspaceLabel} · {a.model}{a.effort ? ` · ${a.effort}` : ''}</span></span></button>))}</div>
          {(() => { const a = agents.find((x: Any) => x.id === agentId); return a ? <ul className="ap-does small">{a.does.map((x: string) => <li key={x}>{x}</li>)}</ul> : null; })()}
        </>}
        <p className="muted small" style={{ marginTop: 0 }}>It runs as a Claude Code agent on <b>{t.title}</b> from its story, {t.acceptanceCriteria?.length || 0} acceptance criteria and {t.testCases?.length || 0} test cases, in a new branch <code>{(d.branchPrefix ?? 'tf/')}{String(t.key).toLowerCase()}-…</code> from <code>{d.baseBranch || 'the default branch'}</code> of <b>{d.repo || d.localPath}</b>, in its own worktree. Nothing is pushed until you review the changes and open the pull request.</p>
        <label className="field"><span>Extra instructions (optional)</span><TA rows={4} value={text} placeholder="e.g. Put the API in app/api/payslips. Reuse the PayslipTable component. Add a Vitest test." onChange={(e) => setText(e.target.value)} /></label>
        {backend && side === 'frontend' && t.layer === 'both' && !['committed', 'review'].includes(jobs.backend?.status) && <div className="warn-banner" style={{ marginBottom: 8 }}><Ico svg={I.warn} /><span>The backend part isn’t done yet. You can start the frontend now, but it won’t know the final API.</span>
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setSide('backend')}>Go to Backend</button></div>}
        {backend && side === 'backend' && <p className="small muted" style={{ marginTop: 0 }}>Runs in <code>{be().localPath}</code>{be().repo ? <> · {be().provider === 'GitLab' ? 'merge request on GitLab' : 'pull request on GitHub'} <code>{be().repo}</code></> : ''}.</p>}
        <button className="btn ai" disabled={!!busy} onClick={() => act('start', { action: 'start', ticketId: t.id, instructions: text, agentId, side })}>{busy ? <><Spinner />Starting…</> : <><Ico svg={I.sparkle} />{agentId === 'architecture-record' ? 'Write the record' : agentId === 'feature-tests' ? 'Write the tests' : 'Start the agent'}</>}</button>
      </> : <>
        <div className="code-head">
          <span className={`code-status s-${job.status}`}>{running && <Spinner />}{STATUS[job.status] || job.status}</span>
          {job.agentName && <span className="label-chip">{job.agentName}</span>}<code>{job.branch}</code><span className="muted small">→ {job.base} · {job.repo || 'local'}{job.rounds > 1 ? ` · round ${job.rounds}` : ''} · started {ago(job.startedAt)}{job.costUsd ? ` · $${job.costUsd.toFixed(2)}` : ''}</span>
          <span className="spacer" />
          {running && <button className="btn sm" onClick={() => act('cancel', { action: 'cancel' })}>Stop</button>}
          {!running && job.status !== 'pr' && <button className="btn sm subtle" onClick={() => openModal(<Confirm title="Discard these changes?" label="Discard" text={`The worktree and the local branch ${job.branch} are removed. Nothing was pushed.`} onYes={async () => { await act('discard', { action: 'discard' }); setJob(null); openModal(<CodeModal t={t} />); }} />)}>Discard</button>}
        </div>
        <div className="code-log" ref={logRef}>{job.log.map((l: Any, i: number) => <div key={i} className={`cl k-${l.kind}`}>{l.text}</div>)}</div>
        {job.todos?.length > 0 && <details className="code-summary" open={running}><summary className="small"><b>Plan</b> · {job.todos.filter((x: Any) => x.status === 'completed').length}/{job.todos.length} done</summary>
          <ul className="code-todos small">{job.todos.map((x: Any, i: number) => <li key={i} className={x.status}>{x.status === 'in_progress' ? '▶ ' : ''}{x.content}</li>)}</ul></details>}
        {job.error && <div className="warn-banner danger"><Ico svg={I.warn} /><span>{job.error}</span></div>}
        {job.summary && !running && <details className="code-summary" open><summary className="small"><b>{job.status === 'report' ? `${job.agentName}’s report` : 'Agent’s summary'}</b></summary><div className="small code-md"><Markdown text={job.summary} /></div>
          {job.status === 'report' && can('export') && <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn sm" onClick={async () => { try { toast(`Downloaded ${await downloadFrom(`/api/projects/${P().id}/code`, { body: { action: 'docx', jobId: job.id }, fallbackName: `${job.agentName} - ${job.ticketKey}.docx` })}`); } catch (e: Any) { toast(`Couldn’t download the report: ${e.message}`, 'err'); } }}><Ico svg={I.download} />Download .docx</button>
            <button className="btn sm ghost" onClick={() => saveBlob(new Blob([job.summary], { type: 'text/markdown' }), `${job.agentName} - ${job.ticketKey}.md`)}>Download .md</button>
          </div>}</details>}
        {job.files?.length > 0 && <div className="code-files">
          <div className="small muted">{job.files.length} file{job.files.length === 1 ? '' : 's'} changed · <span className="da">+{job.files.reduce((n: number, f: Any) => n + f.added, 0)}</span> <span className="dr">−{job.files.reduce((n: number, f: Any) => n + f.removed, 0)}</span></div>
          {job.files.map((f: Any) => <div key={f.path}>
            <button className="code-file" onClick={() => setOpen(open === f.path ? null : f.path)}><Ico svg={I.chevron} className={open === f.path ? '' : 'closed'} /><code>{f.path}</code><span className="spacer" /><span className="da">+{f.added}</span> <span className="dr">−{f.removed}</span></button>
            {open === f.path && job.status !== 'pr' && <DiffView jobId={job.id} file={f.path} />}
          </div>)}
        </div>}
        {job.reviews?.length > 0 && (() => { const rv = job.reviews[job.reviews.length - 1]; const lens = rv.lenses?.[Math.min(reviewTab, rv.lenses.length - 1)]; return <details className="code-summary" open={!running}><summary className="small"><b>{rv.panel ? 'Review Panel' : rv.agent || 'Review agent'}’s findings</b> · round {rv.round}</summary>
          {rv.panel && <div className="review-tabs" role="tablist">{rv.lenses.map((l: Any, i: number) => <button key={l.id} role="tab" aria-selected={reviewTab === i} className={reviewTab === i ? 'on' : ''} onClick={() => setReviewTab(i)}>{l.name}</button>)}</div>}
          <div className="small code-md"><Markdown text={rv.panel ? lens?.text || '' : rv.text} /></div>
          {job.status === 'review' && <button className="btn sm ai" disabled={!!busy} onClick={() => act('follow', { action: 'follow', text: `Fix these review findings (skip any you disagree with and say why):\n\n${job.reviews[job.reviews.length - 1].text}` })}><Ico svg={I.sparkle} />Fix the findings</button>}</details>; })()}
        {job.status === 'review' && !job.pr && <div className="review-actions">
          <button className="agent-btn hire sm" disabled={!!busy || agents.find((a: Any) => a.id === 'review')?.enabled === false} onClick={() => act('review', { action: 'review' })}>🔍 {job.reviews?.length ? 'Review again' : 'Review changes'}</button>
          <button className="agent-btn hire sm" disabled={!!busy || agents.find((a: Any) => a.id === 'review-panel')?.enabled === false} onClick={() => { setReviewTab(0); act('review', { action: 'review', panel: true }); }} title="Three Review agents in parallel: correctness, security, tests & acceptance">🤝 Review panel</button>
          <button className="agent-btn hire sm" disabled={!!busy || agents.find((a: Any) => a.id === 'ui-review')?.enabled === false} onClick={() => act('review', { action: 'review', agent: 'ui-review' })} title="Usability, accessibility, states, copy and responsive layout">🧐 UI/UX review</button>
          <span className="muted small">Read-only Claude Code reviewers. They never edit files.</span></div>}
        {['review', 'report', 'empty', 'failed', 'cancelled'].includes(job.status) && <div className="code-follow">
          <TA rows={2} value={follow} placeholder="Ask for changes: e.g. also handle the empty state, and rename the hook to usePayslips" onChange={(e) => setFollow(e.target.value)} />
          <button className="btn ai" disabled={!follow.trim() || !!busy} onClick={async () => { if (await act('follow', { action: 'follow', text: follow })) setFollow(''); }}><Ico svg={I.sparkle} />Make changes</button>
        </div>}
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
            <button className="btn subtle" disabled={!!busy || !title.trim()} onClick={commitLocal} title="Commit on the local branch without pushing">{busy === 'commit' ? <Spinner /> : 'Commit locally only'}</button>
            <button className="btn primary" disabled={!!busy || !title.trim()} onClick={openPr}>{busy === 'pr' ? <><Spinner />Opening…</> : <><Ico svg={I.pr} />Commit, push and open {job.provider === 'GitLab' ? 'MR' : 'PR'}</>}</button>
          </div>
        </div>}
        {job.pr && <div className="ok-banner"><Ico svg={I.check} /><span>{job.provider === 'GitLab' ? 'Merge request' : 'Pull request'} <a href={job.pr.url} target="_blank" rel="noopener noreferrer">{job.provider === 'GitLab' ? '!' : '#'}{job.pr.number} {job.pr.title}</a> {job.target ? 'is updated with these changes.' : `is open${job.pr.draft ? ' as a draft' : ''} and linked to this issue.`}</span></div>}
      </>}
    </Modal>
  );
}
export const openCode = (t: Any, side?: string) => openModal(<CodeModal t={t} initialSide={side} />);

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
void S; void closeModal; void emit;

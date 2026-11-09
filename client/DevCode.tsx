'use client';
// Code & GitHub: a project's local repository and GitHub settings, and the "Write code with AI" job for an issue:
// Claude Code implements it in its own git worktree, you review the diff, TicketForge opens the pull request.
import { useEffect, useRef, useState } from 'react';
import { S, P, api, can, mutate, toast, openModal, closeModal, uid, nowIso, logEvent, ago, emit, type Any } from './core';
import { Ico, I, Modal, Spinner, Confirm, SetCard } from './ui';
import { TF, TA, SF, CB, MenuItem } from './fields';
import { Markdown } from './GuideCard';

const dev = () => P().dev || {};
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

/** Whether "Write code with AI" can be offered for issues in this project. */
export const codeReady = () => Boolean(dev().localPath);

const STATUS: Record<string, string> = { report: 'Report ready', starting: 'Starting…', running: 'Claude Code is working…', review: 'Ready for review', empty: 'No changes', failed: 'Failed', cancelled: 'Stopped', pr: 'Pull request open', discarded: 'Discarded' };

function DiffView({ jobId, file }: { jobId: string; file: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { api(`/api/projects/${P().id}/code?jobId=${jobId}&diff=1&file=${encodeURIComponent(file)}`, { raw: true }).then((r: Any) => r.text()).then(setText).catch((e: Any) => setText(`Couldn’t load the diff: ${e.message}`)); }, [jobId, file]);
  if (text === null) return <div className="muted small" style={{ padding: 8 }}><Spinner /> Loading…</div>;
  return <pre className="diff">{text.split('\n').filter((l) => !/^(diff --git|index |new file mode|deleted file mode)/.test(l)).map((l, i) =>
    <span key={i} className={l.startsWith('+++') || l.startsWith('---') ? 'dh' : l.startsWith('@@') ? 'dc' : l.startsWith('+') ? 'da' : l.startsWith('-') ? 'dr' : ''}>{l || ' '}{'\n'}</span>)}</pre>;
}

/** Issue panel → Write code with AI: start, watch, review, ask for changes, open the pull request. */
export function CodeModal({ t }: { t: Any }) {
  const [job, setJob] = useState<Any>(null);
  const [agents, setAgents] = useState<Any[]>([]);
  const [agentId, setAgentId] = useState('build');
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [follow, setFollow] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [title, setTitle] = useState(`${t.key}: ${t.title}`);
  const [draft, setDraft] = useState(dev().draft !== false);
  const logRef = useRef<HTMLDivElement>(null);
  const base = `/api/projects/${P().id}/code`;
  useEffect(() => { api(`${base}?ticketId=${t.id}`).then((r) => { setJob(r.job); setAgents(r.agents || []); }).catch((e) => toast(e.message, 'err')).finally(() => setLoading(false)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Follow the job while it runs.
  useEffect(() => {
    if (!job || !['starting', 'running'].includes(job.status)) return;
    const h = setTimeout(async () => {
      try { const r = await api(`${base}?jobId=${job.id}&since=${job.logSize || 0}`); setJob((j: Any) => ({ ...r, log: [...(j?.log || []), ...r.log] })); } catch { /* keep polling */ }
    }, 1500);
    return () => clearTimeout(h);
  }, [job]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { logRef.current?.scrollTo({ top: 1e9 }); }, [job?.log?.length]);
  const act = async (kind: string, body: Any) => {
    setBusy(kind);
    try { const r = await api(base, { method: 'POST', body: { ...body, jobId: job?.id } }); if (r?.id) setJob((j: Any) => ({ ...r, log: kind === 'start' ? r.log : [...(j?.log || []), ...r.log.slice(j?.logSize ?? 0)] })); return r; }
    catch (e: Any) { toast(e.message, 'err'); return null; } finally { setBusy(''); }
  };
  const openPr = async () => {
    const r = await act('pr', { action: 'pr', title, draft });
    if (!r?.pr) return;
    setJob(r.job);
    mutate(() => { t.prs.push({ id: uid(), ...r.pr, checkedAt: nowIso() }); logEvent(t, `opened pull request ${r.pr.repo} #${r.pr.number} with code written by AI`, 'Development'); });
    toast(`Opened ${r.pr.repo} #${r.pr.number}`);
  };
  const running = job && ['starting', 'running'].includes(job.status);
  const d = dev();
  return (
    <Modal title={`Write code · ${t.key}`} wide persistent={running} actions={[{ label: running ? 'Close (keeps running)' : 'Close' }]}>
      {loading ? <div className="muted"><Spinner /> Loading…</div> : !job || ['discarded'].includes(job.status) ? <>
        {agents.length > 0 && <div className="agent-pick" role="radiogroup" aria-label="Agent">{agents.map((a: Any) => (
          <button key={a.id} role="radio" aria-checked={agentId === a.id} className={agentId === a.id ? 'on' : ''} disabled={!a.enabled} onClick={() => setAgentId(a.id)} title={a.does.join(' ')}>
            <b>{a.icon} {a.name}</b><div className="muted small">{a.summary}{!a.enabled ? ' (turned off)' : ''}</div></button>))}</div>}
        <p className="muted small" style={{ marginTop: 0 }}>The <b>{agents.find((a: Any) => a.id === agentId)?.name || 'Build'}</b> agent runs as a Claude Code agent on <b>{t.title}</b> from its story, {t.acceptanceCriteria?.length || 0} acceptance criteria and {t.testCases?.length || 0} test cases, in a new branch <code>{(d.branchPrefix ?? 'tf/')}{String(t.key).toLowerCase()}-…</code> from <code>{d.baseBranch || 'the default branch'}</code> of <b>{d.repo || d.localPath}</b>, in its own worktree. Nothing is pushed until you review the changes and open the pull request.</p>
        <label className="field"><span>Extra instructions (optional)</span><TA rows={4} value={text} placeholder="e.g. Put the API in app/api/payslips. Reuse the PayslipTable component. Add a Vitest test." onChange={(e) => setText(e.target.value)} /></label>
        <button className="btn ai" disabled={!!busy} onClick={() => act('start', { action: 'start', ticketId: t.id, instructions: text, agentId })}>{busy ? <><Spinner />Starting…</> : <><Ico svg={I.sparkle} />{agentId === 'architecture-record' ? 'Write the record' : agentId === 'feature-tests' ? 'Write the tests' : 'Start the agent'}</>}</button>
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
        {job.summary && !running && <details className="code-summary" open><summary className="small"><b>{job.status === 'report' ? `${job.agentName}’s report` : 'Agent’s summary'}</b></summary><div className="small code-md"><Markdown text={job.summary} /></div></details>}
        {job.files?.length > 0 && <div className="code-files">
          <div className="small muted">{job.files.length} file{job.files.length === 1 ? '' : 's'} changed · <span className="da">+{job.files.reduce((n: number, f: Any) => n + f.added, 0)}</span> <span className="dr">−{job.files.reduce((n: number, f: Any) => n + f.removed, 0)}</span></div>
          {job.files.map((f: Any) => <div key={f.path}>
            <button className="code-file" onClick={() => setOpen(open === f.path ? null : f.path)}><Ico svg={I.chevron} className={open === f.path ? '' : 'closed'} /><code>{f.path}</code><span className="spacer" /><span className="da">+{f.added}</span> <span className="dr">−{f.removed}</span></button>
            {open === f.path && job.status !== 'pr' && <DiffView jobId={job.id} file={f.path} />}
          </div>)}
        </div>}
        {job.reviews?.length > 0 && <details className="code-summary" open={!running}><summary className="small"><b>Review agent’s findings</b> · round {job.reviews[job.reviews.length - 1].round}</summary>
          <div className="small code-md"><Markdown text={job.reviews[job.reviews.length - 1].text} /></div>
          {job.status === 'review' && <button className="btn sm ai" disabled={!!busy} onClick={() => act('follow', { action: 'follow', text: `Fix these review findings (skip any you disagree with and say why):\n\n${job.reviews[job.reviews.length - 1].text}` })}><Ico svg={I.sparkle} />Fix the findings</button>}</details>}
        {job.status === 'review' && !job.pr && <div style={{ margin: '8px 0' }}><button className="btn sm" disabled={!!busy} onClick={() => act('review', { action: 'review' })}><Ico svg={I.search} />{job.reviews?.length ? 'Review again' : 'Review changes with the Review agent'}</button></div>}
        {['review', 'report', 'empty', 'failed', 'cancelled'].includes(job.status) && <div className="code-follow">
          <TA rows={2} value={follow} placeholder="Ask for changes: e.g. also handle the empty state, and rename the hook to usePayslips" onChange={(e) => setFollow(e.target.value)} />
          <button className="btn ai" disabled={!follow.trim() || !!busy} onClick={async () => { if (await act('follow', { action: 'follow', text: follow })) setFollow(''); }}><Ico svg={I.sparkle} />Make changes</button>
        </div>}
        {job.status === 'review' && can('issue.edit') && <div className="code-pr">
          <label className="field" style={{ flex: 1, margin: 0 }}><span>Pull request title</span><TF value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <CB label="Draft" checked={draft} onChange={(e: Any) => setDraft(e.target.checked)} />
          <button className="btn primary" disabled={!!busy || !title.trim()} onClick={openPr}>{busy === 'pr' ? <><Spinner />Opening…</> : <><Ico svg={I.pr} />Commit, push and open PR</>}</button>
        </div>}
        {job.pr && <div className="ok-banner"><Ico svg={I.check} /><span>Pull request <a href={job.pr.url} target="_blank" rel="noopener noreferrer">#{job.pr.number} {job.pr.title}</a> is open{job.pr.draft ? ' as a draft' : ''} and linked to this issue.</span></div>}
      </>}
    </Modal>
  );
}
export const openCode = (t: Any) => openModal(<CodeModal t={t} />);
void S; void closeModal; void emit;

'use client';
// The TicketForge agents in the app: the catalog (from /api/agents), the agent card, and "Hire": what happens when
// you put an agent to work on an epic. Generators open the writers that already exist (Problem Statement, Feature
// Brief, test cases, new issues, test runs); document agents write their document and save it on the epic; code
// agents open "Write code with AI" on one of the epic's issues with that agent picked.
import { useEffect, useState } from 'react';
import { S, P, api, can, mutate, toast, openModal, closeModal, readNdjson, aiBody, ago, me, emit, ticket, type Any } from './core';
import { Ico, I, Modal, Spinner, Confirm } from './ui';
import { TA } from './fields';
import { Markdown } from './GuideCard';
import { openWritePsd, openPsd } from './Psd';
import { openWriteFbd, openFbd } from './Fbd';
import { bulkTests, runTests, NewWithClaudeModal } from './actions';
import { CodeModal, codeReady } from './DevCode';

// ---------------------------------------------------------------- catalog
let cache: Any = null;
let loading: Promise<Any> | null = null;
export function loadAgents(fresh = false): Promise<Any> {
  if (cache && !fresh) return Promise.resolve(cache);
  loading ??= api('/api/agents').then((d) => { cache = d; return d; }).finally(() => { loading = null; });
  return loading;
}
export function useAgents() {
  const [d, setD] = useState<Any>(cache);
  useEffect(() => { let on = true; loadAgents().then((x) => on && setD(x)).catch(() => on && setD({ agents: [], phases: [] })); return () => { on = false; }; }, []);
  return d;
}
export const setAgentsCache = (d: Any) => { cache = d; };

export const phaseClass = (phase: string) => `ph-${String(phase || 'general').toLowerCase()}`;

/** One agent as a card, as in Administration → Agents. */
export function AgentCard({ a, onDetails, onHire, hireLabel = 'Hire' }: { a: Any; onDetails?: () => void; onHire?: () => void; hireLabel?: string }) {
  return (
    <article className={`agent-card ${phaseClass(a.phase)} ${a.enabled ? '' : 'off'}`}>
      <header className="agent-head">
        <span className="agent-icon" aria-hidden>{a.icon}</span>
        <div className="agent-title"><h4>{a.name}</h4><span>{a.phase}{a.enabled ? '' : ' · Off'}</span></div>
      </header>
      <p className="agent-sum">{a.summary}</p>
      <div className="agent-chips">
        <span className="agent-chip">{a.workspaceLabel}</span>
        {a.step && <span className="agent-chip step">{a.step}</span>}
      </div>
      <footer className="agent-foot">
        {onDetails && <button className="agent-btn ghost" onClick={onDetails}>Details</button>}
        {onHire && <button className="agent-btn hire" disabled={!a.enabled} onClick={onHire} title={a.enabled ? `Put ${a.name} to work` : 'Turned off in Administration → Agents'}><Ico svg={I.bot} />{hireLabel}</button>}
      </footer>
    </article>
  );
}

// ---------------------------------------------------------------- document agents
const busy = new Set<string>();
const busyKey = (epicId: string, agentId: string) => `${epicId}:${agentId}`;
export const agentBusy = (epicId: string, agentId: string) => busy.has(busyKey(epicId, agentId));

async function runDoc(epic: Any, a: Any, instructions: string) {
  const k = busyKey(epic.id, a.id);
  if (busy.has(k)) return;
  busy.add(k); emit();
  try {
    const res = await api(`/api/projects/${P().id}/agent`, { method: 'POST', raw: true, body: aiBody({ epicId: epic.id, agentId: a.id, instructions }) });
    let md = '';
    await readNdjson(res, (ev) => { if (ev.type === 'done') md = ev.markdown; else if (ev.type === 'error') throw new Error(ev.error); });
    if (!md) throw new Error(`${a.name} didn’t return a document.`);
    mutate(() => { epic.agentDocs = { ...(epic.agentDocs || {}), [a.id]: { name: a.name, markdown: md, generatedAt: new Date().toISOString(), generatedBy: me() } }; });
    toast(`${a.name} is ready: ${epic.title}`);
  } catch (e: Any) { toast(`${a.name}: ${e.message}`, 'err'); }
  finally { busy.delete(k); emit(); }
}

function DocHireModal({ epic, a }: { epic: Any; a: Any }) {
  const [text, setText] = useState('');
  const had = epic.agentDocs?.[a.id];
  return (
    <Modal title={`Hire ${a.name}`} actions={[{ label: 'Cancel' }, { label: had ? 'Write it again' : 'Write it', kind: 'ai', onClick: () => { closeModal(); runDoc(epic, a, text); } }]}>
      <div className="hire-intro"><span className="agent-icon" aria-hidden>{a.icon}</span><div><b>{a.summary}</b><ul className="small muted">{a.does.map((d: string) => <li key={d}>{d}</li>)}</ul></div></div>
      <p className="muted small">It reads <b>{epic.title}</b>: the epic, its Problem Statement and Feature Brief, {P().tickets.filter((t: Any) => t.epicId === epic.id).length} issues with their status and test results, and the documents other agents wrote. What it can’t know becomes <i>[To confirm: …]</i>.{had ? ' The current document is replaced (you can undo).' : ''}</p>
      <label className="field"><span>Extra instructions (optional)</span><TA rows={3} value={text} placeholder="e.g. The demo is for the finance director; keep it to 10 minutes." onChange={(e) => setText(e.target.value)} /></label>
    </Modal>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const el = document.createElement('a'); el.href = url; el.download = name; el.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function DocViewModal({ epic, a }: { epic: Any; a: Any }) {
  const d = epic.agentDocs?.[a.id];
  if (!d) return null;
  const file = `${a.name} - ${epic.title}.md`.replace(/[\\/:*?"<>|]+/g, ' ');
  return (
    <Modal title={`${a.name} · ${epic.title}`} wide actions={[{ label: 'Close' }, { label: 'Download .md', kind: 'primary', onClick: () => download(file, d.markdown) }]}>
      <p className="muted small" style={{ marginTop: 0 }}>Written by the {a.name} agent {ago(d.generatedAt)}{d.generatedBy ? ` for ${d.generatedBy}` : ''}.</p>
      <div className="agent-doc"><Markdown text={d.markdown} /></div>
    </Modal>
  );
}

// ---------------------------------------------------------------- code agents
function PickIssueModal({ epic, a }: { epic: Any; a: Any }) {
  const issues = P().tickets.filter((t: Any) => t.epicId === epic.id);
  return (
    <Modal title={`Hire ${a.name} for an issue`} actions={[{ label: 'Cancel' }]}>
      <p className="muted small" style={{ marginTop: 0 }}>{a.summary} It works on one issue at a time, in its own branch and git worktree. Pick the issue:</p>
      {!codeReady() && <div className="warn-banner"><Ico svg={I.warn} /><span>Set the local repository in Project settings → Code & GitHub first.</span></div>}
      <div className="pick-list">{issues.map((t: Any) => (
        <button key={t.id} className="pick-row" disabled={!codeReady()} onClick={() => openModal(<CodeModal t={t} agentId={a.id === 'review-panel' ? 'build' : a.id} />)}>
          <code>{t.key}</code><span className="pick-title">{t.title}</span><span className="muted small">{t.status}</span></button>))}
        {!issues.length && <p className="muted small">This epic has no issues yet.</p>}</div>
      {a.id === 'review-panel' && <p className="muted small">The Review Panel reviews a code job’s changes: start Build a Ticket on the issue, then choose <b>Review panel</b> when the diff is ready.</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------- hire
/** What "Hire" does for each agent, on one epic. */
export function hireAgent(a: Any, epic: Any) {
  if (!a.enabled) return toast(`${a.name} is turned off in Administration → Agents.`, 'err');
  const issues = P().tickets.filter((t: Any) => t.epicId === epic.id);
  if (a.runner === 'code' || a.runner === 'panel') return openModal(<PickIssueModal epic={epic} a={a} />);
  if (a.runner === 'document') return openModal(<DocHireModal epic={epic} a={a} />);
  switch (a.use) {
    case 'psd': return openWritePsd(epic);
    case 'fbd': return openWriteFbd(epic);
    case 'tickets': return openModal(<NewWithClaudeModal epicId={epic.id} />);
    case 'tests':
      if (!issues.length) return toast('This epic has no issues to write test cases for.', 'err');
      S.checked = new Set(issues.map((t: Any) => t.id)); emit();
      return bulkTests().finally(() => { S.checked.clear(); emit(); });
    case 'verify': {
      const list = issues.flatMap((t: Any) => (t.testCases || []).map((tc: Any) => ({ t, tc })));
      if (!list.length) return toast('Write the test cases first (hire Test Plan).', 'err');
      return runTests(list);
    }
  }
  return toast(`${a.name} can’t be hired here.`, 'err');
}

/** How far an agent's work on this epic is. */
function progress(a: Any, epic: Any): { state: 'done' | 'partial' | 'todo' | 'na'; text: string; view?: () => void } {
  const issues = P().tickets.filter((t: Any) => t.epicId === epic.id);
  const tests = issues.flatMap((t: Any) => t.testCases || []);
  if (a.runner === 'document') { const d = epic.agentDocs?.[a.id]; return d ? { state: 'done', text: `Written ${ago(d.generatedAt)}`, view: () => openModal(<DocViewModal epic={epic} a={a} />) } : { state: 'todo', text: 'Not written yet' }; }
  if (a.runner === 'code' || a.runner === 'panel') { const prs = issues.filter((t: Any) => t.prs?.length).length; return issues.length ? { state: prs === issues.length ? 'done' : prs ? 'partial' : 'todo', text: `${prs} of ${issues.length} issues have a pull request` } : { state: 'na', text: 'No issues yet' }; }
  switch (a.use) {
    case 'psd': return epic.psd ? { state: 'done', text: `${epic.psd.status || 'Draft'} · ${ago(epic.psd.generatedAt)}`, view: () => openPsd(epic) } : { state: 'todo', text: 'Not written yet' };
    case 'fbd': return epic.fbd ? { state: 'done', text: `${epic.fbd.status || 'Draft'} · ${ago(epic.fbd.generatedAt)}`, view: () => openFbd(epic) } : { state: 'todo', text: 'Not written yet' };
    case 'tickets': return issues.length ? { state: 'done', text: `${issues.length} issues` } : { state: 'todo', text: 'No issues yet' };
    case 'tests': { const w = issues.filter((t: Any) => t.testCases?.length).length; return !issues.length ? { state: 'na', text: 'No issues yet' } : { state: w === issues.length ? 'done' : w ? 'partial' : 'todo', text: `${w} of ${issues.length} issues have test cases` }; }
    case 'verify': { const run = tests.filter((tc: Any) => tc.status && tc.status !== 'Not run').length; const pass = tests.filter((tc: Any) => tc.status === 'Passed').length; return !tests.length ? { state: 'na', text: 'No test cases yet' } : { state: pass === tests.length ? 'done' : run ? 'partial' : 'todo', text: `${pass} of ${tests.length} passed · ${tests.length - run} not run` }; }
  }
  return { state: 'na', text: '' };
}

/** Epic panel → Agents: the feature's lifecycle, one row per agent, with Hire. */
export function EpicAgents({ epic }: { epic: Any }) {
  const data = useAgents();
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return <div className="sec"><div className="sec-title"><Ico svg={I.bot} /><h3>Agents</h3></div><div className="muted small"><Spinner /> Loading…</div></div>;
  const list = data.agents.filter((a: Any) => a.enabled && a.id !== 'review' && a.id !== 'free-worker');
  const canHire = can('ai.use') && can('epic.manage');
  const done = list.filter((a: Any) => progress(a, epic).state === 'done').length;
  return (
    <div className="sec epic-agents">
      <div className="sec-title"><Ico svg={I.bot} /><h3>Agents</h3><span className="count">{done}/{list.length}</span>
        <span className="muted small" style={{ marginLeft: 'auto' }}>Hire an agent for each step of this feature</span></div>
      {data.phases.filter((ph: string) => list.some((a: Any) => a.phase === ph)).map((ph: string) => (
        <div key={ph} className={`ea-phase ${phaseClass(ph)}`}>
          <div className="ea-phase-name">{ph}</div>
          {list.filter((a: Any) => a.phase === ph).map((a: Any) => {
            const pg = progress(a, epic);
            const running = agentBusy(epic.id, a.id);
            return (
              <div key={a.id} className={`ea-row s-${pg.state}`}>
                <button className="ea-main" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
                  <span className="agent-icon sm" aria-hidden>{a.icon}</span>
                  <span className="ea-text"><b>{a.name}</b><span className="muted small">{running ? 'Working…' : pg.text}</span></span>
                  <span className={`ea-dot s-${running ? 'run' : pg.state}`} aria-label={pg.state} />
                </button>
                <div className="ea-actions">
                  {pg.view && <button className="btn sm subtle" onClick={pg.view}>View</button>}
                  {canHire && <button className="agent-btn hire sm" disabled={running} onClick={() => hireAgent(a, epic)}>{running ? <Spinner /> : <Ico svg={I.bot} />}{pg.state === 'done' && a.runner !== 'code' ? 'Again' : 'Hire'}</button>}
                </div>
                {open === a.id && <div className="ea-more small"><p style={{ margin: '0 0 4px' }}>{a.summary}</p><ul>{a.does.map((d: string) => <li key={d}>{d}</li>)}</ul>
                  {a.runner === 'document' && epic.agentDocs?.[a.id] && can('epic.manage') && <button className="btn sm subtle" onClick={() => openModal(<Confirm title={`Remove the ${a.name} document?`} label="Remove" text="You can undo with ⌘Z, or hire the agent again." onYes={() => mutate(() => { delete epic.agentDocs[a.id]; })} />)}><Ico svg={I.trash} />Remove document</button>}</div>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
void ticket;

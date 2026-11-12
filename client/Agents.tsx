'use client';
// The TicketForge agents in the app: the catalog (from /api/agents), the agent card, and "Hire": what happens when
// you put an agent to work on an epic. Generators open the writers that already exist (Problem Statement, Feature
// Brief, test cases, new issues, test runs); document agents write their document and save it on the epic; code
// agents open "Write code with AI" on one of the epic's issues with that agent picked.
import { useEffect, useState } from 'react';
import { S, P, api, downloadFrom, saveBlob, can, mutate, toast, openModal, closeModal, readNdjson, aiBody, ago, me, emit, ticket, type Any } from './core';
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
        <div className="agent-title"><h4>{a.name}</h4><span>{a.phase}{a.team ? ` · ${a.team}` : ''}{a.enabled ? '' : ' · Off'}</span></div>
      </header>
      <p className="agent-sum">{a.summary}</p>
      <div className="agent-chips">
        <span className="agent-chip">{a.workspaceLabel}</span>
        {a.step && <span className="agent-chip step">{a.step}</span>}
        {a.custom && <span className="agent-chip step">Custom</span>}
        {a.runner === 'testing' && <span className={`agent-chip ${a.enabled ? 'step' : ''}`}>{a.enabled ? 'On in test runs' : 'Off'}</span>}
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
    toast(`${a.name} is ready: ${epic.title}`, 'ok', { action: { label: 'View', onClick: () => openModal(<DocViewModal epic={epic} a={a} />) } });
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

function download(name: string, text: string) { saveBlob(new Blob([text], { type: 'text/markdown' }), name); }
async function downloadDocx(epic: Any, a: Any) {
  try {
    const name = await downloadFrom(`/api/projects/${P().id}/agent/docx`, { body: { epicId: epic.id, agentId: a.id }, fallbackName: `${a.name} - ${epic.title}.docx` });
    toast(`Downloaded ${name}`);
  } catch (e: Any) { toast(`Couldn’t download the ${a.name} document: ${e.message}`, 'err'); }
}
function DocViewModal({ epic, a }: { epic: Any; a: Any }) {
  const d = epic.agentDocs?.[a.id];
  if (!d) return null;
  const file = `${a.name} - ${epic.title}.md`.replace(/[\\/:*?"<>|]+/g, ' ');
  return (
    <Modal title={`${a.name} · ${epic.title}`} wide actions={[{ label: 'Close' }, { label: 'Download .md', onClick: () => download(file, d.markdown) }, { label: 'Download .docx', kind: 'primary', onClick: () => downloadDocx(epic, a), hidden: !can('export') }]}>
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
    case 'automation': {
      const list = issues.flatMap((t: Any) => (t.testCases || []).map((tc: Any) => ({ t, tc })));
      if (!list.length) return toast('Write the test cases first (hire Test Plan).', 'err');
      return runTests(list, { regenerate: true });
    }
    case 'verify': {
      const list = issues.flatMap((t: Any) => (t.testCases || []).map((tc: Any) => ({ t, tc })));
      if (!list.length) return toast('Write the test cases first (hire Test Plan).', 'err');
      return runTests(list);
    }
  }
  return toast(`${a.name} can’t be hired here.`, 'err');
}

void ticket;

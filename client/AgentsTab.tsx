'use client';
// Administration → Agents: the TicketForge agents, one per job in the feature lifecycle, as cards. Details shows
// what an agent does, its inputs, output, tools and the exact prompt it runs with, and lets an administrator turn it
// off or change its model, effort and extra instructions. Hire picks a project and epic, opens the epic and puts the
// agent to work there.
import { useEffect, useState } from 'react';
import { S, api, toast, openModal, closeModal, ago, type Any } from './core';
import { Ico, I, Modal, Spinner, ErrorState, Loading, Sk } from './ui';
import { TA, SF, CB, MenuItem } from './fields';
import { AgentCard, setAgentsCache, phaseClass } from './Agents';

const RUNNER: Record<string, string> = {
  code: 'Runs as a Claude Code agent in a git worktree',
  panel: 'Runs three Claude Code Review agents in parallel',
  generator: 'Runs TicketForge’s own writer with this agent’s instructions',
  document: 'Writes a Markdown document for the epic with Claude',
};

function AgentDetails({ a, data, onSave, onHire }: { a: Any; data: Any; onSave: (id: string, v: Any) => Promise<void>; onHire: () => void }) {
  const [v, setV] = useState({ enabled: a.enabled, model: a.model || '', effort: a.effort || '', instructions: a.instructions || '' });
  const code = a.runner === 'code' || a.runner === 'panel';
  const dirty = v.enabled !== a.enabled || (code && (v.model !== (a.model || '') || v.effort !== (a.effort || ''))) || v.instructions !== a.instructions;
  return (
    <Modal title={a.name} wide actions={[{ label: 'Close' }, { label: 'Hire', onClick: onHire, disabled: !a.enabled }, { label: 'Save', kind: 'primary', disabled: !dirty, onClick: async () => { await onSave(a.id, v); closeModal(); } }]}>
      <div className={`ad-hero ${phaseClass(a.phase)}`}>
        <span className="agent-icon lg" aria-hidden>{a.icon}</span>
        <div><div className="ad-phase">{a.phase}</div><p className="ad-sum">{a.summary}</p>
          <div className="agent-chips"><span className="agent-chip">{a.workspaceLabel}</span>{a.step && <span className="agent-chip step">{a.step}</span>}</div></div>
      </div>
      <div className="ad-grid">
        <section><h4>What it does</h4><ul>{a.does.map((d: string) => <li key={d}>{d}</li>)}</ul></section>
        <section><h4>Reads</h4><ul>{a.inputs.map((x: string) => <li key={x}>{x}</li>)}</ul>
          <h4>Produces</h4><p>{a.output}</p><h4>Where you hire it</h4><p>{a.where}</p></section>
      </div>
      <p className="ad-runner small"><Ico svg={I.bot} />{RUNNER[a.runner]}</p>
      {a.runner === 'code' && <>
        <h4>Tools Claude Code allows it</h4>
        <div className="ad-tools">{a.tools.map((t: string) => <code key={t}>{t}</code>)}</div>
        <p className="muted small">{a.writes ? 'Edits files only in the issue’s worktree.' : 'Read-only: it never edits files.'} Plus the project’s check command, when one is set. It can never commit, push, switch branches or browse the web.</p>
        <details className="ad-prompt"><summary>Its system prompt</summary><pre>{a.prompt}</pre></details>
      </>}
      {a.runner === 'document' && <details className="ad-prompt"><summary>What it’s told</summary><pre>{a.docPrompt}</pre></details>}
      <h4 className="ad-settings">Settings</h4>
      <CB label="Turned on (people can hire it)" checked={v.enabled} onChange={(e: Any) => setV({ ...v, enabled: e.target.checked })} />
      {code && <div className="grid2">
        <label className="field"><span>Claude model</span><SF value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })}>{data.models.map((m: string) => <MenuItem key={m} value={m}>{m}{m === a.defaults.model ? ' (default)' : ''}</MenuItem>)}</SF>
          <small className="muted">A project’s own model (Project settings → Code & GitHub) wins for jobs in that project.</small></label>
        <label className="field"><span>Effort</span><SF value={v.effort} onChange={(e) => setV({ ...v, effort: e.target.value })}>{data.efforts.map((m: string) => <MenuItem key={m} value={m}>{m}{m === a.defaults.effort ? ' (default)' : ''}</MenuItem>)}</SF></label>
      </div>}
      <label className="field"><span>Extra instructions for this agent</span><TA rows={4} value={v.instructions} placeholder={code ? 'e.g. Always add a Playwright test for UI changes. Never touch the billing module.' : 'e.g. Write for a non-technical audience. Use our release-note headings.'} onChange={(e) => setV({ ...v, instructions: e.target.value })} /></label>
    </Modal>
  );
}

/** Hire from Administration: choose the project and epic, then the epic opens with the agent at work. */
function HireModal({ a }: { a: Any }) {
  const [projects, setProjects] = useState<Any[] | null>(null);
  const [pid, setPid] = useState('');
  const [project, setProject] = useState<Any>(null);
  const [eid, setEid] = useState('');
  useEffect(() => { api('/api/projects').then((l) => { setProjects(l); if (l[0]) setPid(l[0].id); }).catch((e) => toast(e.message, 'err')); }, []);
  useEffect(() => { if (!pid) return; setProject(null); setEid(''); api(`/api/projects/${pid}`).then((p) => { setProject(p); if (p.epics?.[0]) setEid(p.epics[0].id); }).catch((e) => toast(e.message, 'err')); }, [pid]);
  const go = () => { closeModal(); S.nav(`/p/${pid}/backlog?epic=${encodeURIComponent(eid)}&hire=${encodeURIComponent(a.id)}`); };
  return (
    <Modal title={`Hire ${a.name}`} actions={[{ label: 'Cancel' }, { label: 'Hire', kind: 'primary', disabled: !pid || !eid, onClick: go }]}>
      <div className="hire-intro"><span className="agent-icon" aria-hidden>{a.icon}</span><div><b>{a.summary}</b><div className="muted small">{a.where}</div></div></div>
      {!projects ? <div className="muted"><Spinner /> Loading projects…</div> : !projects.length ? <p className="muted">There are no projects yet.</p> : <>
        <label className="field"><span>Project</span><SF value={pid} onChange={(e) => setPid(e.target.value)}>{projects.map((p: Any) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}</SF></label>
        <label className="field"><span>Feature (epic)</span>{!project ? <div className="muted small"><Spinner /> Loading epics…</div>
          : project.epics?.length ? <SF value={eid} onChange={(e) => setEid(e.target.value)}>{project.epics.map((e: Any) => <MenuItem key={e.id} value={e.id}>{e.key ? `${e.key} · ` : ''}{e.title}</MenuItem>)}</SF>
          : <span className="muted small">This project has no epics yet.</span>}</label>
        <p className="muted small" style={{ marginBottom: 0 }}>The epic opens with its <b>Agents</b> section, and {a.runner === 'code' || a.runner === 'panel' ? 'you pick the issue for the agent to work on.' : 'the agent starts there.'}</p>
      </>}
    </Modal>
  );
}

export function AgentsTab() {
  const [data, setData] = useState<Any>(null);
  const [err, setErr] = useState<Any>(null);
  const [phase, setPhase] = useState('All');
  const [team, setTeam] = useState('All');
  const [q, setQ] = useState('');
  const load = async () => { setErr(null); try { const d = await api('/api/admin/agents'); setData(d); setAgentsCache(d); } catch (e: Any) { setErr(e); } };
  useEffect(() => { load(); }, []);
  if (err) return <div className="card"><ErrorState compact title="Couldn’t load the agents" error={err} onRetry={load} /></div>;
  if (!data) return <Loading><div className="agent-grid">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="agent-card"><div className="agent-head"><Sk w={44} h={44} r={12} /><div><Sk w={140} h={14} /><Sk w={60} h={10} style={{ marginTop: 6 }} /></div></div><Sk w="90%" h={10} /><Sk w="60%" h={10} /></div>)}</div></Loading>;

  const save = async (id: string, v: Any) => {
    const agents: Any = {};
    for (const a of data.agents) agents[a.id] = { enabled: a.enabled, model: a.model, effort: a.effort, instructions: a.instructions };
    agents[id] = v;
    try { const d = await api('/api/admin/agents', { method: 'PUT', body: { agents } }); setData(d); setAgentsCache(d); toast('Agent saved'); } catch (e: Any) { toast(e.message, 'err'); }
  };
  const hire = (a: Any) => openModal(<HireModal a={a} />);
  const details = (a: Any) => openModal(<AgentDetails a={a} data={data} onSave={save} onHire={() => hire(a)} />);
  const qq = q.trim().toLowerCase();
  const list = data.agents.filter((a: Any) => (phase === 'All' || a.phase === phase) && (team === 'All' || a.team === team) && (!qq || `${a.name} ${a.summary} ${a.step || ''} ${a.team || ''}`.toLowerCase().includes(qq)));
  const on = data.agents.filter((a: Any) => a.enabled).length;
  return <>
    <div className="agents-top">
      <div>
        <h2>Agents</h2>
        <p className="muted small">{on} of {data.agents.length} on · Code agents run as Claude Code agents in the issue’s own git worktree. {data.updatedAt && <>Changed by {data.updatedBy || 'an administrator'} {ago(data.updatedAt)}.</>}</p>
      </div>
      <input className="agents-search" type="search" placeholder="Search agents" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search agents" />
    </div>
    <div className="agent-filter" role="tablist" aria-label="Phase">{['All', ...data.phases].map((p: string) => {
      const n = p === 'All' ? data.agents.length : data.agents.filter((a: Any) => a.phase === p).length;
      return <button key={p} role="tab" aria-selected={phase === p} className={`${phase === p ? 'on' : ''} ${p === 'All' ? 'ph-all' : phaseClass(p)}`} onClick={() => setPhase(p)}>{p}<span>{n}</span></button>;
    })}</div>
    <div className="agent-filter teams" role="tablist" aria-label="Team">{['All', ...(data.teams || [])].map((tm: string) => {
      const n = tm === 'All' ? data.agents.length : data.agents.filter((a: Any) => a.team === tm).length;
      return <button key={tm} role="tab" aria-selected={team === tm} className={`${team === tm ? 'on' : ''} ph-all`} onClick={() => setTeam(tm)}>{tm === 'All' ? 'All teams' : tm}<span>{n}</span></button>;
    })}</div>
    <div className="agent-grid">
      {list.map((a: Any) => <AgentCard key={a.id} a={a} onDetails={() => details(a)} onHire={() => hire(a)} />)}
      {!list.length && <p className="muted">No agents match.</p>}
    </div>
  </>;
}

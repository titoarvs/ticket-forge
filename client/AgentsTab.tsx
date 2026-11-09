'use client';
// Administration → Agents: the TicketForge agents, one per job in the feature lifecycle. Each card says what the
// agent does; Details shows its inputs, output, tools and the exact prompt Claude Code runs it with, and lets an
// administrator turn it off or change its model, effort and extra instructions.
import { useEffect, useState } from 'react';
import { api, toast, openModal, closeModal, ago, type Any } from './core';
import { Ico, I, Modal, Spinner, ErrorState, Loading, Sk } from './ui';
import { TA, SF, CB, MenuItem } from './fields';

const RUNNER: Record<string, string> = { code: 'Runs as a Claude Code agent', document: 'Document writer', guide: 'Guided step' };

function AgentDetails({ a, data, onSave }: { a: Any; data: Any; onSave: (id: string, v: Any) => Promise<void> }) {
  const [v, setV] = useState({ enabled: a.enabled, model: a.model || '', effort: a.effort || '', instructions: a.instructions || '' });
  const code = a.runner === 'code';
  const dirty = v.enabled !== a.enabled || (code && (v.model !== (a.model || '') || v.effort !== (a.effort || ''))) || v.instructions !== a.instructions;
  return (
    <Modal title={`${a.icon} ${a.name}`} wide actions={[{ label: 'Close' }, { label: 'Save', kind: 'primary', disabled: !dirty, onClick: async () => { await onSave(a.id, v); closeModal(); } }]}>
      <p style={{ marginTop: 0 }}>{a.summary}</p>
      <div className="agent-meta small">
        <span className="label-chip">{a.phase}</span><span className="label-chip">{a.workspaceLabel}</span>
        {a.step && <span className="label-chip agent-step">{a.step}</span>}<span className="muted">{RUNNER[a.runner]}</span>
      </div>
      <h4>What it does</h4>
      <ul className="small">{a.does.map((d: string) => <li key={d}>{d}</li>)}</ul>
      <div className="grid2 small">
        <div><h4>Reads</h4><ul>{a.inputs.map((x: string) => <li key={x}>{x}</li>)}</ul></div>
        <div><h4>Produces</h4><p style={{ margin: 0 }}>{a.output}</p><h4>Where</h4><p style={{ margin: 0 }}>{a.where}</p></div>
      </div>
      {code && <>
        <h4>Tools Claude Code allows it</h4>
        <p className="small" style={{ margin: 0 }}>{a.tools.map((t: string) => <code key={t} style={{ marginRight: 6 }}>{t}</code>)}{a.writes ? '' : <span className="muted"> · read-only: it never edits files</span>}</p>
        <p className="muted small">Plus the project’s check command, when one is set. It can never commit, push, switch branches or browse the web.</p>
        <details><summary className="small"><b>Its system prompt</b></summary><pre className="agent-prompt">{a.prompt}</pre></details>
      </>}
      <h4>Settings</h4>
      <CB label="Turned on" checked={v.enabled} onChange={(e: Any) => setV({ ...v, enabled: e.target.checked })} />
      {code && <div className="grid2">
        <label className="field"><span>Claude model</span><SF value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })}>{data.models.map((m: string) => <MenuItem key={m} value={m}>{m}{m === a.defaults.model ? ' (default)' : ''}</MenuItem>)}</SF>
          <small className="muted">A project’s own model (Project settings → Code & GitHub) wins for the agent it starts.</small></label>
        <label className="field"><span>Effort</span><SF value={v.effort} onChange={(e) => setV({ ...v, effort: e.target.value })}>{data.efforts.map((m: string) => <MenuItem key={m} value={m}>{m}{m === a.defaults.effort ? ' (default)' : ''}</MenuItem>)}</SF></label>
      </div>}
      <label className="field"><span>Extra instructions for this agent</span><TA rows={4} value={v.instructions} placeholder={code ? 'e.g. Always add a Playwright test for UI changes. Never touch the billing module.' : 'Added to what this agent is told.'} onChange={(e) => setV({ ...v, instructions: e.target.value })} /></label>
    </Modal>
  );
}

export function AgentsTab() {
  const [data, setData] = useState<Any>(null);
  const [err, setErr] = useState<Any>(null);
  const [phase, setPhase] = useState('All');
  const load = async () => { setErr(null); try { setData(await api('/api/admin/agents')); } catch (e: Any) { setErr(e); } };
  useEffect(() => { load(); }, []);
  if (err) return <div className="card"><ErrorState compact title="Couldn’t load the agents" error={err} onRetry={load} /></div>;
  if (!data) return <Loading><div className="agent-grid">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="agent-card"><Sk w={160} h={16} /><Sk w="80%" h={10} style={{ marginTop: 12 }} /></div>)}</div></Loading>;

  const save = async (id: string, v: Any) => {
    const agents: Any = {};
    for (const a of data.agents) agents[a.id] = { enabled: a.enabled, model: a.model, effort: a.effort, instructions: a.instructions };
    agents[id] = v;
    try { setData(await api('/api/admin/agents', { method: 'PUT', body: { agents } })); toast('Agent saved'); } catch (e: Any) { toast(e.message, 'err'); }
  };
  const details = (a: Any) => openModal(<AgentDetails a={a} data={data} onSave={save} />);
  const list = data.agents.filter((a: Any) => phase === 'All' || a.phase === phase);
  return <>
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ margin: 0 }}>Agents</h3>
      <p className="sub" style={{ marginBottom: 8 }}>One agent per job in the feature lifecycle. Code agents run as real Claude Code agents in the issue’s own git worktree, with their own prompt and tool list; Build can hand work to Feature Tests and ask Review for a second look. {data.updatedAt && <span className="muted">Last changed by {data.updatedBy || 'an administrator'} {ago(data.updatedAt)}.</span>}</p>
      <div className="agent-filter">{['All', ...data.phases].map((p: string) => <button key={p} className={`btn sm ${phase === p ? 'primary' : 'subtle'}`} onClick={() => setPhase(p)}>{p}</button>)}</div>
    </div>
    <div className="agent-grid">
      {list.map((a: Any) => (
        <div key={a.id} className={`agent-card ${a.enabled ? '' : 'off'}`}>
          <div className="agent-head"><span className="agent-icon" aria-hidden>{a.icon}</span><div><b>{a.name}</b><div className="muted small">{a.phase}{!a.enabled && ' · off'}</div></div></div>
          <p className="agent-sum">{a.summary}</p>
          <div className="agent-meta small"><span className="label-chip">{a.workspaceLabel}</span>{a.step && <span className="label-chip agent-step">{a.step}</span>}</div>
          <div className="agent-foot">
            <button className="btn sm subtle" onClick={() => details(a)}>Details</button>
            {a.runner === 'code' ? <span className="muted small"><Ico svg={I.sparkle} /> Claude Code · {a.model}{a.effort ? ` · ${a.effort}` : ''}</span> : <span className="muted small">{RUNNER[a.runner]}</span>}
          </div>
        </div>
      ))}
    </div>
  </>;
}
void Spinner;

'use client';
import { useState, useEffect } from 'react';
import { type Any, toast, openModal, ago, can } from '../core';
import { getAgents, saveAgents } from '../api/agents';
import { ErrorState, Loading, Sk, Ico, I, EmptyState } from '../ui';
import { TF, SF, MenuItem } from '../fields';
import { setAgentsCache, phaseClass } from '../Agents';
import { HireModal, AgentDetails } from './AgentDetails';
import { CustomAgentModal } from './CustomAgentModal';
import { BuiltInsModal, DefaultAgents, modelOf, Toggle, Card } from './BuiltInsModal';

export function AgentsTab() {
  const [data, setData] = useState<Any>(null);
  const [err, setErr] = useState<Any>(null);
  const [phase, setPhase] = useState('All');
  const [team, setTeam] = useState('');
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<string>(() => {
    try {
      return localStorage.getItem('tf.agents.view') || 'cards';
    } catch {
      return 'cards';
    }
  });
  const [busy, setBusy] = useState('');
  const load = async () => {
    setErr(null);
    try {
      const d = await getAgents();
      setData(d);
      setAgentsCache(d);
    } catch (e: Any) {
      setErr(e);
    }
  };
  useEffect(() => {
    load();
  }, []);
  if (err)
    return (
      <div className="card">
        <ErrorState compact title="Couldn’t load the agents" error={err} onRetry={load} />
      </div>
    );
  if (!data)
    return (
      <Loading>
        <div className="agent-grid">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="agent-card">
              <div className="agent-head">
                <Sk w={44} h={44} r={12} />
                <div>
                  <Sk w={140} h={14} />
                  <Sk w={60} h={10} style={{ marginTop: 6 }} />
                </div>
              </div>
              <Sk w="90%" h={10} />
              <Sk w="60%" h={10} />
            </div>
          ))}
        </div>
      </Loading>
    );

  const save = async (id: string, v: Any, quiet = false) => {
    const agents: Any = {};
    for (const a of data.agents)
      agents[a.id] = {
        enabled: a.enabled,
        model: a.model,
        effort: a.effort,
        instructions: a.instructions,
      };
    agents[id] = v;
    try {
      const d = await saveAgents(agents);
      setData(d);
      setAgentsCache(d);
      if (!quiet) toast('Agent saved');
    } catch (e: Any) {
      toast(e.message, 'err');
    }
  };
  const toggle = async (a: Any, on: boolean) => {
    setBusy(a.id);
    await save(
      a.id,
      { enabled: on, model: a.model, effort: a.effort, instructions: a.instructions },
      true,
    );
    setBusy('');
    toast(`${a.name} turned ${on ? 'on' : 'off'}`);
  };
  const hire = (a: Any) => openModal(<HireModal a={a} />);
  const onData = (d: Any) => {
    setData(d);
    setAgentsCache(d);
  };
  const details = (a: Any) =>
    openModal(
      <AgentDetails a={a} data={data} onSave={save} onHire={() => hire(a)} onData={onData} />,
    );
  const create = () => openModal(<CustomAgentModal onSaved={onData} builtIns={data.builtIns} />);
  const setV = (v: string) => {
    setView(v);
    try {
      localStorage.setItem('tf.agents.view', v);
    } catch {
      /* storage off */
    }
  };
  const qq = q.trim().toLowerCase();
  const all: Any[] = data.agents;
  const list = all.filter(
    (a: Any) =>
      (phase === 'All' || a.phase === phase) &&
      (!team || a.team === team) &&
      (!state ||
        (state === 'on'
          ? a.enabled
          : state === 'off'
            ? !a.enabled
            : state === 'custom'
              ? a.custom
              : a.runner === state)) &&
      (!qq ||
        `${a.name} ${a.summary} ${a.step || ''} ${a.team || ''} ${a.workspaceLabel || ''}`
          .toLowerCase()
          .includes(qq)),
  );
  const teams = (data.teams || []).filter((tm: string) => all.some((a: Any) => a.team === tm));
  const groups: [string, Any[]][] =
    phase === 'All'
      ? data.phases
          .map((p: string) => [p, list.filter((a: Any) => a.phase === p)])
          .filter(([, l]: Any) => l.length)
      : [[phase, list]];
  const stats: [string, number, string][] = [
    ['Agents', all.length, ''],
    ['On', all.filter((a: Any) => a.enabled).length, 'ok'],
    ['Off', all.filter((a: Any) => !a.enabled).length, ''],
    ['Code agents', all.filter((a: Any) => a.runner === 'code' || a.runner === 'panel').length, ''],
    ['Custom', all.filter((a: Any) => a.custom).length, ''],
  ];
  const filtering = Boolean(phase !== 'All' || team || state || qq);
  const hireFor = (a: Any) => (a.runner === 'testing' || a.broken ? undefined : () => hire(a));

  return (
    <div className="ag-page">
      <div className="ag-head">
        <div>
          <h2>Agents</h2>
          <p className="muted small">
            AI teammates for each step of a feature: plan, build, review, test and release. Turn
            them on or off, tune their model and instructions, or create your own.
            {data.updatedAt && (
              <>
                {' '}
                Last changed by {data.updatedBy || 'an administrator'} {ago(data.updatedAt)}.
              </>
            )}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn"
            onClick={() => openModal(<BuiltInsModal data={data} onData={onData} />)}
          >
            Built-in agents{data.removed?.length ? ` (${data.removed.length} removed)` : ''}
          </button>
          {can('ai.use') && (
            <button className="btn primary" onClick={create}>
              <Ico svg={I.plus} />
              Create agent
            </button>
          )}
        </div>
      </div>
      <div className="ag-stats">
        {stats.map(([l, n, tone]) => (
          <div key={l} className={`ag-stat ${tone}`}>
            <b>{n}</b>
            <span>{l}</span>
          </div>
        ))}
      </div>
      <DefaultAgents data={data} onData={onData} />
      {!all.length && (
        <EmptyState
          icon={I.bot}
          tone="neutral"
          title="No agents yet"
          actions={
            can('ai.use') ? (
              <>
                <button
                  className="btn primary"
                  onClick={() =>
                    openModal(
                      <CustomAgentModal onSaved={onData} builtIns={data.builtIns} start="__repo" />,
                    )
                  }
                >
                  🧬 Start with the Repo-native Builder
                </button>
                <button className="btn" onClick={create}>
                  <Ico svg={I.plus} />
                  Create your own
                </button>
              </>
            ) : null
          }
        >
          <p>
            All built-in agents are removed. Create your own: describe what it should do and the AI
            writes its rules, or start from a template. Restore built-in agents any time from{' '}
            <b>Built-in agents</b>.
          </p>
        </EmptyState>
      )}

      {all.length > 0 && (
        <div className="ag-toolbar">
          <div className="ag-phases" role="tablist" aria-label="Phase">
            {['All', ...data.phases].map((p: string) => {
              const n = p === 'All' ? all.length : all.filter((a: Any) => a.phase === p).length;
              return (
                <button
                  key={p}
                  role="tab"
                  aria-selected={phase === p}
                  className={`${phase === p ? 'on' : ''} ${p === 'All' ? 'ph-all' : phaseClass(p)}`}
                  onClick={() => setPhase(p)}
                >
                  {p !== 'All' && <i className="ph-dot" />}
                  {p}
                  <span>{n}</span>
                </button>
              );
            })}
          </div>
          <div className="ag-tools">
            <TF
              search
              sx={{ width: 220 }}
              value={q}
              placeholder="Search agents"
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search agents"
            />
            {teams.length > 1 && (
              <SF filter value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
                <MenuItem value="">All teams</MenuItem>
                {teams.map((tm: string) => (
                  <MenuItem key={tm} value={tm}>
                    {tm}
                  </MenuItem>
                ))}
              </SF>
            )}
            <SF filter value={state} onChange={(e) => setState(e.target.value)} aria-label="Show">
              <MenuItem value="">Any status</MenuItem>
              <MenuItem value="on">Turned on</MenuItem>
              <MenuItem value="off">Turned off</MenuItem>
              <MenuItem value="custom">Custom agents</MenuItem>
              <MenuItem value="code">Code agents</MenuItem>
              <MenuItem value="document">Document agents</MenuItem>
              <MenuItem value="testing">Testing agents</MenuItem>
            </SF>
            {filtering && (
              <button
                className="btn subtle sm"
                onClick={() => {
                  setPhase('All');
                  setTeam('');
                  setState('');
                  setQ('');
                }}
              >
                Clear
              </button>
            )}
            <div className="seg ag-view" role="tablist" aria-label="View">
              <button
                role="tab"
                aria-selected={view === 'cards'}
                className={view === 'cards' ? 'on' : ''}
                onClick={() => setV('cards')}
                title="Cards"
              >
                <Ico svg={I.grid} />
              </button>
              <button
                role="tab"
                aria-selected={view === 'list'}
                className={view === 'list' ? 'on' : ''}
                onClick={() => setV('list')}
                title="List"
              >
                <Ico svg={I.backlog} />
              </button>
            </div>
          </div>
        </div>
      )}

      {!all.length ? null : !list.length ? (
        <EmptyState
          compact
          icon={I.bot}
          tone="neutral"
          title="No agents match"
          actions={
            <button
              className="btn"
              onClick={() => {
                setPhase('All');
                setTeam('');
                setState('');
                setQ('');
              }}
            >
              Show all
            </button>
          }
        />
      ) : view === 'list' ? (
        <div className="table-wrap">
          <table className="tbl ag-tbl">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Phase</th>
                <th>Runs</th>
                <th>Model</th>
                <th>On</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((a: Any) => (
                <tr
                  key={a.id}
                  className={`click ${a.enabled ? '' : 'off'} ${phaseClass(a.phase)}`}
                  onClick={() => details(a)}
                >
                  <td data-label="Agent">
                    <div className="ag-row">
                      <span className="agent-icon sm" aria-hidden>
                        {a.icon}
                      </span>
                      <div>
                        <b>{a.name}</b>
                        {a.custom && <span className="ag-chip tiny">Custom</span>}
                        <div className="muted small ag-row-sum">{a.summary}</div>
                      </div>
                    </div>
                  </td>
                  <td data-label="Phase">
                    <span className="ag-phase">
                      <i className="ph-dot" />
                      {a.phase}
                    </span>
                  </td>
                  <td data-label="Runs" className="muted small">
                    {a.workspaceLabel}
                  </td>
                  <td data-label="Model">
                    {modelOf(a) ? <code>{modelOf(a)}</code> : <span className="muted">—</span>}
                  </td>
                  <td data-label="On" onClick={(e) => e.stopPropagation()}>
                    <Toggle a={a} busy={busy === a.id} onChange={(on) => toggle(a, on)} />
                  </td>
                  <td className="ag-acts" onClick={(e) => e.stopPropagation()}>
                    {hireFor(a) && (
                      <button className="btn sm" disabled={!a.enabled} onClick={hireFor(a)}>
                        Hire
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        groups.map(([p, l]) => (
          <section key={p} className={`ag-group ${phaseClass(p)}`}>
            {phase === 'All' && (
              <h3 className="ag-group-h">
                <i className="ph-dot" />
                {p}
                <span className="count">{l.length}</span>
              </h3>
            )}
            <div className="ag-grid">
              {l.map((a: Any) => (
                <Card
                  key={a.id}
                  a={a}
                  busy={busy === a.id}
                  onDetails={() => details(a)}
                  onHire={hireFor(a)}
                  onToggle={(on) => toggle(a, on)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

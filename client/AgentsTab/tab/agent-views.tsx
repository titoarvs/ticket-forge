'use client';
// The agents that match: as cards grouped by phase, as a list, or on the 2D office floor (or
// "No agents match").
import type { Any } from '../../core';
import { I, EmptyState } from '../../ui';
import { phaseClass } from '../../Agents';
import { modelOf, Toggle, Card } from '../BuiltInsModal';
import { hireFor, openDetails } from './open';
import type { AgentsPage } from './use-agents-tab';
import { OfficeView } from './OfficeView';

const stop = (e: Any) => e.stopPropagation();

function AgentName({ a }: { a: Any }) {
  return (
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
  );
}

function AgentRow({ g, a }: { g: AgentsPage; a: Any }) {
  const onHire = hireFor(a);
  return (
    <tr
      className={`click ${a.enabled ? '' : 'off'} ${phaseClass(a.phase)}`}
      onClick={() => openDetails(g, a)}
    >
      <td data-label="Agent">
        <AgentName a={a} />
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
      <td data-label="On" onClick={stop}>
        <Toggle a={a} busy={g.busy === a.id} onChange={(on) => g.toggle(a, on)} />
      </td>
      <td className="ag-acts" onClick={stop}>
        {onHire && (
          <button className="btn sm" disabled={!a.enabled} onClick={onHire}>
            Hire
          </button>
        )}
      </td>
    </tr>
  );
}

function AgentTable({ g }: { g: AgentsPage }) {
  return (
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
          {g.list.map((a: Any) => (
            <AgentRow key={a.id} g={g} a={a} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One section per phase with agents (headed only when showing all phases). */
function AgentGroups({ g }: { g: AgentsPage }) {
  const { phase } = g.filter;
  const groups: [string, Any[]][] =
    phase === 'All'
      ? g.data.phases
          .map((p: string) => [p, g.list.filter((a: Any) => a.phase === p)])
          .filter(([, l]: Any) => l.length)
      : [[phase, g.list]];
  return (
    <>
      {groups.map(([p, l]) => (
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
                busy={g.busy === a.id}
                onDetails={() => openDetails(g, a)}
                onHire={hireFor(a)}
                onToggle={(on) => g.toggle(a, on)}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export function AgentViews({ g }: { g: AgentsPage }) {
  if (!g.list.length)
    return (
      <EmptyState
        compact
        icon={I.bot}
        tone="neutral"
        title="No agents match"
        actions={
          <button className="btn" onClick={g.clearFilter}>
            Show all
          </button>
        }
      />
    );
  if (g.view === 'office') return <OfficeView g={g} />;
  return g.view === 'list' ? <AgentTable g={g} /> : <AgentGroups g={g} />;
}

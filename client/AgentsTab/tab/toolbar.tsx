'use client';
// Narrowing the agents: by phase (tabs with counts), search, team and status, and switching
// between cards and a list.
import type { Any } from '../../core';
import { Ico, I } from '../../ui';
import { TF, SF, MenuItem } from '../../fields';
import { phaseClass } from '../../Agents';
import type { AgentsPage } from './use-agents-tab';

function PhaseTabs({ g }: { g: AgentsPage }) {
  const { all, filter, setFilter } = g;
  return (
    <div className="ag-phases" role="tablist" aria-label="Phase">
      {['All', ...g.data.phases].map((p: string) => {
        const n = p === 'All' ? all.length : all.filter((a: Any) => a.phase === p).length;
        const on = filter.phase === p;
        return (
          <button
            key={p}
            role="tab"
            aria-selected={on}
            className={`${on ? 'on' : ''} ${p === 'All' ? 'ph-all' : phaseClass(p)}`}
            onClick={() => setFilter({ phase: p })}
          >
            {p !== 'All' && <i className="ph-dot" />}
            {p}
            <span>{n}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Only the teams some agent belongs to; the filter shows when there are at least two. */
function TeamFilter({ g }: { g: AgentsPage }) {
  const teams = (g.data.teams || []).filter((tm: string) => g.all.some((a: Any) => a.team === tm));
  if (teams.length <= 1) return null;
  return (
    <SF
      filter
      value={g.filter.team}
      onChange={(e) => g.setFilter({ team: e.target.value })}
      aria-label="Team"
    >
      <MenuItem value="">All teams</MenuItem>
      {teams.map((tm: string) => (
        <MenuItem key={tm} value={tm}>
          {tm}
        </MenuItem>
      ))}
    </SF>
  );
}

function StatusFilter({ g }: { g: AgentsPage }) {
  return (
    <SF
      filter
      value={g.filter.state}
      onChange={(e) => g.setFilter({ state: e.target.value })}
      aria-label="Show"
    >
      <MenuItem value="">Any status</MenuItem>
      <MenuItem value="on">Turned on</MenuItem>
      <MenuItem value="off">Turned off</MenuItem>
      <MenuItem value="custom">Custom agents</MenuItem>
      <MenuItem value="code">Code agents</MenuItem>
      <MenuItem value="document">Document agents</MenuItem>
      <MenuItem value="testing">Testing agents</MenuItem>
    </SF>
  );
}

function ViewSwitch({ g }: { g: AgentsPage }) {
  const tab = (v: string, title: string, icon: string) => (
    <button
      role="tab"
      aria-selected={g.view === v}
      className={g.view === v ? 'on' : ''}
      onClick={() => g.setView(v)}
      title={title}
    >
      <Ico svg={icon} />
    </button>
  );
  return (
    <div className="seg ag-view" role="tablist" aria-label="View">
      {tab('cards', 'Cards', I.grid)}
      {tab('list', 'List', I.backlog)}
      {tab('office', 'Office', I.office)}
    </div>
  );
}

export function AgentsToolbar({ g }: { g: AgentsPage }) {
  return (
    <div className="ag-toolbar">
      <PhaseTabs g={g} />
      <div className="ag-tools">
        <TF
          search
          sx={{ width: 220 }}
          value={g.filter.q}
          placeholder="Search agents"
          onChange={(e) => g.setFilter({ q: e.target.value })}
          aria-label="Search agents"
        />
        <TeamFilter g={g} />
        <StatusFilter g={g} />
        {g.filtering && (
          <button className="btn subtle sm" onClick={g.clearFilter}>
            Clear
          </button>
        )}
        <ViewSwitch g={g} />
      </div>
    </div>
  );
}

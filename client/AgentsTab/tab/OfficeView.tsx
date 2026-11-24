'use client';
// Administration → Agents → Office: the agents that match the filters as bots on the office
// floor. Agents that are on work at their desk and now and then wander off; agents that are off
// sleep. Movement and desk progress are made up; the agents, their phase and team are real.
import { type Any } from '../../core';
import { Office, type OfficeDesk } from '../../Office/Office';
import { hireFor, openDetails } from './open';
import type { AgentsPage } from './use-agents-tab';

function deskFor(g: AgentsPage, a: Any): OfficeDesk {
  const onHire = hireFor(a);
  const does: string[] = Array.isArray(a.does)
    ? a.does.map((d: Any) => String(d).replace(/`/g, ''))
    : [];
  return {
    id: String(a.id),
    name: String(a.name || a.id),
    icon: a.icon,
    group: String(a.phase || 'General'),
    team: a.team || '',
    tag: a.phase,
    sub: [a.phase, a.team, a.workspaceLabel].filter(Boolean).join(' · '),
    tasks: does.length ? does : [String(a.step || a.summary || 'Waiting for work')],
    mode: a.enabled ? 'work' : 'off',
    offNote: `${a.summary || ''} Turned off: turn it on in Details to put it to work.`.trim(),
    actions: (
      <>
        <button className="of-chip" onClick={() => openDetails(g, a)}>
          Details
        </button>
        {onHire && (
          <button className="of-chip pri" disabled={!a.enabled} onClick={onHire}>
            Hire
          </button>
        )}
      </>
    ),
  };
}

export function OfficeView({ g }: { g: AgentsPage }) {
  const on = g.list.filter((a: Any) => a.enabled).length;
  return (
    <Office
      desks={g.list.map((a: Any) => deskFor(g, a))}
      total={g.list.length}
      title="Agent Office"
      sub={`${on} of ${g.list.length} on`}
      rosterTitle="Agents on the floor"
      screenHint="Open details"
      onScreen={(id) => {
        const a = g.list.find((x: Any) => String(x.id) === id);
        if (a) openDetails(g, a);
      }}
      note="Your agents · movement is illustrative"
      boards={{
        big: 'Agents by phase',
        bigSub: `${g.list.length} agents · ${on} on`,
        small: 'Teams on the floor',
        groups: g.data.phases || [],
      }}
    />
  );
}

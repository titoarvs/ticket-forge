'use client';
// Code jobs → Office: the jobs that match the filters as bots on the office floor, one desk per
// job. Unlike the Agents office this is live: a bot types while its job runs, waits while it's
// queued, rests when it's done and raises a red flag when it failed or was stopped. The status,
// latest step and plan progress are the job's own and change as the page refreshes. Picking a
// job that's coding opens its terminal (the live log); any job's terminal opens from its card or
// by clicking the computer on its desk.
import { useState } from 'react';
import { type Any } from '../core';
import { Office, type OfficeDesk } from '../Office/Office';
import { LABEL, TROUBLE } from './TicketContext';
import { JobActions } from './JobActions';
import { JobTerminal } from './JobTerminal';

const GROUPS = Object.values(LABEL);

function modeOf(j: Any): OfficeDesk['mode'] {
  if (j.status === 'running' || j.status === 'starting') return 'work';
  if (TROUBLE.includes(j.status)) return 'alert';
  return 'idle';
}

type Ctx = { busy: string; stop: (j: Any) => void; term: string; setTerm: (id: string) => void };

function deskFor(j: Any, c: Ctx): OfficeDesk {
  const status = LABEL[j.status] || j.status;
  const step = j.live && j.last ? j.last : j.error || j.title || '';
  return {
    id: String(j.id),
    name: String(j.ticketKey || j.id),
    group: status,
    team: j.projectName || '',
    badge: j.agentName || status,
    tag: j.agentName || undefined,
    sub: [j.projectName, j.agentName, j.where === 'github' ? 'AI API + GitHub' : 'This computer']
      .filter(Boolean)
      .join(' · '),
    tasks: [String(step)],
    taskLabel: j.live ? 'Latest step' : j.error ? 'What went wrong' : 'Issue',
    mode: modeOf(j),
    wander: false,
    live: {
      status: j.todosTotal > 0 ? `${status} · plan ${j.todosDone}/${j.todosTotal}` : status,
      prog: j.todosTotal > 0 ? (j.todosDone / j.todosTotal) * 100 : null,
    },
    actions: (
      <>
        <button
          className={`of-chip ${c.term === j.id ? 'pri' : ''}`}
          aria-pressed={c.term === j.id}
          onClick={() => c.setTerm(c.term === j.id ? '' : j.id)}
        >
          Terminal
        </button>
        <JobActions j={j} busy={c.busy} stop={c.stop} office />
      </>
    ),
  };
}

type Props = { jobs: Any[]; busy: string; stop: (j: Any) => void };

export function JobsOffice({ jobs, busy, stop }: Props) {
  const running = jobs.filter((j) => j.live).length;
  const trouble = jobs.filter((j) => TROUBLE.includes(j.status)).length;
  const [term, setTerm] = useState('');
  const tj = jobs.find((j) => j.id === term);
  const ctx: Ctx = { busy, stop, term, setTerm };
  // Picking a bot that's coding opens its terminal; picking one that isn't leaves the terminal be.
  const onSelect = (id: string | null) => {
    if (id && jobs.find((j) => j.id === id)?.live) setTerm(id);
  };
  return (
    <Office
      desks={jobs.map((j) => deskFor(j, ctx))}
      onSelect={onSelect}
      screenHint="Open terminal"
      onScreen={setTerm}
      activeScreen={tj ? tj.id : null}
      overlay={(c) =>
        tj && (
          <JobTerminal
            key={tj.id}
            j={tj}
            onClose={() => setTerm('')}
            max={c.max}
            onMax={c.toggleMax}
          />
        )
      }
      total={jobs.length}
      title="Code Office"
      sub={`${running} running · ${jobs.length} shown`}
      rosterTitle="Jobs on the floor"
      note="Live code jobs · updates as they run"
      boards={{
        big: 'Code jobs by status',
        bigSub: `${running} running${trouble ? ` · ${trouble} need attention` : ''}`,
        small: 'Jobs by project',
        groups: GROUPS,
      }}
    />
  );
}

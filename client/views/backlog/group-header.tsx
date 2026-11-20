'use client';
// A backlog group's header: its title, dates and counts, and the sprint or epic actions.
import { type Any, can, openModal, fmtDate, spSum, activeSprint } from '../../core';
import { TypeIcon, Ico, I, StatusLoz, Swatch } from '../../ui';
import {
  openDrawer,
  SprintModal,
  CompleteSprintModal,
  deleteSprint,
  createSprint,
} from '../../actions';
import { openDevOrder } from '../../DevPlan';
import { Tally } from '../row-dnd';
import type { Group } from './groups';

function GroupTitle({ g }: { g: Group }) {
  const s = g.sprint;
  if (g.kind === 'status') return <StatusLoz s={g.title} />;
  if (g.epic)
    return (
      <>
        <TypeIcon type="Epic" />
        <Swatch color={g.epic.color} />
        <b>{g.title}</b>
      </>
    );
  if (s)
    return (
      <>
        <b>{s.name}</b>
        {s.state === 'active' && <span className="loz s-inprogress">Active</span>}
      </>
    );
  return <b>{g.title}</b>;
}

/** A sprint's dates, or a link to add them. */
function SprintDates({ s }: { s: Any }) {
  if (s.startDate) return <>{`${fmtDate(s.startDate)} – ${fmtDate(s.endDate)} · `}</>;
  if (!can('sprint.manage')) return null;
  return (
    <>
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          openModal(<SprintModal s={s} mode="edit" />);
        }}
      >
        Add dates
      </a>{' '}
      ·{' '}
    </>
  );
}

/** Start or complete, edit and delete a sprint (only one sprint can be active). */
function SprintManage({ s }: { s: Any }) {
  const act = activeSprint();
  return (
    <>
      {s.state === 'active' ? (
        <button className="btn sm" onClick={() => openModal(<CompleteSprintModal s={s} />)}>
          Complete sprint
        </button>
      ) : (
        <button
          className={`btn sm ${act ? '' : 'primary'}`}
          disabled={Boolean(act)}
          title={act ? 'Complete the active sprint first' : ''}
          onClick={() => openModal(<SprintModal s={s} mode="start" />)}
        >
          Start sprint
        </button>
      )}
      <button
        className="icon-btn"
        title="Edit sprint"
        aria-label="Edit sprint"
        onClick={() => openModal(<SprintModal s={s} mode="edit" />)}
      >
        <Ico svg={I.pencil} />
      </button>
      <button
        className="icon-btn"
        title="Delete sprint"
        aria-label="Delete sprint"
        onClick={() => deleteSprint(s)}
      >
        <Ico svg={I.trash} />
      </button>
    </>
  );
}

function GroupActions({ g }: { g: Group }) {
  const s = g.sprint;
  return (
    <span className="sec-actions">
      <Tally items={g.items} />
      {g.epic && (
        <button className="btn sm subtle" onClick={() => openDrawer('epic', g.epic.id)}>
          Details
        </button>
      )}
      {s && g.items.length > 1 && (
        <button
          className="btn sm subtle"
          title="The order to build this sprint’s issues in, with a reason for each"
          onClick={() => openDevOrder({ sprintId: s.id, title: s.name })}
        >
          Development order
        </button>
      )}
      {s && can('sprint.manage') && <SprintManage s={s} />}
      {g.kind === 'sprint' && !s && can('sprint.manage') && (
        <button className="btn sm" onClick={createSprint}>
          Create sprint
        </button>
      )}
    </span>
  );
}

/** Clicking the header (not one of its buttons or links) folds the group. */
export function GroupHeader({
  g,
  closed,
  onToggle,
}: {
  g: Group;
  closed: boolean;
  onToggle: () => void;
}) {
  const n = g.items.length;
  return (
    <div
      className={`sec-h ${closed ? 'closed' : ''}`}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button, a, select')) onToggle();
      }}
    >
      <Ico svg={I.chevron} />
      <GroupTitle g={g} />
      <span className="meta">
        {g.sprint && <SprintDates s={g.sprint} />}
        {n} issue{n === 1 ? '' : 's'} · {spSum(g.items)} pts
      </span>
      <GroupActions g={g} />
    </div>
  );
}

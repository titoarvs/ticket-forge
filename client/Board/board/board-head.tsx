'use client';
// Around the board: the title with the sprint's scope, time left and Complete sprint; the sprint
// goal; and the pages shown when there's no active sprint or no issues.
import Link from 'next/link';
import { S, type Any, emit, can, openModal, filtersActive, EMPTY_FILTER } from '../../core';
import { Ico, I, EmptyState } from '../../ui';
import { CompleteSprintModal } from '../../actions';
import { SF, MenuItem } from '../../fields';
import { daysLeft, Header } from '../../views';
import type { BoardModel } from './use-board';

const showAll = (on: boolean) => {
  S.boardAll = on;
  emit();
};

function timeLeft(act: Any) {
  const left = daysLeft(act);
  if (left === null) return 'No end date';
  return left >= 0 ? `${left} days remaining` : `${-left} days overdue`;
}

function SprintInfo({ act }: { act: Any }) {
  return (
    <>
      <span className="muted small row" style={{ gap: 4 }}>
        <Ico svg={I.clock} />
        {timeLeft(act)}
      </span>
      {can('sprint.manage') && (
        <button className="btn" onClick={() => openModal(<CompleteSprintModal s={act} />)}>
          Complete sprint
        </button>
      )}
    </>
  );
}

export function BoardHead({ b }: { b: BoardModel }) {
  const { p, act, useSprint } = b;
  const right = (
    <>
      {p.sprints.length > 0 && (
        <SF
          filter
          aria-label="Board scope"
          value={S.boardAll ? 'all' : 'sprint'}
          onChange={(e) => showAll(e.target.value === 'all')}
        >
          <MenuItem value="sprint">Active sprint</MenuItem>
          <MenuItem value="all">All issues</MenuItem>
        </SF>
      )}
      {useSprint && <SprintInfo act={act} />}
    </>
  );
  return (
    <>
      <Header title={useSprint ? act.name : 'Board'} right={right} />
      {useSprint && act.goal && (
        <p className="muted board-goal">
          <Ico svg={I.flag} /> {act.goal}
        </p>
      )}
    </>
  );
}

export function NoSprint({ projectId }: { projectId: string }) {
  return (
    <EmptyState
      icon={I.board}
      title="No active sprint"
      actions={
        <>
          <Link className="btn primary" href={`/p/${projectId}/backlog`}>
            Go to backlog
          </Link>
          <button className="btn" onClick={() => showAll(true)}>
            Show all issues
          </button>
        </>
      }
    >
      <p>
        Start a sprint from the backlog to track its issues here, or show every issue on the board.
      </p>
    </EmptyState>
  );
}

/** No issues on the board: because of the filters, or none yet. */
export function BoardEmpty({ b }: { b: BoardModel }) {
  if (filtersActive())
    return (
      <EmptyState
        compact
        icon={I.search}
        tone="neutral"
        title="No issues match your filters"
        actions={
          <button
            className="btn"
            onClick={() => {
              S.filter = EMPTY_FILTER();
              emit();
            }}
          >
            Clear filters
          </button>
        }
      />
    );
  return (
    <EmptyState
      compact
      icon={I.board}
      tone="neutral"
      title={b.useSprint ? 'No issues in this sprint yet' : 'No issues yet'}
      actions={
        <Link className="btn" href={`/p/${b.p.id}/backlog`}>
          Go to backlog
        </Link>
      }
    >
      <p>
        {b.useSprint
          ? 'Drag issues into the sprint from the backlog, or create one in a column.'
          : 'Create issues in the backlog or in a column to see them here.'}
      </p>
    </EmptyState>
  );
}

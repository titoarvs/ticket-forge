'use client';
// The Backlog view: issues grouped by sprint, epic or status. It only puts the parts in
// client/views/backlog/ together.
import { type Any, S, can, emit, saveUi, openModal, filtersActive, EMPTY_FILTER } from '../core';
import { Ico, I, EmptyState } from '../ui';
import { NewWithClaudeModal, openCreateIssue, addEpic } from '../actions';
import { FeatureModal } from '../FeatureModal';
import { useAutoTour } from '../tour';
import { Header, FilterBar } from './row-dnd';
import { BulkBar } from './BulkBar';
import { backlogGroups } from './backlog/groups';
import { pageSig } from './backlog/row-data';
import { setVisibleIds } from './backlog/selection';
import { GroupSection, capOf } from './backlog/group-section';

export { IssueRow } from './backlog/row';

const GROUP_BY: [string, string][] = [
  ['sprint', 'Sprint'],
  ['epic', 'Epic'],
  ['status', 'Status'],
  ['none', 'None'],
];

function AiButtons() {
  if (!can('ai.use') || !can('issue.create')) return null;
  return (
    <>
      <button
        className="btn ai"
        data-tour="backlog-ai"
        onClick={() => openModal(<FeatureModal />)}
        title="Plan new epics and issues from a description or document"
      >
        <Ico svg={I.plus} />
        Add feature with AI
      </button>
      <button className="btn ai" onClick={() => openModal(<NewWithClaudeModal />)}>
        <Ico svg={I.sparkle} />
        Write issue with AI
      </button>
    </>
  );
}

function NoMatches() {
  const clear = () => {
    S.filter = EMPTY_FILTER();
    emit();
  };
  return (
    <EmptyState
      compact
      icon={I.search}
      tone="neutral"
      title="No issues match your filters"
      actions={
        <button className="btn" onClick={clear}>
          Clear filters
        </button>
      }
    >
      <p>Try a different search, or clear the filters to see every issue.</p>
    </EmptyState>
  );
}

function EmptyBacklog() {
  return (
    <EmptyState
      icon={I.backlog}
      title="Your backlog is empty"
      actions={
        can('issue.create') && (
          <button className="btn primary" onClick={() => openCreateIssue()}>
            <Ico svg={I.plus} />
            Create issue
          </button>
        )
      }
    >
      <p>
        Create issues one by one, or start a project from a requirements document and Claude writes
        them for you.
      </p>
    </EmptyState>
  );
}

export function Backlog() {
  useAutoTour('project');
  const groups = backlogGroups();
  const page = pageSig();
  // The rows on screen, top to bottom, for Shift-click ranges.
  setVisibleIds(
    groups.flatMap((g: Any) =>
      S.collapsed.has(g.id) ? [] : g.items.slice(0, capOf(g)).map((t: Any) => t.id),
    ),
  );
  const setGroupBy = (v: string) => {
    S.groupBy = v;
    saveUi();
    emit();
  };
  return (
    <>
      <Header title="Backlog" right={<AiButtons />} />
      <FilterBar group={{ value: S.groupBy, options: GROUP_BY, onChange: setGroupBy }} />
      <BulkBar />
      {groups.length ? (
        groups.map((g) => <GroupSection key={g.id} g={g} page={page} />)
      ) : filtersActive() ? (
        <NoMatches />
      ) : (
        <EmptyBacklog />
      )}
      {S.groupBy === 'epic' && !filtersActive() && can('epic.manage') && (
        <button className="inline-create" onClick={addEpic}>
          <Ico svg={I.plus} />
          Create epic
        </button>
      )}
    </>
  );
}

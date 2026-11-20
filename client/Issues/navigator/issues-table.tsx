'use client';
// The matching issues: a summary line, then the sortable table with checkboxes for bulk changes
// (or an empty state). Clicking a row opens the issue.
import { type Any, can, S, isDone, emit } from '../../core';
import { Ico, I, EmptyState } from '../../ui';
import { CB } from '../../fields';
import { openCreateIssue, openDrawer } from '../../actions';
import { EMPTY } from '../columns';
import type { IssuesNav } from './use-issues';

/** Clicks on these inside a row don't open the issue. */
const CONTROLS = 'input,button,.MuiInputBase-root,.MuiSelect-select,a';

const canPick = () =>
  can('issue.edit') || can('issue.delete') || can('sprint.manage') || can('test.run');

export function SumLine({ rows }: { rows: Any[] }) {
  const pts = rows.reduce((n: number, t: Any) => n + (t.storyPoints || 0), 0);
  return (
    <div className="iss-sumline muted small">
      {rows.length} issue{rows.length === 1 ? '' : 's'} · {pts} points ·{' '}
      {rows.filter(isDone).length} done
      {S.checked.size ? ` · ${S.checked.size} selected` : ''}
    </div>
  );
}

function HeadRow({ g, checks }: { g: IssuesNav; checks: boolean }) {
  const { rows, sort } = g;
  const allChecked = rows.length > 0 && rows.every((t: Any) => S.checked.has(t.id));
  const toggleAll = () => {
    rows.forEach((t: Any) => (allChecked ? S.checked.delete(t.id) : S.checked.add(t.id)));
    emit();
  };
  const ariaSort = (key: string) =>
    sort.key !== key ? 'none' : sort.dir === 1 ? 'ascending' : 'descending';
  return (
    <tr>
      {checks && (
        <th className="iss-chk">
          <CB aria-label="Select all shown" checked={allChecked} onChange={toggleAll} />
        </th>
      )}
      {g.shown.map((c) => (
        <th key={c.key} className={`${c.num ? 'num' : ''} c-${c.key}`} aria-sort={ariaSort(c.key)}>
          <button type="button" onClick={() => g.sortBy(c.key)}>
            {c.label}
            {sort.key === c.key && <span className="iss-arrow">{sort.dir === 1 ? '▲' : '▼'}</span>}
          </button>
        </th>
      ))}
    </tr>
  );
}

function IssueRow({ g, t, checks }: { g: IssuesNav; t: Any; checks: boolean }) {
  const active = S.drawer?.kind === 'issue' && S.drawer.id === t.id;
  return (
    <tr
      className={`${active ? 'active' : ''} ${isDone(t) ? 'done' : ''}`}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest(CONTROLS)) openDrawer('issue', t.id);
      }}
    >
      {checks && (
        <td className="iss-chk">
          <CB
            aria-label={`Select ${t.key}`}
            checked={S.checked.has(t.id)}
            onChange={(e: Any) => {
              if (e.target.checked) S.checked.add(t.id);
              else S.checked.delete(t.id);
              emit();
            }}
          />
        </td>
      )}
      {g.shown.map((c) => (
        <td key={c.key} className={`${c.num ? 'num' : ''} c-${c.key}`}>
          {c.cell(t)}
        </td>
      ))}
    </tr>
  );
}

function NoIssues() {
  const actions = can('issue.create') && (
    <button className="btn primary" onClick={() => openCreateIssue()}>
      <Ico svg={I.plus} />
      Create issue
    </button>
  );
  return (
    <EmptyState icon={I.backlog} title="No issues yet" actions={actions}>
      <p>
        Create issues here or in the Backlog, or start the project from a requirements document.
      </p>
    </EmptyState>
  );
}

function NoMatch({ g }: { g: IssuesNav }) {
  return (
    <EmptyState
      compact
      icon={I.search}
      tone="neutral"
      title="No issues match"
      actions={
        <button className="btn" onClick={() => g.set({ ...EMPTY, quick: 'all' })}>
          Show all issues
        </button>
      }
    >
      <p>Try another view, or clear the filters.</p>
    </EmptyState>
  );
}

export function IssuesTable({ g }: { g: IssuesNav }) {
  if (!g.p.tickets.length) return <NoIssues />;
  if (!g.rows.length) return <NoMatch g={g} />;
  const checks = canPick();
  return (
    <div className="iss-scroll">
      <table className="iss-tbl">
        <thead>
          <HeadRow g={g} checks={checks} />
        </thead>
        <tbody>
          {g.rows.map((t: Any) => (
            <IssueRow key={t.id} g={g} t={t} checks={checks} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

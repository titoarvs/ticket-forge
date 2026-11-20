'use client';
// Narrowing the issues: search, a dropdown per field, sub-tasks, clearing; saving the view and
// choosing columns.
import type { ReactNode } from 'react';
import { type Any, peopleNames, TYPES, statusNames, PRIORITIES } from '../../core';
import { Ico, I, LAYER_LABEL } from '../../ui';
import { SF, MenuItem, TF, opts, CB } from '../../fields';
import { COLS } from '../columns';
import type { IssuesNav } from './use-issues';

const none = (label: string) => (
  <MenuItem key="__none" value="__none">
    {label}
  </MenuItem>
);

const item = (value: string, label: ReactNode) => (
  <MenuItem key={value} value={value}>
    {label}
  </MenuItem>
);

type SelProps = { g: IssuesNav; k: string; label: string; children: ReactNode };

/** A filter dropdown; its empty choice is the field's name. */
function Sel({ g, k, label, children }: SelProps) {
  return (
    <SF filter value={g.f[k]} onChange={(e) => g.set({ [k]: e.target.value })} aria-label={label}>
      <MenuItem value="">{label}</MenuItem>
      {children}
    </SF>
  );
}

function FieldFilters({ g }: { g: IssuesNav }) {
  const { p } = g;
  const labels = [...new Set(p.tickets.flatMap((t: Any) => t.labels || []))].sort() as string[];
  return (
    <>
      <Sel g={g} k="type" label="Type">
        {opts(TYPES)}
      </Sel>
      <Sel g={g} k="status" label="Status">
        {opts(statusNames())}
      </Sel>
      <Sel g={g} k="priority" label="Priority">
        {opts(PRIORITIES)}
      </Sel>
      <Sel g={g} k="assignee" label="Assignee">
        {[none('Unassigned'), ...peopleNames().map((n: string) => item(n, n))]}
      </Sel>
      <Sel g={g} k="epic" label="Epic">
        {[...p.epics.map((e: Any) => item(e.id, `${e.key} ${e.title}`)), none('No epic')]}
      </Sel>
      <Sel g={g} k="sprint" label="Sprint">
        {[...p.sprints.map((s: Any) => item(s.id, s.name)), none('Backlog')]}
      </Sel>
      <Sel g={g} k="layer" label="Layer">
        {[...Object.entries(LAYER_LABEL).map(([k, l]) => item(k, l)), none('Not set')]}
      </Sel>
      {labels.length > 0 && (
        <Sel g={g} k="label" label="Label">
          {opts(labels)}
        </Sel>
      )}
    </>
  );
}

function ColumnsMenu({ g }: { g: IssuesNav }) {
  return (
    <div className="iss-cols-wrap">
      <button
        className="btn sm subtle"
        aria-expanded={g.colsOpen}
        onClick={() => g.setColsOpen(!g.colsOpen)}
      >
        <Ico svg={I.settings} />
        Columns
      </button>
      {g.colsOpen && (
        <div className="iss-cols" role="menu">
          {COLS.filter((c) => !c.always).map((c) => (
            <CB
              key={c.key}
              label={c.label}
              checked={g.cols.includes(c.key)}
              onChange={() => g.toggleCol(c.key)}
            />
          ))}
          <button className="link-btn small" onClick={g.resetCols}>
            Reset columns
          </button>
        </div>
      )}
    </div>
  );
}

export function FiltersBar({ g }: { g: IssuesNav }) {
  const { f, extra } = g;
  return (
    <div className="iss-filters">
      <TF
        filter
        value={f.q}
        placeholder="Search key, summary, description"
        onChange={(e) => g.set({ q: e.target.value })}
        aria-label="Search issues"
      />
      <FieldFilters g={g} />
      <CB
        label="Sub-tasks"
        checked={f.subtasks}
        onChange={(e: Any) => g.set({ subtasks: e.target.checked })}
      />
      {extra > 0 && (
        <button className="btn sm subtle" onClick={g.clearFilters}>
          Clear {extra} filter{extra > 1 ? 's' : ''}
        </button>
      )}
      <span className="spacer" />
      <button
        className="btn sm subtle"
        onClick={g.saveView}
        title="Save these filters, sort and columns as a view (this browser)"
      >
        <Ico svg={I.plus} />
        Save view
      </button>
      <ColumnsMenu g={g} />
    </div>
  );
}

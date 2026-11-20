'use client';
// The issue navigator's state, kept in this browser: the filters and sort (per project), the
// shown columns, and saved views; plus the issues that match, sorted.
import { useState } from 'react';
import { P, type Any, toast } from '../../core';
import { EMPTY, read, DEFAULT_COLS, write, COLS, QUICK } from '../columns';
import { type Sort, issueMatches, filterCount, nextSort, sortIssues, toggledCols } from './filter';

const COLS_KEY = 'tf.issues.cols';

export function useIssues() {
  const p = P();
  const store = `tf.issues.${p.id}`;
  const [f, setF] = useState<Any>(() => ({ ...EMPTY, ...read(`${store}.filter`, {}) }));
  const [cols, setColsState] = useState<string[]>(() => read(COLS_KEY, DEFAULT_COLS));
  const [sort, setSortState] = useState<Sort>(() =>
    read(`${store}.sort`, { key: 'updated', dir: -1 }),
  );
  const [views, setViewsState] = useState<Any[]>(() => read(`${store}.views`, []));
  const [colsOpen, setColsOpen] = useState(false);
  const set = (patch: Any) =>
    setF((x: Any) => {
      const n = { ...x, ...patch };
      write(`${store}.filter`, n);
      return n;
    });
  const setSort = (n: Sort) => {
    setSortState(n);
    write(`${store}.sort`, n);
  };
  const setCols = (n: string[]) => {
    setColsState(n);
    write(COLS_KEY, n);
  };
  const setViews = (n: Any[]) => {
    setViewsState(n);
    write(`${store}.views`, n);
  };
  const quick = QUICK.find((x) => x.key === f.quick) || QUICK[0];
  const extra = filterCount(f);
  const rows = sortIssues(
    p.tickets.filter((t: Any) => issueMatches(t, f, quick)),
    sort,
  );
  const saveView = () => {
    const name = window
      .prompt('Name this view', quick.label + (extra ? ' (filtered)' : ''))
      ?.trim();
    if (!name) return;
    setViews([...views.filter((v) => v.name !== name), { name, f, sort, cols }]);
    toast(`Saved the view “${name}”`);
  };
  const openView = (v: Any) => {
    set({ ...EMPTY, ...v.f });
    setSort(v.sort);
    if (v.cols) setCols(v.cols);
  };
  return {
    p,
    f,
    set,
    /** Keeps the quick view and the sub-tasks choice. */
    clearFilters: () => set({ ...EMPTY, quick: f.quick, subtasks: f.subtasks }),
    sort,
    sortBy: (key: string) => setSort(nextSort(sort, key)),
    cols,
    toggleCol: (k: string) => setCols(toggledCols(cols, k)),
    resetCols: () => setCols(DEFAULT_COLS),
    colsOpen,
    setColsOpen,
    views,
    saveView,
    openView,
    dropView: (name: string) => setViews(views.filter((v) => v.name !== name)),
    extra,
    rows,
    shown: COLS.filter((c) => c.always || cols.includes(c.key)),
  };
}

export type IssuesNav = ReturnType<typeof useIssues>;

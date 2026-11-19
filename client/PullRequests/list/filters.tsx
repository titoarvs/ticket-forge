'use client';
// Which pull requests are shown and how: status or "needs attention" focus, search, repository,
// sort and grouping. Status, sort and grouping are remembered in this browser.
import { useState, type ReactNode } from 'react';
import { type Any, store, epic } from '../../core';
import { Swatch } from '../../ui';
import { ACTIVE, flagsOf, time } from '../PrDetails';
import { ref } from '../ReviewModal';

export type PrRow = { t: Any; r: Any };
export type PrGroup = { key: string; title: ReactNode; items: PrRow[] };

export function usePrFilters() {
  const [status, setStatusRaw] = useState(() => store.get('tf.pr.status', 'active'));
  const [focus, setFocus] = useState('');
  const [q, setQ] = useState('');
  const [repo, setRepo] = useState('');
  const [sort, setSortRaw] = useState(() => store.get('tf.pr.sort', 'updated'));
  const [group, setGroupRaw] = useState(() => store.get('tf.pr.group', 'none'));
  const remember = (k: string, set: (v: string) => void) => (v: string) => {
    set(v);
    store.set(`tf.pr.${k}`, v);
  };
  return {
    status,
    focus,
    q,
    repo,
    sort,
    group,
    setFocus,
    setQ,
    setRepo,
    /** A status tab clears the "needs attention" focus. */
    setStatus: (v: string) => {
      setFocus('');
      remember('status', setStatusRaw)(v);
    },
    setSort: remember('sort', setSortRaw),
    setGroup: remember('group', setGroupRaw),
    clearAll: () => {
      setStatusRaw('all');
      setFocus('');
      setQ('');
      setRepo('');
    },
  };
}
export type PrFilters = ReturnType<typeof usePrFilters>;

function matchesStatus(f: PrFilters, r: Any) {
  if (f.focus) return Boolean((flagsOf(r) as Any)[f.focus]);
  if (f.status === 'all') return true;
  return f.status === 'active' ? ACTIVE.includes(r.status) : r.status === f.status;
}

function matchesSearch(q: string, { t, r }: PrRow) {
  if (!q) return true;
  const fields = [r.title, r.branch, r.repo, ref(r), t.key, t.title, r.author, ...(r.labels || [])];
  return fields.some((v) =>
    String(v || '')
      .toLowerCase()
      .includes(q),
  );
}

const linesChanged = (r: Any) => (r.size?.additions || 0) + (r.size?.deletions || 0);

function compare(sort: string, a: PrRow, b: PrRow) {
  if (sort === 'oldest') return time(a.r).localeCompare(time(b.r));
  if (sort === 'size') return linesChanged(b.r) - linesChanged(a.r);
  if (sort === 'issue') return a.t.key.localeCompare(b.t.key, undefined, { numeric: true });
  return time(b.r).localeCompare(time(a.r));
}

/** The rows the filters let through, in the chosen order. */
export function filterRows(rows: PrRow[], f: PrFilters) {
  const q = f.q.trim().toLowerCase();
  return rows
    .filter((x) => matchesStatus(f, x.r) && (!f.repo || x.r.repo === f.repo) && matchesSearch(q, x))
    .sort((a, b) => compare(f.sort, a, b));
}

function groupKey(group: string, { t, r }: PrRow) {
  if (group === 'repo') return r.repo || 'Other';
  if (group === 'status') return r.status;
  return epic(t.epicId)?.id || 'none';
}

function groupTitle(group: string, key: string): ReactNode {
  if (group !== 'epic') return key;
  const e = epic(key);
  if (!e) return 'No epic';
  return (
    <>
      <Swatch color={e.color} />
      {e.title}
    </>
  );
}

/** The shown rows in groups (one untitled group when not grouping), in the order they first appear. */
export function groupRows(shown: PrRow[], group: string): PrGroup[] {
  if (group === 'none') return [{ key: 'all', title: null, items: shown }];
  const groups: PrGroup[] = [];
  for (const x of shown) {
    const key = groupKey(group, x);
    let g = groups.find((y) => y.key === key);
    if (!g) {
      g = { key, title: groupTitle(group, key), items: [] };
      groups.push(g);
    }
    g.items.push(x);
  }
  return groups;
}

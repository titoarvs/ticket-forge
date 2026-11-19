// Which issues the filters show, how they sort, and exporting them as CSV.
import { type Any, isSub, saveBlob, toast } from '../../core';
import { COLS } from '../columns';

/** The dropdown filters; each counts toward "Clear N filters" (so does the search). */
export const FILTER_KEYS = [
  'type',
  'status',
  'priority',
  'assignee',
  'epic',
  'sprint',
  'layer',
  'label',
];

/** Columns that sort newest / biggest first on the first click. */
const DESC_FIRST = ['updated', 'created', 'points', 'tests', 'prs'];

/** v is the filter's value; '__none' means the field is empty. */
const fieldIs = (v: string, actual: Any) => !v || (v === '__none' ? !actual : actual === v);

const textMatches = (t: Any, ql: string) =>
  !ql ||
  t.key.toLowerCase().includes(ql) ||
  t.title.toLowerCase().includes(ql) ||
  String(t.description || '')
    .toLowerCase()
    .includes(ql);

export const issueMatches = (t: Any, f: Any, quick: Any) =>
  (f.subtasks || !isSub(t)) &&
  quick.test(t) &&
  textMatches(t, f.q.trim().toLowerCase()) &&
  (!f.type || t.type === f.type) &&
  (!f.status || t.status === f.status) &&
  (!f.priority || t.priority === f.priority) &&
  fieldIs(f.assignee, t.assignee) &&
  fieldIs(f.epic, t.epicId) &&
  fieldIs(f.sprint, t.sprintId) &&
  fieldIs(f.layer, t.layer) &&
  (!f.label || (t.labels || []).includes(f.label));

export const filterCount = (f: Any) =>
  FILTER_KEYS.filter((k) => f[k]).length + (f.q.trim() ? 1 : 0);

export type Sort = { key: string; dir: 1 | -1 };

/** Same column: reverse it; another column: its natural direction. */
export function nextSort(s: Sort, key: string): Sort {
  if (s.key === key) return { key, dir: -s.dir as 1 | -1 };
  return { key, dir: DESC_FIRST.includes(key) ? -1 : 1 };
}

/** Sort values are plain values or [primary, secondary] pairs. */
function cmp(a: Any, b: Any): number {
  if (Array.isArray(a)) {
    if (a[0] === b[0]) return cmp(a[1], b[1]);
    return a[0] < b[0] ? -1 : 1;
  }
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function sortIssues(list: Any[], sort: Sort) {
  const sc = COLS.find((c) => c.key === sort.key) || COLS[0];
  return [...list].sort((a, b) => cmp(sc.sort!(a), sc.sort!(b)) * sort.dir);
}

/** Keeps the columns in their table order when one is turned back on. */
export const toggledCols = (cols: string[], k: string) =>
  cols.includes(k)
    ? cols.filter((x) => x !== k)
    : COLS.map((x) => x.key).filter((x) => x === k || cols.includes(x));

/** The shown rows and columns as a CSV file (with a BOM so Excel reads UTF-8). */
export function exportIssuesCsv(projectKey: string, rows: Any[], cols: string[]) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const cs = COLS.filter((c) => c.always || cols.includes(c.key));
  const text = [
    cs.map((c) => c.label).join(','),
    ...rows.map((t: Any) => cs.map((c) => esc(c.csv(t))).join(',')),
  ].join('\n');
  saveBlob(new Blob([`﻿${text}`], { type: 'text/csv' }), `${projectKey}-issues.csv`);
  toast(`Exported ${rows.length} issue${rows.length === 1 ? '' : 's'}`);
}

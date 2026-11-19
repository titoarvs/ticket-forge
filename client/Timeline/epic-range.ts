'use client';
import { useState, useEffect } from 'react';
import { fmtDate, type Any, epicTickets, sprint, mutate } from '../core';

const DAY = 86400000;
export const ZOOMS: [string, string, number][] = [
  ['weeks', 'Weeks', 30],
  ['months', 'Months', 8],
  ['quarters', 'Quarters', 3],
];
export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
export const ROW = 44,
  SUBROW = 34;
/** True on phone-width screens, where the epic list column is narrower. */
export function useNarrow() {
  const [n, setN] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 720px)');
    const on = () => setN(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return n;
}
// Dates are 'YYYY-MM-DD' strings, handled in UTC so daylight saving never shifts a day.
export const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const toStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => toStr(toMs(d) + n * DAY);
export const todayStr = () => {
  const n = new Date();
  return toStr(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
};
export const span = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);
export const fmt = (d: string) => fmtDate(`${d}T00:00:00`);
export const fmtY = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
/** An epic's dates: its own start/due dates, or an estimate from the sprints its issues are in. */
export function epicRange(e: Any): { start: string; end: string; derived: boolean } | null {
  if (e.startDate && e.dueDate) return { start: e.startDate, end: e.dueDate, derived: false };
  const ss = epicTickets(e.id)
    .map((t: Any) => sprint(t.sprintId))
    .filter((s: Any) => s?.startDate && s?.endDate);
  if (e.startDate || e.dueDate) {
    const d = e.startDate || e.dueDate;
    return { start: e.startDate || d, end: e.dueDate || d, derived: false };
  }
  if (!ss.length) return null;
  return {
    start: ss.map((s: Any) => s.startDate).sort()[0],
    end: ss
      .map((s: Any) => s.endDate)
      .sort()
      .at(-1),
    derived: true,
  };
}
/** Set an epic's dates (one undo step). Keeps the due date on or after the start date. */
export function setEpicDates(e: Any, start: string, end: string) {
  if (start && end && end < start) [start, end] = [end, start];
  if ((e.startDate || '') === start && (e.dueDate || '') === end) return;
  mutate(
    () => {
      e.startDate = start || '';
      e.dueDate = end || '';
    },
    { tag: `e.dates${e.id}` },
  );
}
/** Columns of the time scale between from and to: [label, startDay, days]. */
export function scale(from: string, to: string, unit: 'week' | 'month' | 'quarter' | 'year') {
  const out: [string, number, number][] = [];
  let cur = from;
  while (cur < to) {
    const d = new Date(toMs(cur));
    const y = d.getUTCFullYear(),
      m = d.getUTCMonth();
    let next: string, label: string;
    if (unit === 'week') {
      next = addDays(cur, 7 - ((d.getUTCDay() + 6) % 7));
      label = String(d.getUTCDate());
    } else if (unit === 'month') {
      next = toStr(Date.UTC(y, m + 1, 1));
      label = MONTHS[m];
    } else if (unit === 'quarter') {
      next = toStr(Date.UTC(y, m - (m % 3) + 3, 1));
      label = `Q${Math.floor(m / 3) + 1}`;
    } else {
      next = toStr(Date.UTC(y + 1, 0, 1));
      label = String(y);
    }
    if (next > to) next = to;
    out.push([label, span(from, cur), span(cur, next)]);
    cur = next;
  }
  return out;
}
export type Drag = {
  id: string;
  mode: 'move' | 'start' | 'end' | 'create';
  x: number;
  s0: string;
  e0: string;
  moved: boolean;
  start: string;
  end: string;
};

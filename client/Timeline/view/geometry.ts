'use client';
// The timeline's calendar: which dates it covers, how wide a day is, and its scale columns.
import { useMemo } from 'react';
import type { Any } from '../../core';
import { epicRange, toMs, toStr, addDays, span, scale } from '../epic-range';

export type Zoom = [string, string, number];
export type Geometry = {
  from: string;
  to: string;
  /** Pixels per day. */
  ppd: number;
  width: number;
  today: string;
  /** Where a date is, in pixels from the left of the calendar. */
  x: (d: string) => number;
  /** A bar from start to end inclusive (at least one day wide). */
  barWidth: (start: string, end: string) => number;
  zoom: Zoom;
};

/** The first day of the quarter `add` quarters after the one `d` is in. */
function quarterStart(d: string, add: number) {
  const x = new Date(toMs(d));
  const m = x.getUTCMonth();
  return toStr(Date.UTC(x.getUTCFullYear(), m - (m % 3) + add, 1));
}

/**
 * Whole quarters around every date in the project and today, with room to plan ahead (at least a
 * year).
 */
function visibleRange(p: Any, today: string) {
  const ds = [today];
  for (const e of p.epics) {
    const r = epicRange(e);
    if (r) ds.push(r.start, r.end);
  }
  for (const s of p.sprints) if (s.startDate && s.endDate) ds.push(s.startDate, s.endDate);
  ds.sort();
  const lo = quarterStart(addDays(ds[0], -30), 0);
  let hi = quarterStart(addDays(ds.at(-1)!, 60), 3);
  if (span(lo, hi) < 365) hi = quarterStart(addDays(lo, 365), 0);
  return { from: lo, to: hi };
}

export function useGeometry(p: Any, zoom: Zoom, today: string): Geometry {
  const { from, to } = useMemo(() => visibleRange(p, today), [p.epics, p.sprints, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const ppd = zoom[2];
  return {
    from,
    to,
    ppd,
    width: span(from, to) * ppd,
    today,
    x: (d: string) => span(from, d) * ppd,
    barWidth: (start: string, end: string) => Math.max(ppd, (span(start, end) + 1) * ppd),
    zoom,
  };
}

/** The two scale rows: months over weeks, or years over months or quarters. */
export function scaleRows(g: Geometry) {
  const z = g.zoom[0];
  return {
    top: scale(g.from, g.to, z === 'weeks' ? 'month' : 'year'),
    bottom: scale(g.from, g.to, z === 'weeks' ? 'week' : z === 'months' ? 'month' : 'quarter'),
  };
}

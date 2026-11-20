'use client';
// Changing an epic's dates on the timeline: drag the bar to move it, drag an end to change the start
// or due date, drag on an empty row to schedule it, or use the keyboard on a focused bar.
import {
  useState,
  useRef,
  useEffect,
  type PointerEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import type { Any } from '../../core';
import { openDrawer } from '../../actions';
import { type Drag, addDays, setEpicDates } from '../epic-range';
import type { Geometry } from './geometry';

export type Preview = { id: string; start: string; end: string } | null;

/** The dates a drag gives: moved n days, a changed end, or (creating) from where it began to `at`. */
function draggedDates(d: Drag, n: number, at: string) {
  let { s0: start, e0: end } = d;
  if (d.mode === 'move') {
    start = addDays(d.s0, n);
    end = addDays(d.e0, n);
  } else if (d.mode === 'start') {
    start = addDays(d.s0, n);
    if (start > end) start = end;
  } else if (d.mode === 'end') {
    end = addDays(d.e0, n);
    if (end < start) end = start;
  } else if (at < d.s0) {
    start = at;
    end = d.s0;
  } else {
    start = d.s0;
    end = at > d.e0 ? at : d.e0;
  }
  return { start, end };
}

type Options = {
  g: Geometry;
  canEdit: boolean;
  left: number;
  scroller: RefObject<HTMLDivElement | null>;
};

export function useBarDrag({ g, canEdit, left, scroller }: Options) {
  const [preview, setPreview] = useState<Preview>(null);
  const drag = useRef<Drag | null>(null);
  useEffect(
    () => () => {
      document.body.classList.remove('resizing-x');
    },
    [],
  );
  /** The day under the pointer. */
  const dayAt = (clientX: number) => {
    const el = scroller.current!;
    const start = el.getBoundingClientRect().left + left - el.scrollLeft;
    return addDays(g.from, Math.floor((clientX - start) / g.ppd));
  };
  const begin = (
    ev: PointerEvent<HTMLElement>,
    e: Any,
    mode: Drag['mode'],
    s0: string,
    e0: string,
  ) => {
    if (!canEdit || ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    drag.current = {
      id: e.id,
      mode,
      x: ev.clientX,
      s0,
      e0,
      moved: mode === 'create',
      start: s0,
      end: e0,
    };
    if (mode === 'create') setPreview({ id: e.id, start: s0, end: e0 });
    document.body.classList.add('resizing-x');
  };
  /** Ignores the first 4 px, so a click stays a click. */
  const move = (ev: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = ev.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 4) return;
    d.moved = true;
    const { start, end } = draggedDates(d, Math.round(dx / g.ppd), dayAt(ev.clientX));
    d.start = start;
    d.end = end;
    setPreview({ id: d.id, start, end });
  };
  const cancel = () => {
    drag.current = null;
    setPreview(null);
    document.body.classList.remove('resizing-x');
  };
  /** A drag saves the new dates; a click (no drag) opens the epic. */
  const end = (e: Any) => {
    const d = drag.current;
    cancel();
    if (!d) return;
    if (!d.moved) openDrawer('epic', e.id);
    else setEpicDates(e, d.start, d.end);
  };
  /** ←/→ move the bar a day (a week with Shift); Alt+←/→ change the due date; Enter opens it. */
  const barKey = (ev: KeyboardEvent<HTMLElement>, e: Any, r: { start: string; end: string }) => {
    if (ev.key === 'Enter') return openDrawer('epic', e.id);
    if (!canEdit || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
    ev.preventDefault();
    const n = (ev.key === 'ArrowLeft' ? -1 : 1) * (ev.shiftKey ? 7 : 1);
    if (!ev.altKey) return setEpicDates(e, addDays(r.start, n), addDays(r.end, n));
    const due = addDays(r.end, n);
    setEpicDates(e, r.start, due < r.start ? r.start : due);
  };
  return {
    preview,
    dayAt,
    begin,
    move,
    end,
    cancel,
    barKey,
    isCreating: () => drag.current?.mode === 'create',
  };
}
export type BarDrag = ReturnType<typeof useBarDrag>;

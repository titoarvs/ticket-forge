'use client';
// Pointer and wheel on the graph: drag a note, drag the background to pan, wheel to zoom, hover to
// see a note, click to open it.
import type { GNode } from '../BrainSettings';
import { type Sim, radius } from './layout';

type Handlers = { onSelect: (id: string) => void; onHover: (n: GNode | null) => void };

/** Where an event is, on the canvas (sx, sy) and in the graph's own coordinates (x, y). */
function locate(cv: HTMLCanvasElement, s: Sim, e: PointerEvent | WheelEvent) {
  const r = cv.getBoundingClientRect();
  return {
    x: (e.clientX - r.left - s.view.x) / s.view.k,
    y: (e.clientY - r.top - s.view.y) / s.view.k,
    sx: e.clientX - r.left,
    sy: e.clientY - r.top,
  };
}

/** The node under a point (with a few pixels to spare), the nearest one when several are. */
function hit(s: Sim, w: { x: number; y: number }) {
  let best: GNode | null = null;
  let bd = Infinity;
  for (const n of s.nodes) {
    const d = (n.x - w.x) ** 2 + (n.y - w.y) ** 2;
    const r = radius(n) + 5 / s.view.k;
    if (d < r * r && d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

/** Listens on the canvas; returns the function that stops listening. */
export function listen(cv: HTMLCanvasElement, s: Sim, { onSelect, onHover }: Handlers) {
  const down = (e: PointerEvent) => {
    const w = locate(cv, s, e);
    const n = hit(s, w);
    cv.setPointerCapture(e.pointerId);
    s.drag = { node: n, sx: w.sx, sy: w.sy, vx: s.view.x, vy: s.view.y, moved: false };
    if (n) s.kick(0.3);
  };
  const dragTo = (w: ReturnType<typeof locate>) => {
    const d = s.drag;
    if (Math.abs(w.sx - d.sx) + Math.abs(w.sy - d.sy) > 4) d.moved = true;
    if (d.node) {
      d.node.x = w.x;
      d.node.y = w.y;
      s.kick(0.15);
    } else if (d.moved) {
      s.moved = true;
      s.view.x = d.vx + (w.sx - d.sx);
      s.view.y = d.vy + (w.sy - d.sy);
      s.draw();
    }
  };
  const setHover = (n: GNode | null) => {
    if (n === s.hover) return;
    s.hover = n;
    onHover(n);
    cv.style.cursor = n ? 'pointer' : 'grab';
    s.draw();
  };
  const move = (e: PointerEvent) => {
    const w = locate(cv, s, e);
    if (s.drag) dragTo(w);
    else setHover(hit(s, w));
  };
  /** A click (no drag) on a note opens it. */
  const up = (e: PointerEvent) => {
    const d = s.drag;
    s.drag = null;
    try {
      cv.releasePointerCapture(e.pointerId);
    } catch {
      /* released */
    }
    if (d && !d.moved && d.node) onSelect(d.node.id);
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    s.moved = true;
    const w = locate(cv, s, e);
    const k = Math.min(4, Math.max(0.08, s.view.k * Math.exp(-e.deltaY * 0.0015)));
    s.view = { k, x: w.sx - w.x * k, y: w.sy - w.y * k };
    s.draw();
  };
  const leave = () => {
    if (!s.hover) return;
    s.hover = null;
    onHover(null);
    s.draw();
  };
  const events: [string, EventListener, AddEventListenerOptions?][] = [
    ['pointerdown', down as EventListener],
    ['pointermove', move as EventListener],
    ['pointerup', up as EventListener],
    ['pointercancel', up as EventListener],
    ['wheel', wheel as EventListener, { passive: false }],
    ['pointerleave', leave],
  ];
  for (const [name, fn, opts] of events) cv.addEventListener(name, fn, opts);
  return () => {
    for (const [name, fn] of events) cv.removeEventListener(name, fn);
  };
}

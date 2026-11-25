'use client';
// Mouse, pen and touch on the canvas: drag a node to move it, drag the background to pan, pinch to
// zoom, drag from a port to draw a wire, and click to select.
import { useState, useRef } from 'react';
import type { Any } from '../core';
import type { Pt } from './model';
import type { Viewport, Sel } from './use-viewport';

type Handlers<W> = {
  /** The start of a wire drawn from this port. */
  wireFrom: (port: HTMLElement) => W;
  canWire: (from: W, target: string) => boolean;
  /** A wire was dropped on a node it may connect to. */
  onWire: (from: W, target: string) => void;
  setSel: (sel: Sel) => void;
  /** Nodes can't be moved. */
  fixed?: boolean;
  /** Where a dragged node is now, for canvases that keep their own layout; `done` on release. */
  onMove?: (id: string, p: Pt, done: boolean) => void;
  /** A port was clicked, or its wire was dropped on empty canvas at `p`. */
  onMiss?: (from: W, p: Pt, moved: boolean) => void;
};
export type Wiring<W> = { from: W; cur: Pt; over: string } | null;
type ClientPt = { clientX: number; clientY: number };

/** The node under the pointer, or ''. */
const nodeAt = (e: ClientPt) =>
  (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(
    '[data-node]',
  )?.dataset.node || '';

export function usePointer<W extends { node: string }>(v: Viewport, h: Handlers<W>) {
  const { canWire, onWire, setSel, onMove, onMiss } = h;
  const [conn, setConn] = useState<Wiring<W>>(null);
  const drag = useRef<Any>(null);
  const pts = useRef(new Map<number, Pt>());

  const capture = (e: React.PointerEvent) => {
    try {
      v.vp.current?.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone: the gesture still works without capture */
    }
  };
  /** What a press starts: a wire from a port, moving a node, or panning the background. */
  const startGesture = (e: React.PointerEvent, t: HTMLElement) => {
    const port = t.closest<HTMLElement>('[data-port="out"]');
    const nodeEl = t.closest<HTMLElement>('[data-node]');
    const start = { sx: e.clientX, sy: e.clientY, moved: false };
    if (port) {
      const from = h.wireFrom(port);
      capture(e);
      drag.current = { type: 'conn', from, ...start };
      setConn({ from, cur: v.toWorld(e), over: '' });
      e.preventDefault();
    } else if (nodeEl && !t.closest('button, input, select, textarea, a, [data-nodrag]')) {
      capture(e);
      const w = v.toWorld(e);
      const p = v.at(nodeEl.dataset.node!);
      drag.current = {
        type: 'node',
        fixed: h.fixed,
        id: nodeEl.dataset.node!,
        ox: w.x - p.x,
        oy: w.y - p.y,
        ...start,
      };
    } else if (!nodeEl && !t.closest('[data-edge], [data-nodrag], .flow-edge-x')) {
      capture(e);
      const { x: vx, y: vy } = v.viewRef.current;
      drag.current = { type: 'pan', vx, vy, ...start };
    }
  };
  const down = (e: React.PointerEvent) => {
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      drag.current = {
        type: 'pinch',
        d0: Math.hypot(a.x - b.x, a.y - b.y),
        k0: v.viewRef.current.k,
      };
      return;
    }
    const t = e.target as HTMLElement;
    if (!t.closest('.flow-ui')) startGesture(e, t);
  };
  const pinch = (d: Any) => {
    const [a, b] = [...pts.current.values()];
    const box = v.rectOf();
    const k = d.k0 * (Math.hypot(a.x - b.x, a.y - b.y) / d.d0);
    v.zoomAt((a.x + b.x) / 2 - box.left, (a.y + b.y) / 2 - box.top, k);
  };
  const draggedTo = (d: Any, e: ClientPt): Pt => {
    const w = v.toWorld(e);
    return { x: Math.round(w.x - d.ox), y: Math.round(w.y - d.oy) };
  };
  const move = (e: React.PointerEvent) => {
    if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (!d) return;
    if (d.type === 'pinch' && pts.current.size >= 2) return pinch(d);
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
    if (d.type === 'pan') {
      if (d.moved) v.touched.current = true;
      v.setView((x) => ({ ...x, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
    } else if (d.type === 'node' && d.moved && !d.fixed) {
      v.touched.current = true;
      const p = draggedTo(d, e);
      if (onMove) onMove(d.id, p, false);
      else v.setPos((all) => ({ ...all, [d.id]: p }));
    } else if (d.type === 'conn')
      setConn((cn) => cn && { ...cn, cur: v.toWorld(e), over: nodeAt(e) });
  };
  /** Ends a gesture: drop a wire, select what was clicked, or remember the new layout. */
  const finish = (d: Any, e: React.PointerEvent) => {
    if (d.type === 'conn') {
      const target = nodeAt(e);
      setConn(null);
      if (d.moved && target && canWire(d.from, target)) onWire(d.from, target);
      else if (onMiss && (!d.moved || !target)) onMiss(d.from, v.toWorld(e), d.moved);
      else if (!d.moved) setSel({ type: 'node', id: d.from.node });
    } else if (!d.moved) setSel(d.type === 'node' ? { type: 'node', id: d.id } : null);
    else {
      if (d.type === 'node' && !d.fixed) onMove?.(d.id, draggedTo(d, e), true);
      v.persist();
    }
  };
  const up = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    const d = drag.current;
    if (d?.type === 'pinch') {
      if (pts.current.size < 2) {
        drag.current = null;
        v.persist();
      }
      return;
    }
    drag.current = null;
    if (!d) return;
    try {
      v.vp.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    finish(d, e);
  };
  return { conn, down, move, up };
}

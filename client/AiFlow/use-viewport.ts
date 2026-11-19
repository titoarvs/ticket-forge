'use client';
// The canvas viewport: node positions, pan and zoom, fitting everything in view, full screen. The
// layout and view are remembered in this browser.
import { useState, useEffect, useMemo, useRef } from 'react';
import type { Pt } from './model';
import { LS, clamp } from './model';
import type { Graph } from './graph';

type View = { x: number; y: number; k: number };
export type Sel = { type: 'node' | 'edge'; id: string } | null;

function readStored() {
  try {
    return JSON.parse(localStorage.getItem(LS) || '{}');
  } catch {
    return {};
  }
}

export function useViewport(g: Graph) {
  const stored = useMemo(() => readStored(), []);
  const [pos, setPos] = useState<Record<string, Pt>>(stored.pos || {});
  const [view, setView] = useState<View>(stored.view || { x: 24, y: 24, k: 0.8 });
  const [fitted, setFitted] = useState(Boolean(stored.view));
  const [full, setFull] = useState(false);
  const vp = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  // once you pan or zoom yourself, the canvas stops re-fitting on resize
  const touched = useRef(Boolean(stored.view));

  const persist = (p = pos, v = view) => {
    try {
      localStorage.setItem(LS, JSON.stringify({ pos: p, view: v }));
    } catch {
      /* private mode */
    }
  };
  const at = (id: string): Pt => pos[id] || g.byId[id]?.def || { x: 0, y: 0 };
  const rectOf = () => vp.current!.getBoundingClientRect();
  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const b = rectOf();
    const v = viewRef.current;
    return { x: (e.clientX - b.left - v.x) / v.k, y: (e.clientY - b.top - v.y) / v.k };
  };
  const zoomTo = (cx: number, cy: number, k2: number) =>
    setView((v) => {
      const k = clamp(k2, 0.2, 1.6);
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    });
  const zoomAt = (cx: number, cy: number, k2: number) => {
    touched.current = true;
    zoomTo(cx, cy, k2);
  };
  const zoomBy = (f: number) => {
    const b = rectOf();
    zoomAt(b.width / 2, b.height / 2, view.k * f);
  };
  const fit = () => {
    if (!vp.current || !g.nodes.length) return;
    const v = fittedView(rectOf(), g, at);
    setView(v);
    persist(pos, v);
  };
  const refit = () => {
    touched.current = false;
    fit();
  };
  const resetLayout = () => {
    setPos({});
    touched.current = false;
    persist({}, view);
    setFitted(false);
  };
  return {
    pos,
    setPos,
    view,
    setView,
    fitted,
    setFitted,
    full,
    setFull,
    vp,
    viewRef,
    touched,
    persist,
    at,
    rectOf,
    toWorld,
    zoomAt,
    zoomBy,
    fit,
    refit,
    resetLayout,
  };
}
export type Viewport = ReturnType<typeof useViewport>;

/** The view that shows every node, leaving room for the toolbar on top and the zoom controls below. */
function fittedView(b: DOMRect, g: Graph, at: (id: string) => Pt): View {
  const xs = g.nodes.flatMap((n) => [at(n.id).x, at(n.id).x + n.w]);
  const ys = g.nodes.flatMap((n) => [at(n.id).y, at(n.id).y + n.h]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // the toolbar is taller when it wraps on narrow screens
  const top = b.width < 720 ? 96 : 76;
  const bottom = 56;
  const k = clamp(
    Math.min((b.width - 48) / (x1 - x0), (b.height - top - bottom) / (y1 - y0)),
    0.2,
    1,
  );
  return {
    k,
    x: (b.width - (x1 - x0) * k) / 2 - x0 * k,
    y: top + (b.height - top - bottom - (y1 - y0) * k) / 2 - y0 * k,
  };
}

/** Fits the canvas the first time, when it resizes (until you pan or zoom) and on full screen. */
export function useAutoFit(v: Viewport, g: Graph) {
  const { vp, fitted, setFitted, full, touched, fit } = v;
  useEffect(() => {
    if (!fitted && vp.current && g.nodes.length) {
      fit();
      setFitted(true);
    }
  }, [g.nodes.length, fitted]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = vp.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (!touched.current) fit();
      }, 80);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  });
  useEffect(() => {
    if (!fitted) return undefined;
    const t = setTimeout(() => fit(), 60);
    return () => clearTimeout(t);
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Ctrl/⌘ + scroll zooms. Plain scrolling keeps scrolling the page, unless the canvas is full
 * screen.
 */
export function useWheelZoom(v: Viewport) {
  const { vp, full, viewRef, zoomAt } = v;
  useEffect(() => {
    const el = vp.current;
    if (!el) return undefined;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || full)) return;
      e.preventDefault();
      const b = el.getBoundingClientRect();
      const k = viewRef.current.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
      zoomAt(e.clientX - b.left, e.clientY - b.top, k);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** In full screen, Escape leaves it and the page behind doesn't scroll. */
export function useFullScreenKeys(v: Viewport) {
  const { full, setFull } = v;
  useEffect(() => {
    if (!full) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [full, setFull]);
}

/**
 * Opening a node's details glides the canvas so the node isn't hidden under the details panel (wide
 * screens). Returns whether the glide animation is running.
 */
export function useGlideToSelection(v: Viewport, g: Graph, sel: Sel) {
  const [smooth, setSmooth] = useState(false);
  const selId = sel?.type === 'node' ? sel.id : '';
  useEffect(() => {
    const n = g.byId[selId];
    if (!selId || !v.vp.current || !n || n.kind === 'add') return;
    const b = v.rectOf();
    if (b.width < 720) return;
    const p = v.at(selId);
    const view = v.viewRef.current;
    const left = view.x + p.x * view.k;
    const right = left + n.w * view.k;
    const panel = b.width - 364;
    let dx = 0;
    if (right > panel - 8) dx = panel - 8 - right;
    if (left + dx < 12) dx = 12 - left;
    if (Math.abs(dx) < 2) return;
    v.touched.current = true;
    setSmooth(true);
    v.setView((x) => ({ ...x, x: x.x + dx }));
    const t = setTimeout(() => setSmooth(false), 360);
    return () => clearTimeout(t);
  }, [selId]); // eslint-disable-line react-hooks/exhaustive-deps
  return smooth;
}

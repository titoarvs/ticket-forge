'use client';
// Running the graph: a new simulation whenever the notes or the open note change (keeping the
// layout when only the selection changed), the animation loop, and redrawing on resize and theme.
import { useRef, useEffect, type RefObject } from 'react';
import type { GNode } from '../BrainSettings';
import { palette } from '../BrainSettings';
import type { GraphData } from './graph-data';
import { type Sim, makeNodes, linkNodes, fitView, step } from './layout';
import { drawGraph } from './draw';
import { listen } from './pointer';

type Refs = { canvas: RefObject<HTMLCanvasElement | null>; wrap: RefObject<HTMLDivElement | null> };
type Handlers = { onSelect: (id: string) => void; onHover: (n: GNode | null) => void };

/** The canvas matches its box, in device pixels. */
function sizeCanvas(cv: HTMLCanvasElement, box: HTMLElement, s: Sim) {
  const w = box.clientWidth;
  const h = box.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr;
  cv.height = h * dpr;
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  s.w = w;
  s.h = h;
  s.dpr = dpr;
}

/**
 * Same notes (only the selection changed): keep the layout and view, barely moving. New notes: lay
 * out again and fit once it settles.
 */
function newSim(graph: GraphData, prevSim: Sim | null, selected: string): Sim {
  const prev = prevSim?.byId || new Map<string, GNode>();
  const nodes = makeNodes(graph, prev);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const settled = prev.size > 0 && nodes.every((n) => prev.has(n.id));
  return {
    nodes,
    byId,
    edges: linkNodes(graph, byId),
    view: prevSim?.view || { x: 0, y: 0, k: 1 },
    alpha: settled ? 0.03 : prev.size ? 0.6 : 1,
    raf: 0,
    colors: palette(),
    drag: null,
    fitted: settled,
    settledFit: settled,
    selected,
    w: 0,
    h: 0,
    dpr: 1,
    draw: () => {},
    fit: () => {},
    kick: () => {},
  };
}

/** Steps while the layout is lively (or a node is dragged); fits once while settling and once settled. */
function startLoop(s: Sim) {
  const loop = () => {
    const lively = () => s.alpha > 0.02 || s.drag;
    if (lively()) {
      step(s);
      if (!s.fitted && !s.moved && s.alpha < 0.3) {
        fitView(s);
        s.fitted = true;
      }
    }
    const more = lively();
    if (!more && !s.moved && !s.settledFit) {
      fitView(s);
      s.settledFit = true;
    }
    s.draw();
    s.raf = more ? requestAnimationFrame(loop) : 0;
  };
  s.kick = (a = 0.4) => {
    s.alpha = Math.max(s.alpha, a);
    if (!s.raf) s.raf = requestAnimationFrame(loop);
  };
  s.raf = requestAnimationFrame(loop);
}

/** Redraws when the box resizes or the theme (light / dark) changes. */
function watchPage(cv: HTMLCanvasElement, box: HTMLElement, s: Sim) {
  const recolor = () => {
    s.colors = palette();
    s.draw();
  };
  const ro = new ResizeObserver(() => {
    sizeCanvas(cv, box, s);
    s.draw();
  });
  ro.observe(box);
  const mo = new MutationObserver(recolor);
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class'],
  });
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener?.('change', recolor);
  return () => {
    ro.disconnect();
    mo.disconnect();
    mq?.removeEventListener?.('change', recolor);
  };
}

export function useGraphSim(graph: GraphData, selected: string, refs: Refs, handlers: Handlers) {
  const sim = useRef<Sim | null>(null);
  useEffect(() => {
    const cv = refs.canvas.current;
    const box = refs.wrap.current;
    if (!cv || !box) return undefined;
    const s = newSim(graph, sim.current, selected);
    sim.current = s;
    sizeCanvas(cv, box, s);
    if (!s.fitted) s.view = { x: s.w / 2, y: s.h / 2, k: s.nodes.length > 200 ? 0.5 : 1 };
    s.draw = () => drawGraph(cv, s);
    s.fit = () => {
      fitView(s);
      s.draw();
    };
    startLoop(s);
    const stopPointer = listen(cv, s, handlers);
    const stopWatching = watchPage(cv, box, s);
    return () => {
      cancelAnimationFrame(s.raf);
      s.raf = 0;
      stopPointer();
      stopWatching();
    };
  }, [graph, selected]); // eslint-disable-line react-hooks/exhaustive-deps
  return sim;
}

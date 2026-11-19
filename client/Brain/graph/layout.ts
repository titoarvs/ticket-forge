'use client';
// The graph's simulation state and its physics: where nodes start, one step of the forces (push
// apart, pull along links, pull to the middle), and the view that fits everything.
import type { Any } from '../../core';
import type { GNode } from '../BrainSettings';
import type { GraphData } from './graph-data';

export type View = { x: number; y: number; k: number };
export type Sim = {
  nodes: GNode[];
  byId: Map<string, GNode>;
  edges: [GNode, GNode][];
  view: View;
  /** How lively the layout still is; it cools down each step and stops below 0.02. */
  alpha: number;
  raf: number;
  colors: Record<string, string>;
  drag: Any;
  fitted: boolean;
  settledFit?: boolean;
  /** You panned or zoomed yourself: the view is no longer fitted automatically. */
  moved?: boolean;
  hover?: GNode | null;
  selected: string;
  w: number;
  h: number;
  dpr: number;
  draw: () => void;
  fit: () => void;
  kick: (a?: number) => void;
};

/** Bigger for well-linked notes; the Index and project notes a bit bigger still. */
export const radius = (n: GNode) =>
  3.5 + Math.min(9, Math.sqrt(n.deg) * 1.6) + (n.type === 'index' || n.type === 'project' ? 3 : 0);

/** Nodes keep their place from the previous layout; new ones start on a sunflower spiral. */
export function makeNodes(graph: GraphData, prev: Map<string, GNode>): GNode[] {
  const count = graph.nodes.length;
  const R = Math.sqrt(count) * 34 + 60;
  return graph.nodes.map((n, i) => {
    const o = prev.get(n.id);
    const a = i * 2.399963;
    const r = R * Math.sqrt((i + 0.5) / Math.max(1, count));
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      key: n.key,
      x: o?.x ?? Math.cos(a) * r,
      y: o?.y ?? Math.sin(a) * r,
      vx: 0,
      vy: 0,
      deg: 0,
    };
  });
}

/** The links as node pairs; counts each node's links (deg). */
export function linkNodes(graph: GraphData, byId: Map<string, GNode>) {
  const edges = graph.edges
    .map(([a, b]) => [byId.get(a)!, byId.get(b)!])
    .filter(([a, b]) => a && b) as [GNode, GNode][];
  for (const [a, b] of edges) {
    a.deg++;
    b.deg++;
  }
  return edges;
}

/** The view that shows every node, with a margin (zoom between 0.15 and 2.2). */
export function fitView(s: Sim) {
  if (!s.nodes.length) return;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const n of s.nodes) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x);
    y1 = Math.max(y1, n.y);
  }
  const k = Math.min(2.2, Math.max(0.15, Math.min(s.w / (x1 - x0 + 120), s.h / (y1 - y0 + 120))));
  s.view = { k, x: s.w / 2 - ((x0 + x1) / 2) * k, y: s.h / 2 - ((y0 + y1) / 2) * k };
}

const CELL = 150;

/** Nearby nodes push apart. Grid buckets keep this fast for hundreds of notes. */
function repel(s: Sim) {
  const grid = new Map<string, GNode[]>();
  for (const n of s.nodes) {
    const k = `${Math.floor(n.x / CELL)},${Math.floor(n.y / CELL)}`;
    (grid.get(k) || grid.set(k, []).get(k)!).push(n);
  }
  for (const n of s.nodes) {
    const cx = Math.floor(n.x / CELL);
    const cy = Math.floor(n.y / CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const m of grid.get(`${cx + dx},${cy + dy}`) || []) push(s, n, m);
  }
}

function push(s: Sim, n: GNode, m: GNode) {
  if (m === n) return;
  let ddx = n.x - m.x;
  let ddy = n.y - m.y;
  let d2 = ddx * ddx + ddy * ddy;
  if (d2 < 0.01) {
    ddx = Math.random() - 0.5;
    ddy = Math.random() - 0.5;
    d2 = 0.5;
  }
  if (d2 > CELL * CELL) return;
  const f = (2600 / d2) * s.alpha;
  n.vx += ddx * f * 0.06;
  n.vy += ddy * f * 0.06;
}

/** Linked nodes pull towards 85 px apart. */
function springs(s: Sim) {
  for (const [a, b] of s.edges) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = ((d - 85) / d) * 0.035 * s.alpha;
    a.vx += dx * f;
    a.vy += dy * f;
    b.vx -= dx * f;
    b.vy -= dy * f;
  }
}

/** A pull to the middle, friction, and the move (at most 20 px a step); a dragged node stays put. */
function moveNodes(s: Sim) {
  for (const n of s.nodes) {
    n.vx -= n.x * 0.0015 * s.alpha;
    n.vy -= n.y * 0.0015 * s.alpha;
    if (n === s.drag?.node) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx *= 0.82;
    n.vy *= 0.82;
    n.x += Math.max(-20, Math.min(20, n.vx));
    n.y += Math.max(-20, Math.min(20, n.vy));
  }
}

export function step(s: Sim) {
  repel(s);
  springs(s);
  moveNodes(s);
  s.alpha *= 0.985;
}

/** Zooms by a factor around the middle of the canvas (between 0.08 and 4). */
export function zoomBy(s: Sim, f: number) {
  s.moved = true;
  const k = Math.min(4, Math.max(0.08, s.view.k * f));
  const cx = s.w / 2;
  const cy = s.h / 2;
  s.view = {
    k,
    x: cx - ((cx - s.view.x) / s.view.k) * k,
    y: cy - ((cy - s.view.y) / s.view.k) * k,
  };
  s.draw();
}

'use client';
// Where wires attach to nodes, and the curves drawn between them.
import type { FNode, Pt } from './model';
import { HEAD, ROW } from './model';
import type { Edge } from './graph';

/** A wire that leaves to the right and arrives from the left. */
export const hpath = (a: Pt, b: Pt) => {
  const d = Math.max(50, Math.abs(b.x - a.x) / 2);
  return `M${a.x},${a.y} C${a.x + d},${a.y} ${b.x - d},${b.y} ${b.x},${b.y}`;
};
/** A wire that leaves downwards and arrives from above (fallbacks between providers). */
export const vpath = (a: Pt, b: Pt) => {
  const d = Math.max(24, Math.abs(b.y - a.y) / 2);
  return `M${a.x},${a.y} C${a.x},${a.y + d} ${b.x},${b.y - d} ${b.x},${b.y}`;
};

/** The ports of every node, given where the nodes are now. */
export function makePorts(byId: Record<string, FNode>, at: (id: string) => Pt) {
  /** Right side; for a task group, the row of that task. */
  const outP = (id: string, row?: string): Pt => {
    const n = byId[id];
    const p = at(id);
    if (n.kind !== 'group') return { x: p.x + n.w, y: p.y + n.h / 2 };
    const i = Math.max(
      0,
      (n.rows || []).findIndex((t) => t.id === row),
    );
    return { x: p.x + n.w, y: p.y + HEAD + i * ROW + ROW / 2 };
  };
  const inP = (id: string): Pt => {
    const p = at(id);
    return { x: p.x, y: p.y + byId[id].h / 2 };
  };
  const botP = (id: string): Pt => {
    const p = at(id);
    return { x: p.x + byId[id].w / 2, y: p.y + byId[id].h };
  };
  const topP = (id: string): Pt => {
    const p = at(id);
    return { x: p.x + byId[id].w / 2, y: p.y };
  };
  return { outP, inP, botP, topP };
}
export type Ports = ReturnType<typeof makePorts>;

export function edgePath(e: Edge, p: Ports) {
  if (e.kind === 'fallback') return vpath(p.botP(e.from), p.topP(e.to));
  return hpath(e.kind === 'route' ? p.outP(e.from, e.task) : p.outP(e.from), p.inP(e.to));
}

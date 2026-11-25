// Where the wires of the status flow run: forward moves go from a status' right side to the next
// one's left side (under any status in between), backward moves arc over the top.
import { hpath } from '../AiFlow/geometry';
import { NODE_W, NODE_H, LABEL_H, type FlowNode } from './flow-graph';

type Pt = { x: number; y: number };
/** The wire, its arrowhead and the point in its middle. */
type Line = { d: string; head: string; mid: Pt };

const IN_GAP = 6;
export const outPort = (n: Pt): Pt => ({ x: n.x + NODE_W, y: n.y + NODE_H / 2 });

/** A move to a status further left. */
const isBack = (a: FlowNode, b: FlowNode) => b.x < a.x - NODE_W / 2;

/** The statuses a straight wire from `p` to `q` would run behind. */
const between = (p: Pt, q: Pt, a: FlowNode, b: FlowNode, all: FlowNode[]) =>
  all.filter((n) => {
    if (n.id === a.id || n.id === b.id || n.x < p.x || n.x + NODE_W > q.x) return false;
    const t = (n.x + NODE_W / 2 - p.x) / (q.x - p.x);
    return Math.abs(p.y + (q.y - p.y) * t - (n.y + NODE_H / 2)) < NODE_H / 2;
  });

/** Down, along below `low` and up again. */
function underLine(p: Pt, q: Pt, low: number): string {
  const [x1, x2] = [p.x + 84, q.x - 84];
  const end = q.x - 7;
  return `M${p.x},${p.y} C${p.x + 64},${p.y} ${x1 - 64},${low} ${x1},${low} L${x2},${low} C${x2 + 64},${low} ${end - 64},${q.y} ${end},${q.y}`;
}

export function flowLine(a: FlowNode, b: FlowNode, all: FlowNode[]): Line {
  if (isBack(a, b)) {
    const p = { x: a.x + NODE_W * 0.3, y: a.y };
    const q = { x: b.x + NODE_W * 0.7, y: b.y - 2 };
    const top = Math.min(p.y, q.y) - 48 - Math.min(80, Math.abs(p.x - q.x) * 0.1);
    return {
      d: `M${p.x},${p.y} C${p.x},${top} ${q.x},${top} ${q.x},${q.y - 7}`,
      head: `M${q.x - 4.5},${q.y - 8} L${q.x + 4.5},${q.y - 8} L${q.x},${q.y} z`,
      mid: { x: (p.x + q.x) / 2, y: (p.y + q.y + 6 * top) / 8 },
    };
  }
  const p = outPort(a);
  const q = { x: b.x - IN_GAP, y: b.y + NODE_H / 2 };
  const head = `M${q.x - 8},${q.y - 4.5} L${q.x - 8},${q.y + 4.5} L${q.x},${q.y} z`;
  const over = between(p, q, a, b, all);
  if (over.length) {
    // deeper the more it skips, so two of these don't share a line
    const low = Math.max(...over.map((n) => n.y)) + NODE_H + LABEL_H + 6 + over.length * 20;
    return { d: underLine(p, q, low), head, mid: { x: (p.x + q.x) / 2, y: low } };
  }
  return {
    d: hpath(p, { x: q.x - 7, y: q.y }),
    head,
    mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
  };
}
/** The wire being drawn, from a status to the pointer. */
export const ghostLine = (a: Pt, cur: Pt) => hpath(outPort(a), cur);

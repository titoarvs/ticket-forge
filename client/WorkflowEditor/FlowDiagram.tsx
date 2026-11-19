'use client';
import { type Any, wCls } from '../core';

const NODE_W = 132,
  NODE_H = 38,
  GAP = 60,
  PAD = 16;
const short = (s: string, n = 17) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Each status can move to the one before and after it. A sensible start for a custom workflow. */
export function stepByStep(wf: Any[]) {
  wf.forEach((w, i) => {
    w.next = [wf[i - 1]?.id, wf[i + 1]?.id].filter(Boolean);
    w.fromAny = false;
  });
}
/**
 * The workflow as a diagram: statuses in board order; forward moves arc above, backward moves
 * below.
 */
export function FlowDiagram({ wf, free }: { wf: Any[]; free: boolean }) {
  const cx = (i: number) => PAD + i * (NODE_W + GAP) + NODE_W / 2;
  const edges: { a: number; b: number }[] = [];
  if (!free)
    wf.forEach((w, i) =>
      (w.next || []).forEach((id: string) => {
        const j = wf.findIndex((x) => x.id === id);
        if (j >= 0 && j !== i) edges.push({ a: i, b: j });
      }),
    );
  const lift = (a: number, b: number) =>
    Math.abs(b - a) === 1 ? 0 : 22 + (Math.abs(b - a) - 2) * 16;
  const up = Math.max(0, ...edges.filter((e) => e.b > e.a).map((e) => lift(e.a, e.b)));
  const down = Math.max(0, ...edges.filter((e) => e.b < e.a).map((e) => lift(e.a, e.b)));
  const anyH = !free && wf.some((w) => w.fromAny) ? 26 : 0;
  const top = PAD + anyH + up,
    W = PAD * 2 + wf.length * NODE_W + (wf.length - 1) * GAP,
    H = top + NODE_H + down + PAD;
  const path = ({ a, b }: { a: number; b: number }) => {
    const fwd = b > a,
      h = lift(a, b);
    if (!h) {
      // neighbours: straight arrows between the boxes, forward above the middle, back below it
      const y = top + NODE_H / 2 + (fwd ? -7 : 7);
      const x1 = fwd ? cx(a) + NODE_W / 2 : cx(a) - NODE_W / 2,
        x2 = fwd ? cx(b) - NODE_W / 2 - 3 : cx(b) + NODE_W / 2 + 3;
      return `M${x1},${y} L${x2},${y}`;
    }
    const y = fwd ? top : top + NODE_H,
      dir = fwd ? -1 : 1,
      x1 = cx(a) + (fwd ? 14 : -14),
      x2 = cx(b) + (fwd ? -14 : 14);
    return `M${x1},${y} C${x1},${y + dir * h * 1.3} ${x2},${y + dir * h * 1.3} ${x2},${y + dir * 3}`;
  };
  return (
    <div
      className="wf-diagram"
      role="img"
      aria-label={
        free
          ? 'Any status can move to any status'
          : `Workflow: ${wf.map((w) => `${w.name} can move to ${[...(w.next || []).map((id: string) => wf.find((x) => x.id === id)?.name)].filter(Boolean).join(', ') || 'no other status'}`).join('. ')}`
      }
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <marker
            id="wf-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>
        {free && wf.length > 1 && (
          <text x={W / 2} y={top - 8} textAnchor="middle" className="wf-free">
            Any status can move to any other status
          </text>
        )}
        {edges.map((e, k) => (
          <path
            key={k}
            d={path(e)}
            className={`wf-edge ${e.b > e.a ? 'fwd' : 'back'}`}
            markerEnd="url(#wf-arrow)"
          />
        ))}
        {wf.map((w, i) => (
          <g key={w.id}>
            {!free && w.fromAny && (
              <g className="wf-any">
                <text x={cx(i)} y={top - up - 12} textAnchor="middle">
                  ALL
                </text>
                <path
                  d={`M${cx(i)},${top - up - 7} L${cx(i)},${top - 3}`}
                  markerEnd="url(#wf-arrow)"
                />
              </g>
            )}
            <rect
              x={cx(i) - NODE_W / 2}
              y={top}
              width={NODE_W}
              height={NODE_H}
              rx={6}
              className={`wf-node c-${w.category} ${wCls(w)}`}
            />
            <text
              x={cx(i)}
              y={top + NODE_H / 2 + 4}
              textAnchor="middle"
              className={`wf-label c-${w.category} ${wCls(w)}`}
            >
              {short(w.name.toUpperCase())}
            </text>
            <title>{w.name}</title>
          </g>
        ))}
      </svg>
    </div>
  );
}

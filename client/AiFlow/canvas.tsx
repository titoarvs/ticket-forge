'use client';
// The canvas itself: the wires, the nodes, and the wire being drawn.
import type { FNode } from './model';
import { type Edge, canWire, nodeState, nodeLabel } from './graph';
import { type Ports, edgePath, hpath, vpath } from './geometry';
import type { Flow } from './flow';
import type { Viewport } from './use-viewport';
import type { Wiring, usePointer } from './use-pointer';
import { NodeFace } from './faces';

type Pointer = ReturnType<typeof usePointer>;
type CanvasProps = {
  f: Flow;
  v: Viewport;
  ptr: Pointer;
  edges: Edge[];
  ports: Ports;
  smooth: boolean;
};

/** The node a wire being drawn would connect to, or ''. */
const dropTarget = (f: Flow, conn: Wiring) =>
  conn && conn.over && canWire(f.g, conn.from, conn.over) ? conn.over : '';

function Wires({ f, edges, ports, conn }: { f: Flow; edges: Edge[]; ports: Ports; conn: Wiring }) {
  const ghostPath = () => {
    if (conn.from.kind === 'task')
      return hpath(ports.outP(conn.from.node, conn.from.row), conn.cur);
    return vpath(ports.botP(conn.from.node), conn.cur);
  };
  return (
    <svg className="flow-wires" width="1" height="1" aria-hidden>
      {edges.map((e) => {
        const d = edgePath(e, ports);
        const on = f.sel?.type === 'edge' && f.sel.id === e.id;
        const dim = (e.kind === 'route' || e.kind === 'tier') && !f.routing.on;
        return (
          <g
            key={e.id}
            className={`fw ${e.kind} ${on ? 'on' : ''} ${dim ? 'dim' : ''}`}
            style={{ ['--c' as string]: e.color } as React.CSSProperties}
          >
            <path className="fw-line" d={d} />
            <path
              className="fw-hit"
              d={d}
              data-edge={e.id}
              onClick={() => f.setSel({ type: 'edge', id: e.id })}
            />
          </g>
        );
      })}
      {conn && <path className={`fw-ghost ${dropTarget(f, conn) ? 'ok' : ''}`} d={ghostPath()} />}
    </svg>
  );
}

function NodeBox({ f, v, n, conn }: { f: Flow; v: Viewport; n: FNode; conn: Wiring }) {
  const p = v.at(n.id);
  const st = nodeState(f.c, n);
  const cls = [
    'fn',
    `k-${n.kind}`,
    f.sel?.type === 'node' && f.sel.id === n.id ? 'sel' : '',
    st.k ? `s-${st.k}` : '',
    conn && canWire(f.g, conn.from, n.id) ? 'drop-ok' : '',
    dropTarget(f, conn) === n.id ? 'drop-over' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={cls}
      data-node={n.id}
      role="group"
      aria-label={nodeLabel(n)}
      tabIndex={n.kind === 'add' ? -1 : 0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && n.kind !== 'add' && e.target === e.currentTarget)
          f.setSel({ type: 'node', id: n.id });
      }}
      style={{
        left: p.x,
        top: p.y,
        width: n.w,
        height: n.kind === 'group' ? undefined : n.h,
        minHeight: n.h,
      }}
    >
      <NodeFace n={n} f={f} />
    </div>
  );
}

/** The × in the middle of a selected task wire: back to the task's default tier. */
function DisconnectButton({ f, edge, ports }: { f: Flow; edge: Edge; ports: Ports }) {
  const a = ports.outP(edge.from, edge.task);
  const b = ports.inP(edge.to);
  return (
    <button
      type="button"
      className="flow-edge-x"
      style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 }}
      onClick={() => f.routing.resetTask(edge.task!)}
      aria-label="Disconnect: back to the default"
      title="Disconnect: back to the default"
    >
      ×
    </button>
  );
}

export function FlowCanvas({ f, v, ptr, edges, ports, smooth }: CanvasProps) {
  const { view } = v;
  const selEdge = f.sel?.type === 'edge' ? edges.find((e) => e.id === f.sel!.id) : null;
  return (
    <div
      className="flow-vp"
      ref={v.vp}
      onPointerDown={ptr.down}
      onPointerMove={ptr.move}
      onPointerUp={ptr.up}
      onPointerCancel={ptr.up}
      style={{
        backgroundSize: `${22 * view.k}px ${22 * view.k}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      <div
        className={`flow-world ${smooth ? 'smooth' : ''}`}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
        <Wires f={f} edges={edges} ports={ports} conn={ptr.conn} />
        {f.g.nodes.map((n) => (
          <NodeBox key={n.id} f={f} v={v} n={n} conn={ptr.conn} />
        ))}
        {selEdge?.kind === 'route' && <DisconnectButton f={f} edge={selEdge} ports={ports} />}
      </div>
    </div>
  );
}

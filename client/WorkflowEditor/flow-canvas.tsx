'use client';
// The status flow canvas: a tile per status, a wire per allowed move, and the wire being drawn.
import { useState } from 'react';
import { Ico, I } from '../ui';
import type { Viewport } from '../AiFlow/use-viewport';
import type { Wiring, usePointer } from '../AiFlow/use-pointer';
import { NODE_W, NODE_H, type FlowEdge, type FlowNode } from './flow-graph';
import { flowLine, ghostLine } from './flow-lines';
import { type Editor, catLabel, glyph, tint } from './flow-model';

export type WireStart = { node: string };
type Pointer = ReturnType<typeof usePointer<WireStart>>;

/** A wire may go to any other status it doesn't reach yet. */
export const canMove = (x: Editor, from: string, to: string) =>
  from !== to && Boolean(x.node(to)) && !x.draft.edges.some((e) => e.from === from && e.to === to);

const same = (a: FlowEdge | null, b: FlowEdge) => Boolean(a && a.from === b.from && a.to === b.to);

function Wire({
  x,
  e,
  hover,
  setHover,
}: {
  x: Editor;
  e: FlowEdge;
  hover: boolean;
  setHover: (e: FlowEdge | null) => void;
}) {
  const a = x.node(e.from);
  const b = x.node(e.to);
  if (!a || !b) return null;
  const on = x.sel?.kind === 'edge' && same(x.sel, e);
  const hot = x.sel?.kind === 'node' && x.sel.id === e.from;
  const l = flowLine(a, b, x.draft.nodes);
  const cls = ['wm', on && 'on', hot && 'hot', hover && 'hover', x.free && 'guide'];
  const select = () => x.setSel({ kind: 'edge', ...e });
  return (
    <g className={cls.filter(Boolean).join(' ')}>
      <path className="wm-line" d={l.d} />
      <path className="wm-head" d={l.head} />
      <path
        className="wm-hit"
        d={l.d}
        data-edge={`${e.from}>${e.to}`}
        role="button"
        tabIndex={0}
        aria-pressed={on}
        aria-label={`Transition: ${a.name} can move to ${b.name}`}
        onClick={select}
        onKeyDown={(k) => {
          if (k.key !== 'Enter' && k.key !== ' ') return;
          k.preventDefault();
          select();
        }}
        onPointerEnter={() => setHover(e)}
        onPointerLeave={() => setHover(null)}
      />
    </g>
  );
}

/** Insert and remove, in the middle of the wire the pointer is on (or the selected one). */
function WireTools({
  x,
  e,
  setHover,
}: {
  x: Editor;
  e: FlowEdge;
  setHover: (e: FlowEdge | null) => void;
}) {
  const a = x.node(e.from);
  const b = x.node(e.to);
  if (!a || !b) return null;
  const { mid } = flowLine(a, b, x.draft.nodes);
  return (
    <div
      className="wm-tools"
      data-nodrag
      style={{ left: mid.x, top: mid.y }}
      onPointerEnter={() => setHover(e)}
      onPointerLeave={() => setHover(null)}
    >
      <button
        type="button"
        title="Add a status here"
        aria-label={`Add a status between ${a.name} and ${b.name}`}
        onClick={() => x.setAdding({ edge: e })}
      >
        <Ico svg={I.plus} />
      </button>
      <button
        type="button"
        title="Remove transition"
        aria-label={`Remove the transition from ${a.name} to ${b.name}`}
        onClick={() => x.remove({ kind: 'edge', ...e })}
      >
        <Ico svg={I.trash} />
      </button>
    </div>
  );
}

function StatusNode({
  x,
  n,
  start,
  stuck,
  conn,
}: {
  x: Editor;
  n: FlowNode;
  start: boolean;
  stuck: boolean;
  conn: Wiring<WireStart>;
}) {
  const w = x.look(n);
  const { className, style } = tint(w);
  const on = x.sel?.kind === 'node' && x.sel.id === n.id;
  const ok = Boolean(conn && canMove(x, conn.from.node, n.id));
  const leaf = !x.draft.edges.some((e) => e.from === n.id);
  const count = x.issues(n.id);
  const cls = ['wfn', on && 'sel', start && 'start', ok && 'drop-ok'];
  if (ok && conn?.over === n.id) cls.push('drop-over');
  const openAdd = (e: React.MouseEvent) => {
    // the pointer is handled by the canvas; this is for the keyboard
    if (e.detail === 0) x.setAdding({ after: n.id });
  };
  return (
    <div
      className={cls.filter(Boolean).join(' ')}
      data-node={n.id}
      data-status={n.name}
      role="button"
      aria-pressed={on}
      aria-label={`Status ${n.name || 'without a name'}, ${catLabel(n.category)}, ${count} ${count === 1 ? 'issue' : 'issues'}`}
      tabIndex={0}
      style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        const step = {
          ArrowLeft: [-16, 0],
          ArrowRight: [16, 0],
          ArrowUp: [0, -16],
          ArrowDown: [0, 16],
        }[e.key];
        if (step && x.ed) {
          e.preventDefault();
          x.patch(n.id, { x: n.x + step[0], y: n.y + step[1] });
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          x.setSel({ kind: 'node', id: n.id });
        }
      }}
    >
      <span className={`wfn-tile ${className}`} style={style}>
        <Ico svg={glyph(w)} />
        {stuck && (
          <span className="wfn-warn" title="No way out: issues here can’t move to any other status">
            <Ico svg={I.warn} />
          </span>
        )}
      </span>
      {!x.free && w.fromAny && (
        <span className="wfn-any" title="Issues can move here from any status">
          Any
        </span>
      )}
      <span className="wfn-in" />
      {x.ed && leaf ? (
        <span className="wfn-stub">
          <i />
          <button
            type="button"
            data-port="out"
            data-node={n.id}
            title="Click to add a status, or drag to connect"
            aria-label={`Add a status after ${n.name}`}
            onClick={openAdd}
          >
            <Ico svg={I.plus} />
          </button>
        </span>
      ) : null}
      <span
        className="wfn-out"
        data-port={x.ed ? 'out' : undefined}
        data-node={n.id}
        title={x.ed ? 'Drag to another status to connect, or click to add one' : undefined}
      />
      <span className="wfn-label">
        <b>{n.name || 'No name'}</b>
        <small>
          {count} {count === 1 ? 'issue' : 'issues'}
          {w.wip ? ` · limit ${w.wip}` : ''}
        </small>
      </span>
    </div>
  );
}

export function StatusCanvas({
  x,
  v,
  ptr,
  smooth,
}: {
  x: Editor;
  v: Viewport;
  ptr: Pointer;
  smooth: boolean;
}) {
  const [hover, setHover] = useState<FlowEdge | null>(null);
  const { view } = v;
  const { draft, sel } = x;
  const tools = hover || (sel?.kind === 'edge' ? { from: sel.from, to: sel.to } : null);
  const shown = x.ed && !ptr.conn && tools && draft.edges.find((e) => same(tools, e));
  const dots = (view.k < 0.5 ? 40 : 20) * view.k;
  const from = ptr.conn && x.node(ptr.conn.from.node);
  const open = (id: string) => draft.nodes.some((o) => o.id !== id && x.look(o).fromAny);
  return (
    <div
      className="flow-vp"
      ref={v.vp}
      onPointerDown={ptr.down}
      onPointerMove={ptr.move}
      onPointerUp={ptr.up}
      onPointerCancel={ptr.up}
      style={{
        backgroundSize: `${dots}px ${dots}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      <div
        className={`flow-world ${smooth ? 'smooth' : ''}`}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
        <svg className="flow-wires" width="1" height="1">
          {draft.edges.map((e) => (
            <Wire
              key={`${e.from}>${e.to}`}
              x={x}
              e={e}
              hover={same(hover, e)}
              setHover={setHover}
            />
          ))}
          {from && ptr.conn && (
            <path
              className={`fw-ghost ${ptr.conn.over && canMove(x, from.id, ptr.conn.over) ? 'ok' : ''}`}
              d={ghostLine(from, ptr.conn.cur)}
            />
          )}
        </svg>
        {draft.nodes.map((n, i) => (
          <StatusNode
            key={n.id}
            x={x}
            n={n}
            start={i === 0}
            stuck={!x.free && !draft.edges.some((e) => e.from === n.id) && !open(n.id)}
            conn={ptr.conn}
          />
        ))}
        {shown && <WireTools x={x} e={shown} setHover={setHover} />}
      </div>
    </div>
  );
}

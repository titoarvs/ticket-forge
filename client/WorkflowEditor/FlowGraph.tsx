'use client';
// TF-141: the project's status flow as an interactive node graph (Project settings → Workflow).
// Everyone who can open the project sees it; only people with "Edit project settings" get the
// controls. Edits are a draft until "Save flow", which writes the project's workflow (statuses and
// their transitions) through the same save as the rest of the settings.
import { useRef, useState, type PointerEvent } from 'react';
import {
  P,
  type Any,
  can,
  toast,
  mutate,
  openModal,
  setField,
  uid,
  CATEGORIES,
  wCls,
} from '../core';
import { Confirm, SetCard, Ico, I } from '../ui';
import { SF, MenuItem, TF } from '../fields';
import {
  NODE_W,
  NODE_H,
  type FlowDraft,
  type FlowNode,
  toDraft,
  addNode,
  renameNode,
  removeNode,
  connect,
  removeEdge,
  checkDraft,
  sameDraft,
  applyDraft,
} from './flow-graph';

type Sel = { kind: 'node'; id: string } | { kind: 'edge'; from: string; to: string } | null;

const short = (s: string, n = 17) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The line from one box to another, ending at the box edges; moves both ways are split apart. */
function edgeLine(a: FlowNode, b: FlowNode, both: boolean) {
  const ax = a.x + NODE_W / 2,
    ay = a.y + NODE_H / 2,
    bx = b.x + NODE_W / 2,
    by = b.y + NODE_H / 2;
  const dx = bx - ax,
    dy = by - ay,
    len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (both ? 6 : 0),
    ny = (dx / len) * (both ? 6 : 0);
  // where the centre-to-centre line leaves a box
  const clip = (sx: number, sy: number) => {
    const t = Math.min(
      sx ? NODE_W / 2 / Math.abs(sx) : Infinity,
      sy ? NODE_H / 2 / Math.abs(sy) : Infinity,
    );
    return [sx * t, sy * t];
  };
  const [ox, oy] = clip(dx, dy),
    [ix, iy] = clip(-dx, -dy);
  return { x1: ax + ox + nx, y1: ay + oy + ny, x2: bx + ix + nx, y2: by + iy + ny };
}

export function FlowGraph() {
  const p = P();
  const wf: Any[] = p.workflow;
  const ed = can('project.settings');
  const saved = toDraft(wf);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<FlowDraft>(saved);
  const [base, setBase] = useState(savedKey);
  // The project changed underneath (a teammate, or the Statuses table): follow it unless there are
  // unsaved edits here.
  if (savedKey !== base) {
    setBase(savedKey);
    if (JSON.stringify(draft) === base) setDraft(saved);
  }
  const [sel, setSel] = useState<Sel>(null);
  // connecting: the status the new move starts at
  const [from, setFrom] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const drag = useRef<{ id: string; sx: number; sy: number; x: number; y: number } | null>(null);
  const dirty = !sameDraft(draft, saved);
  const free = p.flowMode !== 'custom';
  const node = (id: string) => draft.nodes.find((n) => n.id === id);
  const selNode = sel?.kind === 'node' ? node(sel.id) : undefined;
  const edit = (d: FlowDraft) => {
    setDraft(d);
    setError('');
  };

  const W = Math.max(640, ...draft.nodes.map((n) => n.x + NODE_W + 16));
  const H = Math.max(120, ...draft.nodes.map((n) => n.y + NODE_H + 16));

  const add = () => {
    if (!ed) return;
    if (!name.trim()) {
      setError('Type a name for the new status.');
      return;
    }
    const id = uid();
    edit(addNode(draft, id, name.trim()));
    setSel({ kind: 'node', id });
    setName('');
  };
  const pick = (id: string) => {
    if (ed && from && from !== id) {
      edit(connect(draft, from, id));
      setSel({ kind: 'edge', from, to: id });
      setFrom(null);
      return;
    }
    setFrom(null);
    setSel({ kind: 'node', id });
  };
  const remove = () => {
    if (!ed || !sel) return;
    if (sel.kind === 'edge') {
      const a = node(sel.from)?.name,
        b = node(sel.to)?.name;
      openModal(
        <Confirm
          title="Remove this transition?"
          label="Remove transition"
          text={`Issues can no longer move from “${a}” to “${b}”. This is saved when you press Save flow.`}
          onYes={() => {
            edit(removeEdge(draft, sel.from, sel.to));
            setSel(null);
          }}
        />,
      );
    } else if (selNode) {
      const n = p.tickets.filter((t: Any) => t.status === selNode.name).length;
      const moves = draft.edges.filter((e) => e.from === selNode.id || e.to === selNode.id).length;
      openModal(
        <Confirm
          title={`Delete status “${selNode.name}”?`}
          label="Delete status"
          text={`${moves ? `Its ${moves} transition${moves === 1 ? '' : 's'} will be removed too. ` : ''}${n ? `${n} issue${n === 1 ? '' : 's'} will move to another status. ` : ''}This is saved when you press Save flow.`}
          onYes={() => {
            edit(removeNode(draft, selNode.id));
            setSel(null);
            setFrom(null);
          }}
        />,
      );
    }
  };
  const save = () => {
    if (!ed) return;
    const msg = checkDraft(draft);
    if (msg) {
      setError(msg);
      toast(msg, 'err');
      return;
    }
    const out = applyDraft(wf, draft);
    mutate((pp) => {
      pp.tickets.forEach((t: Any) => {
        const r = out.renamed.find((x) => x.from === t.status);
        if (r) t.status = r.to;
        else {
          const m = out.removed.find((x) => x.from === t.status);
          if (m && m.to) setField(t, 'status', m.to);
        }
      });
      pp.workflow = out.workflow;
    });
    setError('');
    toast('Status flow saved.');
  };

  // dragging a status (editors only)
  const down = (e: PointerEvent, n: FlowNode) => {
    pick(n.id);
    if (!ed || from) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: n.id, sx: e.clientX, sy: e.clientY, x: n.x, y: n.y };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const x = Math.max(0, Math.round(d.x + e.clientX - d.sx)),
      y = Math.max(0, Math.round(d.y + e.clientY - d.sy));
    setDraft((cur) => renameNode(cur, d.id, { x, y }));
  };

  return (
    <SetCard
      id="status-flow"
      title="Status flow"
      desc={
        ed
          ? 'Each status is a node and each allowed move an arrow. Add statuses, connect them, then save the flow.'
          : 'Each status is a node and each allowed move an arrow. You can view the flow; changing it needs the “Edit project settings” permission.'
      }
      right={<span className="muted small">{draft.nodes.length} statuses</span>}
    >
      {ed && (
        <div className="row flow-bar" style={{ gap: 6, marginBottom: 8 }}>
          <TF
            size="small"
            aria-label="New status name"
            placeholder="New status name"
            value={name}
            onChange={(e: Any) => setName(e.target.value)}
            onKeyDown={(e: Any) => e.key === 'Enter' && add()}
          />
          <button className="btn sm" onClick={add}>
            <Ico svg={I.plus} />
            Add status
          </button>
          <button
            className={`btn sm ${from ? 'primary' : ''}`}
            disabled={!selNode}
            aria-pressed={Boolean(from)}
            title="Pick a status, press Connect, then click the status it can move to"
            onClick={() => setFrom(from ? null : selNode!.id)}
          >
            <Ico svg={I.link} />
            {from ? 'Click the target status…' : 'Connect'}
          </button>
          <button className="btn sm" disabled={!sel} onClick={remove}>
            <Ico svg={I.trash} />
            Remove
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn sm subtle" disabled={!dirty} onClick={() => edit(saved)}>
            Discard changes
          </button>
          <button className="btn sm primary" disabled={!dirty} onClick={save}>
            Save flow
          </button>
        </div>
      )}
      {error && (
        <p className="small wf-warn" role="alert">
          <Ico svg={I.warn} /> {error}
        </p>
      )}
      <div
        className="wf-diagram flow-canvas"
        role="group"
        aria-label={`Status flow: ${draft.nodes.length} statuses, ${draft.edges.length} transitions`}
      >
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          onPointerMove={move}
          onPointerUp={() => (drag.current = null)}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSel(null);
              setFrom(null);
            }
          }}
        >
          <defs>
            <marker
              id="flow-arrow"
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
          {draft.edges.map((e) => {
            const a = node(e.from),
              b = node(e.to);
            if (!a || !b) return null;
            const l = edgeLine(
              a,
              b,
              draft.edges.some((x) => x.from === e.to && x.to === e.from),
            );
            const on = sel?.kind === 'edge' && sel.from === e.from && sel.to === e.to;
            return (
              <g
                key={`${e.from}>${e.to}`}
                className={`flow-edge ${on ? 'on' : ''}`}
                role="img"
                aria-label={`${a.name} can move to ${b.name}`}
                tabIndex={ed ? 0 : undefined}
                onKeyDown={(k) => k.key === 'Enter' && setSel({ kind: 'edge', ...e })}
                onClick={() => setSel({ kind: 'edge', ...e })}
              >
                <line {...l} className="flow-hit" />
                <line {...l} className="wf-edge" markerEnd="url(#flow-arrow)" />
              </g>
            );
          })}
          {draft.nodes.map((n) => {
            const on = sel?.kind === 'node' && sel.id === n.id;
            const w = wf.find((x) => x.id === n.id) || { category: n.category };
            return (
              <g
                key={n.id}
                className={`flow-node ${on ? 'on' : ''} ${from === n.id ? 'from' : ''}`}
                data-status={n.name}
                tabIndex={0}
                role="button"
                aria-pressed={on}
                aria-label={`Status ${n.name}`}
                onPointerDown={(e) => down(e, n)}
                onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && pick(n.id)}
              >
                <rect
                  x={n.x}
                  y={n.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={6}
                  className={`wf-node c-${n.category} ${wCls({ ...w, category: n.category })}`}
                />
                <text
                  x={n.x + NODE_W / 2}
                  y={n.y + NODE_H / 2 + 4}
                  textAnchor="middle"
                  className={`wf-label c-${n.category} ${wCls({ ...w, category: n.category })}`}
                >
                  {short((n.name || '…').toUpperCase())}
                </text>
                <title>{n.name}</title>
              </g>
            );
          })}
        </svg>
      </div>
      {!draft.nodes.some((n) => draft.edges.some((e) => e.from === n.id || e.to === n.id)) &&
        draft.nodes.length > 0 && (
          <p className="muted small set-note">No transitions yet: every status stands on its own.</p>
        )}
      {ed && selNode && (
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <TF
            size="small"
            aria-label="Selected status name"
            value={selNode.name}
            onChange={(e: Any) => edit(renameNode(draft, selNode.id, { name: e.target.value }))}
          />
          <SF
            aria-label="Selected status category"
            value={selNode.category}
            onChange={(e: Any) => edit(renameNode(draft, selNode.id, { category: e.target.value }))}
          >
            {CATEGORIES.map(([v, l]) => (
              <MenuItem key={v} value={v}>
                {l}
              </MenuItem>
            ))}
          </SF>
        </div>
      )}
      {free && draft.edges.length > 0 && (
        <p className="muted small set-note">
          Transitions are saved with the flow, but moves are only limited to them when Transitions
          (below) is set to Custom.
        </p>
      )}
    </SetCard>
  );
}

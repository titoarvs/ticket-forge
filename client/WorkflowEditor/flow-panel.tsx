'use client';
// The panel beside the status flow canvas: add a status, or the details of what is selected.
import { type Any, CATEGORIES, statusColor } from '../core';
import { Ico, I } from '../ui';
import { SF, MenuItem, TF, CB } from '../fields';
import type { FlowEdge, FlowNode } from './flow-graph';
import { type Editor, glyph, tint } from './flow-model';
import { PRESETS } from './StatusColorPicker';

export const CAT_HINT: Record<string, string> = {
  todo: 'not started',
  inprogress: 'being worked on',
  done: 'counts as finished in progress, sprints and reports',
};
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function AddPanel({ x }: { x: Editor }) {
  const { after, edge } = x.adding!;
  const name = (id?: string) => (id && x.node(id)?.name) || '';
  const where = edge
    ? `Between “${name(edge.from)}” and “${name(edge.to)}”.`
    : after
      ? `Issues in “${name(after)}” can move to it.`
      : 'Connect it to other statuses after you add it.';
  return (
    <>
      <h4>Add a status</h4>
      <p className="muted small">What does it mean for an issue to be here? {where}</p>
      <div className="wfp-kinds">
        {CATEGORIES.map(([v, l]: Any, i: number) => (
          <button key={v} type="button" autoFocus={i === 0} onClick={() => x.add(v)}>
            <span className={`wfp-ico s-${v}`}>
              <Ico svg={glyph({ category: v })} />
            </span>
            <span>
              <b>{l}</b>
              <small>{upper(CAT_HINT[v])}</small>
            </span>
            <Ico svg={I.plus} />
          </button>
        ))}
      </div>
    </>
  );
}

function Colors({ x, n, cur }: { x: Editor; n: FlowNode; cur: string }) {
  return (
    <div className="wfp-colors" role="group" aria-label="Color">
      <button
        type="button"
        className={`wfp-default ${cur ? '' : 'on'}`}
        aria-pressed={!cur}
        disabled={!x.ed}
        onClick={() => x.patch(n.id, { color: null })}
      >
        Default
      </button>
      {PRESETS.map((c) => (
        <button
          key={c}
          type="button"
          className={`color-sw ${cur.toLowerCase() === c ? 'on' : ''}`}
          style={{ background: c }}
          title={c}
          aria-label={c}
          aria-pressed={cur.toLowerCase() === c}
          disabled={!x.ed}
          onClick={() => x.patch(n.id, { color: c })}
        />
      ))}
      <label className="wfp-custom" title="Custom color">
        <input
          type="color"
          aria-label="Custom color"
          disabled={!x.ed}
          value={cur || '#0c66e4'}
          onChange={(e) => x.patch(n.id, { color: e.target.value })}
        />
      </label>
    </div>
  );
}

function StatusPanel({ x, n }: { x: Editor; n: FlowNode }) {
  const w = x.look(n);
  const { className, style } = tint(w);
  const count = x.issues(n.id);
  const others = x.draft.nodes.filter((o) => o.id !== n.id);
  return (
    <>
      <h4>
        <span className={`wfp-ico ${className}`} style={style}>
          <Ico svg={glyph(w)} />
        </span>
        <span className="wfp-name">
          {n.name || 'No name'}
          <small>
            {count} {count === 1 ? 'issue' : 'issues'}
          </small>
        </span>
      </h4>
      <label className="field">
        <span>Name</span>
        <TF
          key={n.id}
          size="small"
          disabled={!x.ed}
          autoFocus={x.justAdded === n.id}
          onFocus={(e: Any) => x.justAdded === n.id && e.target.select()}
          aria-label="Selected status name"
          value={n.name}
          onChange={(e: Any) => x.patch(n.id, { name: e.target.value })}
        />
      </label>
      <div className="field">
        <span>Category</span>
        <SF
          disabled={!x.ed}
          aria-label="Selected status category"
          value={n.category}
          onChange={(e: Any) => x.patch(n.id, { category: e.target.value })}
        >
          {CATEGORIES.map(([v, l]: Any) => (
            <MenuItem key={v} value={v}>
              {l}
            </MenuItem>
          ))}
        </SF>
        <small className="muted">{upper(CAT_HINT[n.category] || '')}</small>
      </div>
      <div className="field">
        <span>Color</span>
        <Colors x={x} n={n} cur={statusColor(w)} />
      </div>
      <label className="field">
        <span>Column limit</span>
        <TF
          size="small"
          type="number"
          min={0}
          disabled={!x.ed}
          placeholder="None"
          aria-label={`Column limit of ${n.name}`}
          value={w.wip ?? ''}
          onChange={(e: Any) =>
            x.patch(n.id, { wip: Math.max(0, Math.round(Number(e.target.value))) || null })
          }
        />
      </label>
      <h5>Can move to</h5>
      <div className="wfp-moves">
        {others.map((o) => (
          <CB
            key={o.id}
            label={o.name || 'No name'}
            disabled={!x.ed}
            checked={x.draft.edges.some((e) => e.from === n.id && e.to === o.id)}
            onChange={(e: Any) =>
              e.target.checked ? x.connect(n.id, o.id) : x.disconnect(n.id, o.id)
            }
          />
        ))}
        {!others.length && <p className="muted small">This is the only status.</p>}
      </div>
      {!x.free && (
        <CB
          label="Issues can move here from any status"
          disabled={!x.ed}
          checked={Boolean(w.fromAny)}
          onChange={(e: Any) => x.patch(n.id, { fromAny: e.target.checked })}
        />
      )}
      {x.ed && (
        <button
          type="button"
          className="btn sm danger wfp-del"
          disabled={!others.length}
          onClick={() => x.remove({ kind: 'node', id: n.id })}
        >
          <Ico svg={I.trash} />
          Delete status
        </button>
      )}
    </>
  );
}

function MovePanel({ x, e }: { x: Editor; e: FlowEdge }) {
  const a = x.node(e.from)!;
  const b = x.node(e.to)!;
  const chip = (n: FlowNode) => {
    const { className, style } = tint(x.look(n));
    return (
      <span className={`loz ${className}`} style={style}>
        {n.name || 'No name'}
      </span>
    );
  };
  return (
    <>
      <h4>Transition</h4>
      <p className="wfp-route">
        {chip(a)}
        <Ico svg={I.right} />
        {chip(b)}
      </p>
      <p className="muted small">
        {x.free
          ? 'A guide for now: while Transitions is set to Any to any, issues can move between all statuses.'
          : `Issues in “${a.name}” can move to “${b.name}”.`}
      </p>
      {x.ed && (
        <div className="row wfp-acts">
          <button type="button" className="btn sm" onClick={() => x.setAdding({ edge: e })}>
            <Ico svg={I.plus} />
            Add a status here
          </button>
          <button
            type="button"
            className="btn sm danger"
            onClick={() => x.remove({ kind: 'edge', ...e })}
          >
            <Ico svg={I.trash} />
            Remove
          </button>
        </div>
      )}
    </>
  );
}

/** What the panel shows, or null when there is nothing to show. */
export function panelFor(x: Editor) {
  const { sel, adding } = x;
  if (adding && x.ed) return <AddPanel x={x} />;
  const n = sel?.kind === 'node' ? x.node(sel.id) : undefined;
  if (n) return <StatusPanel x={x} n={n} />;
  if (sel?.kind === 'edge') {
    const e = x.draft.edges.find((k) => k.from === sel.from && k.to === sel.to);
    if (e) return <MovePanel x={x} e={e} />;
  }
  return null;
}

'use client';
// TF-141: the project's status flow as a node canvas (Project settings → Workflow): drag tiles, draw
// wires between them, click one for its details. Everyone who can open the project sees it; only
// people with "Edit project settings" get the controls. Edits are a draft until "Save flow", which
// writes the project's workflow (statuses and their transitions) through the same save as the rest
// of the settings.
//   flow-graph.ts (the draft) · flow-lines.ts (the wires) · flow-canvas.tsx (drawing) ·
//   flow-panel.tsx (the details) · ../AiFlow/use-viewport.ts, use-pointer.ts (pan, zoom, drag).
import { useEffect, useState } from 'react';
import { P, type Any, can, toast, mutate, openModal, setField, uid } from '../core';
import { Confirm, SetCard, Ico, I } from '../ui';
import {
  type CanvasGraph,
  useViewport,
  useAutoFit,
  useWheelZoom,
  useFullScreenKeys,
  useGlideToSelection,
} from '../AiFlow/use-viewport';
import { usePointer } from '../AiFlow/use-pointer';
import { ZoomControls } from '../AiFlow/toolbar';
import {
  NODE_W,
  NODE_H,
  LABEL_H,
  type FlowDraft,
  toDraft,
  addNode,
  addAfter,
  insertOn,
  settle,
  tidy,
  freshName,
  renameNode,
  removeNode,
  connect,
  removeEdge,
  checkDraft,
  sameDraft,
  applyDraft,
} from './flow-graph';
import { type Adding, type Editor, type Sel, lookOf } from './flow-model';
import { type WireStart, StatusCanvas, canMove } from './flow-canvas';
import { panelFor } from './flow-panel';

/** The draft, and what keeps it in step with the project. */
function useDraft(wf: Any[]) {
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
  return { saved, draft, setDraft, dirty: !sameDraft(draft, saved) };
}

/** Asks before a status or a transition goes. */
function askRemove(x: Editor, s: Sel, yes: () => void) {
  if (s?.kind === 'edge') {
    const a = x.node(s.from)?.name;
    const b = x.node(s.to)?.name;
    openModal(
      <Confirm
        title="Remove this transition?"
        label="Remove transition"
        text={`Issues can no longer move from “${a}” to “${b}”. This is saved when you press Save flow.`}
        onYes={yes}
      />,
    );
    return;
  }
  const n = s && x.node(s.id);
  if (!n) return;
  const count = x.issues(n.id);
  const moves = x.draft.edges.filter((e) => e.from === n.id || e.to === n.id).length;
  openModal(
    <Confirm
      title={`Delete status “${n.name}”?`}
      label="Delete status"
      text={`${moves ? `Its ${moves} transition${moves === 1 ? '' : 's'} will be removed too. ` : ''}${count ? `${count} issue${count === 1 ? '' : 's'} will move to another status. ` : ''}This is saved when you press Save flow.`}
      onYes={yes}
    />,
  );
}

/** Saves the draft, moving the issues of renamed and removed statuses. Returns the new workflow. */
function saveFlow(wf: Any[], draft: FlowDraft) {
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
  toast('Status flow saved.');
  return out.workflow;
}

/** Everything the canvas and the panel can do to the draft. */
function useEditor(): Editor & {
  dirty: boolean;
  error: string;
  save(): void;
  discard(): void;
  arrange(): void;
} {
  const p = P();
  const wf: Any[] = p.workflow;
  const ed = can('project.settings');
  const { saved, draft, setDraft, dirty } = useDraft(wf);
  const [sel, pick] = useState<Sel>(null);
  const [adding, openAdd] = useState<Adding>(null);
  const [justAdded, setJustAdded] = useState('');
  const [error, setError] = useState('');
  const edit = (next: FlowDraft | ((d: FlowDraft) => FlowDraft)) => {
    if (!ed) return;
    setDraft(next);
    setError('');
  };
  const setSel = (s: Sel) => {
    pick(s);
    openAdd(null);
    setJustAdded('');
  };
  const byId = (id: string) => wf.find((w) => w.id === id);
  const node = (id: string) => draft.nodes.find((n) => n.id === id);
  const x: Editor = {
    ed,
    free: p.flowMode !== 'custom',
    draft,
    sel,
    setSel,
    adding,
    setAdding: openAdd,
    justAdded,
    node,
    look: (n) => lookOf(byId(n.id), n),
    issues: (id) => {
      const w = byId(id);
      return w ? p.tickets.filter((t: Any) => t.status === w.name).length : 0;
    },
    patch: (id, c) => edit((d) => renameNode(d, id, c)),
    connect: (from, to) => edit((d) => connect(d, from, to)),
    disconnect: (from, to) => edit((d) => removeEdge(d, from, to)),
    add: (category) => {
      const n = { id: uid(), name: freshName(draft), category };
      const { edge, after, at } = adding || {};
      if (edge) edit(insertOn(draft, edge, n));
      else if (after) edit(addAfter(draft, after, n, at));
      else edit(addNode(draft, n.id, n.name, category, at));
      setSel({ kind: 'node', id: n.id });
      setJustAdded(n.id);
    },
    remove: (s) => {
      if (!ed || !s) return;
      askRemove(x, s, () => {
        edit((d) => (s.kind === 'edge' ? removeEdge(d, s.from, s.to) : removeNode(d, s.id)));
        setSel(null);
      });
    },
  };
  return {
    ...x,
    dirty,
    error,
    save: () => {
      if (!ed) return;
      const msg = checkDraft(draft);
      setError(msg);
      if (msg) toast(msg, 'err');
      else setDraft(toDraft(saveFlow(wf, draft)));
    },
    discard: () => {
      edit(saved);
      setSel(null);
    },
    arrange: () =>
      edit(
        tidy(
          draft,
          applyDraft(wf, draft).workflow.map((w) => w.id),
        ),
      ),
  };
}

function Toolbar({ x, onTidy }: { x: ReturnType<typeof useEditor>; onTidy: () => void }) {
  return (
    <div className="flow-ui flow-top wfc-top">
      <button type="button" className="btn sm" onClick={() => x.setAdding({})}>
        <Ico svg={I.plus} />
        Add status
      </button>
      <button
        type="button"
        className="btn sm subtle"
        title="Put the statuses back in rows, in board order"
        onClick={onTidy}
      >
        <Ico svg={I.grid} />
        Tidy up
      </button>
      <span className="wfc-gap" />
      <span className="flow-status" role="status">
        {x.dirty && (
          <>
            <i className="wfc-dot" />
            Unsaved changes
          </>
        )}
      </span>
      <button type="button" className="btn sm subtle" disabled={!x.dirty} onClick={x.discard}>
        Discard changes
      </button>
      <button type="button" className="btn sm primary" disabled={!x.dirty} onClick={x.save}>
        Save flow
      </button>
    </div>
  );
}

function Side({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside className="flow-ui flow-insp" aria-label={label}>
      <button type="button" className="icon-btn flow-insp-x" onClick={onClose} aria-label="Close">
        <Ico svg={I.close} />
      </button>
      {children}
    </aside>
  );
}

export function FlowGraph() {
  const x = useEditor();
  const { ed, draft, sel } = x;
  const nodes = draft.nodes.map((n) => ({
    id: n.id,
    w: NODE_W,
    h: NODE_H + LABEL_H,
    def: { x: n.x, y: n.y },
  }));
  const g: CanvasGraph = { nodes, byId: Object.fromEntries(nodes.map((n) => [n.id, n])) };
  const v = useViewport(g, null, 0.6);
  useAutoFit(v, g);
  useWheelZoom(v);
  useFullScreenKeys(v);
  const smooth = useGlideToSelection(
    v,
    g,
    sel?.kind === 'node' ? { type: 'node', id: sel.id } : null,
  );
  const ptr = usePointer<WireStart>(v, {
    wireFrom: (port) => ({ node: port.dataset.node! }),
    canWire: (from, to) => canMove(x, from.node, to),
    onWire: (from, to) => {
      x.connect(from.node, to);
      x.setSel({ kind: 'edge', from: from.node, to });
    },
    setSel: (s) => x.setSel(s?.type === 'node' ? { kind: 'node', id: s.id } : null),
    fixed: !ed,
    onMove: (id, p, done) =>
      x.patch(
        id,
        done
          ? settle(
              p,
              draft.nodes.filter((n) => n.id !== id),
            )
          : p,
      ),
    onMiss: (from, p, moved) =>
      x.setAdding({
        after: from.node,
        at: moved ? { x: Math.round(p.x), y: Math.round(p.y - NODE_H / 2) } : undefined,
      }),
  });
  // Tidying up also brings everything into view, once the statuses are in their new places.
  const [tidied, setTidied] = useState(0);
  const onTidy = () => {
    x.arrange();
    setTidied((k) => k + 1);
  };
  useEffect(() => {
    if (tidied) v.refit();
  }, [tidied]); // eslint-disable-line react-hooks/exhaustive-deps
  const panel = panelFor(x);
  const close = () => x.setSel(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Escape' && panel) {
      e.stopPropagation();
      close();
      return;
    }
    if ((e.key !== 'Delete' && e.key !== 'Backspace') || !ed) return;
    if (t.closest('input, textarea, [role="combobox"], .flow-insp')) return;
    // what has the focus goes, or else what is selected
    const [from, to] = (t.closest<SVGElement>('[data-edge]')?.dataset.edge || '').split('>');
    const id = t.closest<HTMLElement>('[data-node]')?.dataset.node;
    let target: Sel = sel;
    if (to) target = { kind: 'edge', from, to };
    else if (id) target = { kind: 'node', id };
    if (!target || (target.kind === 'node' && draft.nodes.length < 2)) return;
    e.preventDefault();
    x.remove(target);
  };
  const cls = ['flow', 'wfc', v.full && 'full', ptr.conn && 'wiring', panel && 'has-insp'];
  return (
    <SetCard
      id="status-flow"
      title="Status flow"
      desc={
        ed
          ? 'Each status is a node and each allowed move a wire. Drag from a node’s dot to connect it, click anything to edit it, then save the flow.'
          : 'Each status is a node and each allowed move a wire. You can view the flow; changing it needs the “Edit project settings” permission.'
      }
      right={<span className="muted small">{draft.nodes.length} statuses</span>}
    >
      <div
        className={cls.filter(Boolean).join(' ')}
        role="group"
        aria-label={`Status flow: ${draft.nodes.length} statuses, ${draft.edges.length} transitions`}
        onKeyDown={onKeyDown}
      >
        {ed && <Toolbar x={x} onTidy={onTidy} />}
        {x.error && (
          <p className="flow-ui wfc-error" role="alert">
            <Ico svg={I.warn} />
            {x.error}
          </p>
        )}
        <StatusCanvas x={x} v={v} ptr={ptr} smooth={smooth} />
        <ZoomControls v={v} reset={false} />
        {x.free && (
          <p className="flow-ui wfc-note">
            {draft.edges.length
              ? 'Any status can move to any other. Wires are a guide until Transitions is set to Custom.'
              : 'No transitions yet: any status can move to any other.'}
          </p>
        )}
        {panel && (
          <Side label={x.adding ? 'Add a status' : 'Details'} onClose={close}>
            {panel}
          </Side>
        )}
      </div>
    </SetCard>
  );
}

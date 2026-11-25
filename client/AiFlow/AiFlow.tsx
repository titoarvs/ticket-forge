'use client';
// Administration → AI → AI flow. This component only puts the parts together:
//   graph.ts (nodes and wires) · use-routing.ts / use-provider-ops.ts (saving) ·
//   use-viewport.ts / use-pointer.ts (pan, zoom, drag) · canvas.tsx, faces.tsx (drawing) ·
//   inspector.tsx (the details panel) · toolbar.tsx (the controls on top).
import { useState } from 'react';
import type { Any } from '../core';
import { Ico, I } from '../ui';
import type { FlowActions } from './model';
import { type WireStart, useFlowGraph, buildEdges, canWire } from './graph';
import { makePorts } from './geometry';
import type { Flow } from './flow';
import { useRouting } from './use-routing';
import { useProviderOps } from './use-provider-ops';
import { type Sel, useViewport, useAutoFit, useWheelZoom, useFullScreenKeys } from './use-viewport';
import { useGlideToSelection } from './use-viewport';
import { usePointer } from './use-pointer';
import { FlowCanvas } from './canvas';
import { Inspector } from './inspector';
import { FlowToolbar, ZoomControls, EmptyState } from './toolbar';

export function AiFlow({ c, actions }: { c: Any; actions: FlowActions }) {
  const [sel, setSel] = useState<Sel>(null);
  const g = useFlowGraph(c);
  const routing = useRouting(c, actions, g);
  const providers = useProviderOps(actions, g, routing.patch);
  const v = useViewport(g);
  useAutoFit(v, g);
  useWheelZoom(v);
  useFullScreenKeys(v);
  const smooth = useGlideToSelection(v, g, sel);
  // A wire dropped from a task chooses what the task runs on; from a provider, the fallback order.
  const onWire = (from: WireStart, target: string) => {
    const n = g.byId[target];
    if (from.kind === 'prov') return providers.setFallback(from.node, target);
    routing.setTaskTier(from.row!, n.kind === 'tier' ? n.data.tier : `cfg:${n.data.id}`);
  };
  const ptr = usePointer<WireStart>(v, {
    wireFrom: ({ dataset: d }) =>
      d.row ? { kind: 'task', node: d.node!, row: d.row } : { kind: 'prov', node: d.node! },
    canWire: (from, target) => canWire(g, from, target),
    onWire,
    setSel,
  });

  if (!routing.r)
    return (
      <div className="card">
        <p className="muted small">The AI settings couldn’t be loaded.</p>
      </div>
    );
  const f: Flow = { c, actions, g, routing, providers, sel, setSel };
  const edges = buildEdges(g, routing.r);
  const ports = makePorts(g.byId, v.at);
  const selNode = sel?.type === 'node' ? g.byId[sel.id] : null;
  const selEdge = sel?.type === 'edge' ? edges.find((e) => e.id === sel.id) || null : null;
  const showInspector = Boolean(selNode?.kind !== 'add' && (selNode || selEdge));
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selEdge?.kind === 'route') {
      e.preventDefault();
      routing.resetTask(selEdge.task!);
    } else if (e.key === 'Escape') setSel(null);
  };
  const cls = ['flow', v.full && 'full', ptr.conn && 'wiring', showInspector && 'has-insp'];
  return (
    <div className={cls.map((x) => x || '').join(' ')} tabIndex={0} onKeyDown={onKeyDown}>
      <FlowToolbar f={f} />
      <ZoomControls v={v} />
      <FlowCanvas f={f} v={v} ptr={ptr} edges={edges} ports={ports} smooth={smooth} />
      {showInspector && (
        <aside className="flow-ui flow-insp" aria-label="Details">
          <button
            type="button"
            className="icon-btn flow-insp-x"
            onClick={() => setSel(null)}
            aria-label="Close details"
          >
            <Ico svg={I.close} />
          </button>
          <Inspector f={f} node={selNode} edge={selEdge} />
        </aside>
      )}
      {!g.nodes.some((n) => n.kind === 'provider' || n.kind === 'local') && <EmptyState f={f} />}
    </div>
  );
}

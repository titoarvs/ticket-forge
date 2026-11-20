'use client';
// Project brain → Graph: the notes as a force-directed graph on a canvas. The data, physics,
// drawing and pointer handling are in client/Brain/graph/.
import { type ReactNode, useState, useRef, useMemo } from 'react';
import { Ico, I } from '../ui';
import { type Note, TYPE_ORDER, TYPE_LABEL } from './make-resolver';
import type { GNode } from './BrainSettings';
import { graphData } from './graph/graph-data';
import { zoomBy } from './graph/layout';
import { useGraphSim } from './graph/use-graph-sim';

type GraphProps = {
  notes: Note[];
  all: Note[];
  selected: string;
  onSelect: (id: string) => void;
  filters: ReactNode;
};

/** The note under the pointer: its name and how many links it has. */
function Tip({ n }: { n: GNode }) {
  const keyed = n.key && (n.type === 'issue' || n.type === 'epic');
  return (
    <div className="brain-graph-tip">
      <b>
        {keyed ? `${n.key} ` : ''}
        {n.title}
      </b>
      <span className="muted small">
        {TYPE_LABEL[n.type]} · {n.deg} link{n.deg === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function ZoomButtons({ onZoom, onFit }: { onZoom: (f: number) => void; onFit: () => void }) {
  return (
    <div className="brain-zoom">
      <button className="icon-btn" aria-label="Zoom in" title="Zoom in" onClick={() => onZoom(1.3)}>
        <Ico svg={I.plus} />
      </button>
      <button
        className="icon-btn"
        aria-label="Zoom out"
        title="Zoom out"
        onClick={() => onZoom(1 / 1.3)}
      >
        <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
          −
        </span>
      </button>
      <button className="icon-btn" aria-label="Fit to screen" title="Fit" onClick={onFit}>
        <Ico svg={I.expand} />
      </button>
    </div>
  );
}

/** The colour of each type of note on the graph. */
function Legend({ nodes }: { nodes: Note[] }) {
  const types = TYPE_ORDER.filter((t) => nodes.some((n) => n.type === t));
  return (
    <div className="brain-legend" aria-label="Colours">
      {types.map((t) => (
        <span key={t}>
          <span className={`bn-dot t-${t}`} />
          {TYPE_LABEL[t]}
        </span>
      ))}
    </div>
  );
}

export function BrainGraph({ notes, all, selected, onSelect, filters }: GraphProps) {
  const [local, setLocal] = useState(Boolean(selected));
  const [hover, setHover] = useState<GNode | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const graph = useMemo(
    () => graphData(notes, all, local, selected),
    [notes, all, local, selected],
  );
  const sim = useGraphSim(graph, selected, { canvas, wrap }, { onSelect, onHover: setHover });
  const { nodes, edges } = graph;
  return (
    <div className="brain-graph-wrap">
      <div className="brain-graph-bar">
        {filters}
        <div className="brain-graph-tools">
          <label className="row small" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={local}
              disabled={!selected}
              onChange={(e) => setLocal(e.target.checked)}
            />
            Around the open note
          </label>
          <span className="muted small">
            {nodes.length} notes · {edges.length} links
          </span>
        </div>
      </div>
      <div className="brain-graph" ref={wrap}>
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Graph of ${nodes.length} notes and ${edges.length} links. Use the Notes view to browse them as a list.`}
        />
        {hover && <Tip n={hover} />}
        <ZoomButtons
          onZoom={(f) => sim.current && zoomBy(sim.current, f)}
          onFit={() => sim.current?.fit()}
        />
        {!nodes.length && (
          <div className="brain-graph-empty muted">No notes match the filters.</div>
        )}
      </div>
      <Legend nodes={nodes} />
    </div>
  );
}

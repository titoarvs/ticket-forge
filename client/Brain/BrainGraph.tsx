'use client';
import { type ReactNode, useState, useRef, useMemo, useEffect } from 'react';
import type { Any } from '../core';
import { Ico, I } from '../ui';
import { type Note, TYPE_ORDER, TYPE_LABEL } from './make-resolver';
import { type GNode, palette } from './BrainSettings';

export function BrainGraph({
  notes,
  all,
  selected,
  onSelect,
  filters,
}: {
  notes: Note[];
  all: Note[];
  selected: string;
  onSelect: (id: string) => void;
  filters: ReactNode;
}) {
  const [local, setLocal] = useState(Boolean(selected));
  const [hover, setHover] = useState<GNode | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const sim = useRef<Any>(null);
  // The nodes shown: the filtered notes, or (around a note) it and the notes up to two links away.
  const graph = useMemo(() => {
    // The Index links to everything, so it's left out (it would pull every note into one knot)
    // unless it's open.
    let ids = new Set(
      notes.filter((n) => n.type !== 'index' || n.id === selected).map((n) => n.id),
    );
    const allById = new Map(all.map((n) => [n.id, n]));
    if (local && selected && allById.has(selected)) {
      const near = new Map<string, Set<string>>();
      for (const n of all)
        for (const o of n.out) {
          if (!near.has(n.id)) near.set(n.id, new Set());
          if (!near.has(o)) near.set(o, new Set());
          near.get(n.id)!.add(o);
          near.get(o)!.add(n.id);
        }
      const keep = new Set([selected]);
      let frontier = [selected];
      for (let d = 0; d < 2; d++) {
        const next: string[] = [];
        for (const id of frontier)
          for (const x of near.get(id) || [])
            if (!keep.has(x) && ids.has(x)) {
              keep.add(x);
              next.push(x);
            }
        frontier = next;
        if (keep.size > 250) break;
      }
      ids = keep;
    }
    const edges: [string, string][] = [];
    const seen = new Set<string>();
    for (const n of all)
      if (ids.has(n.id))
        for (const o of n.out)
          if (ids.has(o)) {
            const k = n.id < o ? `${n.id}\u0000${o}` : `${o}\u0000${n.id}`;
            if (!seen.has(k)) {
              seen.add(k);
              edges.push([n.id, o]);
            }
          }
    return { nodes: [...ids].map((id) => allById.get(id)!).filter(Boolean), edges };
  }, [notes, all, local, selected]);

  useEffect(() => {
    const cv = canvas.current,
      box = wrap.current;
    if (!cv || !box) return undefined;
    const prev: Map<string, GNode> = sim.current?.byId || new Map();
    const R = Math.sqrt(graph.nodes.length) * 34 + 60;
    const nodes: GNode[] = graph.nodes.map((n, i) => {
      const o = prev.get(n.id);
      const a = i * 2.399963,
        r = R * Math.sqrt((i + 0.5) / Math.max(1, graph.nodes.length));
      return {
        id: n.id,
        type: n.type,
        title: n.title,
        key: n.key,
        x: o?.x ?? Math.cos(a) * r,
        y: o?.y ?? Math.sin(a) * r,
        vx: 0,
        vy: 0,
        deg: 0,
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = graph.edges
      .map(([a, b]) => [byId.get(a)!, byId.get(b)!])
      .filter(([a, b]) => a && b) as [GNode, GNode][];
    for (const [a, b] of edges) {
      a.deg++;
      b.deg++;
    }
    // Only the selection changed (same notes): keep the layout and view; new notes: lay out again
    // and fit.
    const settled = prev.size > 0 && nodes.every((n) => prev.has(n.id));
    const s: Any = (sim.current = {
      nodes,
      byId,
      edges,
      view: sim.current?.view || { x: 0, y: 0, k: 1 },
      alpha: settled ? 0.03 : prev.size ? 0.6 : 1,
      raf: 0,
      colors: palette(),
      drag: null,
      fitted: settled,
    });
    const radius = (n: GNode) =>
      3.5 +
      Math.min(9, Math.sqrt(n.deg) * 1.6) +
      (n.type === 'index' || n.type === 'project' ? 3 : 0);
    const size = () => {
      const w = box.clientWidth,
        h = box.clientHeight,
        dpr = window.devicePixelRatio || 1;
      cv.width = w * dpr;
      cv.height = h * dpr;
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      s.w = w;
      s.h = h;
      s.dpr = dpr;
    };
    size();
    const fit = () => {
      if (!nodes.length) return;
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const n of nodes) {
        x0 = Math.min(x0, n.x);
        y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x);
        y1 = Math.max(y1, n.y);
      }
      const k = Math.min(
        2.2,
        Math.max(0.15, Math.min(s.w / (x1 - x0 + 120), s.h / (y1 - y0 + 120))),
      );
      s.view = { k, x: s.w / 2 - ((x0 + x1) / 2) * k, y: s.h / 2 - ((y0 + y1) / 2) * k };
    };
    s.fit = () => {
      fit();
      draw();
    };
    if (!settled) s.view = { x: s.w / 2, y: s.h / 2, k: nodes.length > 200 ? 0.5 : 1 };
    const step = () => {
      // Repulsion between nearby nodes (grid buckets: fast for hundreds of notes), springs along
      // links, a pull to the middle.
      const CELL = 150,
        grid = new Map<string, GNode[]>();
      for (const n of nodes) {
        const k = `${Math.floor(n.x / CELL)},${Math.floor(n.y / CELL)}`;
        (grid.get(k) || grid.set(k, []).get(k)!).push(n);
      }
      for (const n of nodes) {
        const cx = Math.floor(n.x / CELL),
          cy = Math.floor(n.y / CELL);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (const m of grid.get(`${cx + dx},${cy + dy}`) || []) {
              if (m === n) continue;
              let ddx = n.x - m.x,
                ddy = n.y - m.y;
              let d2 = ddx * ddx + ddy * ddy;
              if (d2 < 0.01) {
                ddx = Math.random() - 0.5;
                ddy = Math.random() - 0.5;
                d2 = 0.5;
              }
              if (d2 > CELL * CELL) continue;
              const f = (2600 / d2) * s.alpha;
              n.vx += ddx * f * 0.06;
              n.vy += ddy * f * 0.06;
            }
      }
      for (const [a, b] of edges) {
        const dx = b.x - a.x,
          dy = b.y - a.y,
          d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = ((d - 85) / d) * 0.035 * s.alpha;
        a.vx += dx * f;
        a.vy += dy * f;
        b.vx -= dx * f;
        b.vy -= dy * f;
      }
      for (const n of nodes) {
        n.vx -= n.x * 0.0015 * s.alpha;
        n.vy -= n.y * 0.0015 * s.alpha;
        if (n === s.drag?.node) {
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.vx *= 0.82;
        n.vy *= 0.82;
        n.x += Math.max(-20, Math.min(20, n.vx));
        n.y += Math.max(-20, Math.min(20, n.vy));
      }
      s.alpha *= 0.985;
    };
    const draw = () => {
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const c = s.colors,
        v = s.view;
      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      ctx.clearRect(0, 0, s.w, s.h);
      ctx.translate(v.x, v.y);
      ctx.scale(v.k, v.k);
      const focus = s.hover || byId.get(selected) || null;
      const near = new Set<GNode>();
      if (focus) {
        near.add(focus);
        for (const [a, b] of edges) {
          if (a === focus) near.add(b);
          if (b === focus) near.add(a);
        }
      }
      ctx.lineWidth = 1 / v.k;
      ctx.strokeStyle = c.edge;
      ctx.beginPath();
      for (const [a, b] of edges)
        if (!(focus && (a === focus || b === focus))) {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
      ctx.stroke();
      if (focus) {
        ctx.strokeStyle = c.edgeHi;
        ctx.lineWidth = 1.6 / v.k;
        ctx.beginPath();
        for (const [a, b] of edges)
          if (a === focus || b === focus) {
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          }
        ctx.stroke();
      }
      for (const n of nodes) {
        const r = radius(n);
        ctx.globalAlpha = focus && !near.has(n) ? 0.35 : 1;
        ctx.fillStyle = c[n.type] || c.note;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (n.id === selected) {
          ctx.strokeStyle = c.text;
          ctx.lineWidth = 2 / v.k;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 3 / v.k, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      // Labels: when zoomed in, for big nodes, and for the focused note and its neighbours.
      ctx.font = `${12 / v.k}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const n of nodes) {
        const show =
          near.has(n) ||
          v.k > 1.3 ||
          (v.k > 0.7 && n.deg > 6) ||
          n.type === 'index' ||
          n.type === 'project';
        if (!show) continue;
        const label =
          n.key && (n.type === 'issue' || n.type === 'epic')
            ? near.has(n) || v.k > 1.8
              ? `${n.key} ${n.title}`
              : n.key
            : n.title;
        const t = label.length > 42 ? `${label.slice(0, 40)}…` : label;
        const y = n.y + radius(n) + 3 / v.k;
        ctx.lineWidth = 3 / v.k;
        ctx.strokeStyle = c.bg;
        ctx.strokeText(t, n.x, y);
        ctx.fillStyle = near.has(n) ? c.text : c.muted;
        ctx.fillText(t, n.x, y);
      }
    };
    const loop = () => {
      if (s.alpha > 0.02 || s.drag) {
        step();
        if (!s.fitted && !s.moved && s.alpha < 0.3) {
          fit();
          s.fitted = true;
        }
      }
      const more = s.alpha > 0.02 || s.drag;
      if (!more && !s.moved && !s.settledFit && !settled) {
        fit();
        s.settledFit = true;
      } // once more when the layout has settled
      draw();
      s.raf = more ? requestAnimationFrame(loop) : 0;
    };
    s.kick = (a = 0.4) => {
      s.alpha = Math.max(s.alpha, a);
      if (!s.raf) s.raf = requestAnimationFrame(loop);
    };
    s.draw = draw;
    s.raf = requestAnimationFrame(loop);
    // Pointer: drag a note, drag the background to pan, wheel or the buttons to zoom; click opens a
    // note.
    const toWorld = (e: PointerEvent | WheelEvent) => {
      const r = cv.getBoundingClientRect();
      return {
        x: (e.clientX - r.left - s.view.x) / s.view.k,
        y: (e.clientY - r.top - s.view.y) / s.view.k,
        sx: e.clientX - r.left,
        sy: e.clientY - r.top,
      };
    };
    const hit = (w: { x: number; y: number }) => {
      let best: GNode | null = null,
        bd = Infinity;
      for (const n of nodes) {
        const d = (n.x - w.x) ** 2 + (n.y - w.y) ** 2,
          r = radius(n) + 5 / s.view.k;
        if (d < r * r && d < bd) {
          bd = d;
          best = n;
        }
      }
      return best;
    };
    const down = (e: PointerEvent) => {
      const w = toWorld(e);
      const n = hit(w);
      cv.setPointerCapture(e.pointerId);
      s.drag = { node: n, sx: w.sx, sy: w.sy, vx: s.view.x, vy: s.view.y, moved: false };
      if (n) s.kick(0.3);
    };
    const move = (e: PointerEvent) => {
      const w = toWorld(e);
      if (s.drag) {
        if (Math.abs(w.sx - s.drag.sx) + Math.abs(w.sy - s.drag.sy) > 4) s.drag.moved = true;
        if (s.drag.node) {
          s.drag.node.x = w.x;
          s.drag.node.y = w.y;
          s.kick(0.15);
        } else if (s.drag.moved) {
          s.moved = true;
          s.view.x = s.drag.vx + (w.sx - s.drag.sx);
          s.view.y = s.drag.vy + (w.sy - s.drag.sy);
          draw();
        }
        return;
      }
      const n = hit(w);
      if (n !== s.hover) {
        s.hover = n;
        setHover(n);
        cv.style.cursor = n ? 'pointer' : 'grab';
        draw();
      }
    };
    const up = (e: PointerEvent) => {
      const d = s.drag;
      s.drag = null;
      try {
        cv.releasePointerCapture(e.pointerId);
      } catch {
        /* released */
      }
      if (d && !d.moved && d.node) onSelect(d.node.id);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      s.moved = true;
      const w = toWorld(e);
      const k = Math.min(4, Math.max(0.08, s.view.k * Math.exp(-e.deltaY * 0.0015)));
      s.view = { k, x: w.sx - w.x * k, y: w.sy - w.y * k };
      draw();
    };
    const leave = () => {
      if (s.hover) {
        s.hover = null;
        setHover(null);
        draw();
      }
    };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    cv.addEventListener('pointerleave', leave);
    const ro = new ResizeObserver(() => {
      size();
      draw();
    });
    ro.observe(box);
    const mo = new MutationObserver(() => {
      s.colors = palette();
      draw();
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onScheme = () => {
      s.colors = palette();
      draw();
    };
    mq?.addEventListener?.('change', onScheme);
    return () => {
      cancelAnimationFrame(s.raf);
      s.raf = 0;
      ro.disconnect();
      mo.disconnect();
      mq?.removeEventListener?.('change', onScheme);
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
      cv.removeEventListener('wheel', wheel);
      cv.removeEventListener('pointerleave', leave);
    };
  }, [graph, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = (f: number) => {
    const s = sim.current;
    if (!s) return;
    s.moved = true;
    const k = Math.min(4, Math.max(0.08, s.view.k * f));
    const cx = s.w / 2,
      cy = s.h / 2;
    s.view = {
      k,
      x: cx - ((cx - s.view.x) / s.view.k) * k,
      y: cy - ((cy - s.view.y) / s.view.k) * k,
    };
    s.draw();
  };
  const types = TYPE_ORDER.filter((t) => graph.nodes.some((n) => n.type === t));
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
            {graph.nodes.length} notes · {graph.edges.length} links
          </span>
        </div>
      </div>
      <div className="brain-graph" ref={wrap}>
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Graph of ${graph.nodes.length} notes and ${graph.edges.length} links. Use the Notes view to browse them as a list.`}
        />
        {hover && (
          <div className="brain-graph-tip">
            <b>
              {hover.key && (hover.type === 'issue' || hover.type === 'epic')
                ? `${hover.key} `
                : ''}
              {hover.title}
            </b>
            <span className="muted small">
              {TYPE_LABEL[hover.type]} · {hover.deg} link{hover.deg === 1 ? '' : 's'}
            </span>
          </div>
        )}
        <div className="brain-zoom">
          <button
            className="icon-btn"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => zoom(1.3)}
          >
            <Ico svg={I.plus} />
          </button>
          <button
            className="icon-btn"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => zoom(1 / 1.3)}
          >
            <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
              −
            </span>
          </button>
          <button
            className="icon-btn"
            aria-label="Fit to screen"
            title="Fit"
            onClick={() => sim.current?.fit()}
          >
            <Ico svg={I.expand} />
          </button>
        </div>
        {!graph.nodes.length && (
          <div className="brain-graph-empty muted">No notes match the filters.</div>
        )}
      </div>
      <div className="brain-legend" aria-label="Colours">
        {types.map((t) => (
          <span key={t}>
            <span className={`bn-dot t-${t}`} />
            {TYPE_LABEL[t]}
          </span>
        ))}
      </div>
    </div>
  );
}

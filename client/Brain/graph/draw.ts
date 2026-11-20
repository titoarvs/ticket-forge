'use client';
// Drawing the graph on its canvas: links (the focused note's highlighted), nodes coloured by type,
// and labels where they fit.
import type { GNode } from '../BrainSettings';
import { type Sim, radius } from './layout';

type Ctx = CanvasRenderingContext2D;

/** The note under the pointer, or the open note, and the notes linked to it. */
function focusOf(s: Sim) {
  const focus = s.hover || s.byId.get(s.selected) || null;
  const near = new Set<GNode>();
  if (!focus) return { focus, near };
  near.add(focus);
  for (const [a, b] of s.edges) {
    if (a === focus) near.add(b);
    if (b === focus) near.add(a);
  }
  return { focus, near };
}

function drawEdges(ctx: Ctx, s: Sim, focus: GNode | null) {
  const k = s.view.k;
  const touches = ([a, b]: [GNode, GNode]) => Boolean(focus && (a === focus || b === focus));
  const stroke = (color: string, width: number, pick: (e: [GNode, GNode]) => boolean) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width / k;
    ctx.beginPath();
    for (const e of s.edges)
      if (pick(e)) {
        ctx.moveTo(e[0].x, e[0].y);
        ctx.lineTo(e[1].x, e[1].y);
      }
    ctx.stroke();
  };
  stroke(s.colors.edge, 1, (e) => !touches(e));
  if (focus) stroke(s.colors.edgeHi, 1.6, touches);
}

/** Nodes away from the focus fade; the open note gets a ring. */
function drawNodes(ctx: Ctx, s: Sim, focus: GNode | null, near: Set<GNode>) {
  const k = s.view.k;
  for (const n of s.nodes) {
    const r = radius(n);
    ctx.globalAlpha = focus && !near.has(n) ? 0.35 : 1;
    ctx.fillStyle = s.colors[n.type] || s.colors.note;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (n.id === s.selected) {
      ctx.strokeStyle = s.colors.text;
      ctx.lineWidth = 2 / k;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 3 / k, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** Labels show when zoomed in, for big nodes, and for the focused note and its neighbours. */
function showsLabel(n: GNode, k: number, near: Set<GNode>) {
  return (
    near.has(n) || k > 1.3 || (k > 0.7 && n.deg > 6) || n.type === 'index' || n.type === 'project'
  );
}

/** Issues and epics show their key, with the title when close up or focused; at most 42 characters. */
function labelOf(n: GNode, k: number, near: Set<GNode>) {
  const keyed = n.key && (n.type === 'issue' || n.type === 'epic');
  const label = keyed ? (near.has(n) || k > 1.8 ? `${n.key} ${n.title}` : n.key) : n.title;
  return label.length > 42 ? `${label.slice(0, 40)}…` : label;
}

function drawLabels(ctx: Ctx, s: Sim, near: Set<GNode>) {
  const k = s.view.k;
  ctx.font = `${12 / k}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const n of s.nodes) {
    if (!showsLabel(n, k, near)) continue;
    const t = labelOf(n, k, near);
    const y = n.y + radius(n) + 3 / k;
    ctx.lineWidth = 3 / k;
    ctx.strokeStyle = s.colors.bg;
    ctx.strokeText(t, n.x, y);
    ctx.fillStyle = near.has(n) ? s.colors.text : s.colors.muted;
    ctx.fillText(t, n.x, y);
  }
}

export function drawGraph(cv: HTMLCanvasElement, s: Sim) {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const v = s.view;
  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  ctx.clearRect(0, 0, s.w, s.h);
  ctx.translate(v.x, v.y);
  ctx.scale(v.k, v.k);
  const { focus, near } = focusOf(s);
  drawEdges(ctx, s, focus);
  drawNodes(ctx, s, focus, near);
  drawLabels(ctx, s, near);
}

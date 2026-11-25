'use client';
// What the parts of the status flow canvas share: the draft, the selection and the edits.
import { type Any, CATEGORIES, statusColor, toneOf, wCls } from '../core';
import type { FlowDraft, FlowEdge, FlowNode } from './flow-graph';

export type Pt = { x: number; y: number };
export type Sel = { kind: 'node'; id: string } | { kind: 'edge'; from: string; to: string } | null;
/** The “Add a status” panel is open; what it adds goes here (nowhere in particular when empty). */
export type Adding = { after?: string; edge?: FlowEdge; at?: Pt } | null;

export type Editor = {
  ed: boolean;
  free: boolean;
  draft: FlowDraft;
  sel: Sel;
  setSel: (s: Sel) => void;
  adding: Adding;
  setAdding: (a: Adding) => void;
  /** The status just added: its name gets the focus. */
  justAdded: string;
  node: (id: string) => FlowNode | undefined;
  /** The status as it will look once saved: saved settings with the draft's on top. */
  look: (n: FlowNode) => Any;
  /** How many issues are in a status. */
  issues: (id: string) => number;
  patch: (id: string, p: Partial<FlowNode>) => void;
  connect: (from: string, to: string) => void;
  disconnect: (from: string, to: string) => void;
  add: (category: string) => void;
  /** Removes a status or a transition, after asking. */
  remove: (s: Sel) => void;
};

/** One status on top of the other: what the canvas, the panel and the save all agree on. */
export function lookOf(saved: Any, n: FlowNode): Any {
  const w: Any = { ...saved, id: n.id, name: n.name, category: n.category };
  if (n.color !== undefined) w.color = n.color || '';
  if (n.wip !== undefined) w.wip = n.wip || undefined;
  if (n.fromAny !== undefined) w.fromAny = n.fromAny;
  return w;
}
/** Class and colour of a status; the colour is inline because an unsaved one has no rule yet. */
export function tint(w: Any) {
  const c = statusColor(w);
  return {
    className: wCls(w),
    style: (c ? { '--sc': c } : undefined) as React.CSSProperties | undefined,
  };
}
export const catLabel = (category: string) =>
  CATEGORIES.find(([v]: Any) => v === category)?.[1] || category;

const svg = (d: string) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const GLYPH: Record<string, string> = {
  todo: svg('<circle cx="12" cy="12" r="8.5" stroke-dasharray="3.1 3.6"/>'),
  inprogress: svg(
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2a4.8 4.8 0 010 9.6z" fill="currentColor"/>',
  ),
  inreview: svg(
    '<path d="M2.8 12S6 5.8 12 5.8 21.2 12 21.2 12 18 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.7"/>',
  ),
  done: svg('<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.4l2.6 2.6 5-5.4"/>'),
};
/** The icon of a status, by what it means. */
export const glyph = (w: Any) => GLYPH[toneOf(w)] || GLYPH.todo;

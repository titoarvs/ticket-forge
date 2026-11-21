// TF-141: the status flow as a graph. Pure helpers (no React, no store) that turn a project's
// workflow into nodes and edges, edit that draft, check it and write it back. Run
// `npm test` for tests/tf-141-status-flow.test.ts.

export type FlowNode = { id: string; name: string; category: string; x: number; y: number };
export type FlowEdge = { from: string; to: string };
export type FlowDraft = { nodes: FlowNode[]; edges: FlowEdge[] };

export const NODE_W = 132;
export const NODE_H = 38;
const COL_GAP = 70;
const ROW_GAP = 40;
const COLS = 4;
const PAD = 16;

/** Where a status without a saved position goes: a grid, in board order. */
export const defaultPos = (i: number) => ({
  x: PAD + (i % COLS) * (NODE_W + COL_GAP),
  y: PAD + Math.floor(i / COLS) * (NODE_H + ROW_GAP),
});

/** One node per status and one edge per saved transition (`next`). */
export function toDraft(wf: any[]): FlowDraft {
  const list = Array.isArray(wf) ? wf : [];
  const ids = new Set(list.map((w) => w.id));
  const nodes = list.map((w, i) => ({
    id: w.id,
    name: String(w.name ?? ''),
    category: w.category || 'inprogress',
    x: typeof w.x === 'number' ? w.x : defaultPos(i).x,
    y: typeof w.y === 'number' ? w.y : defaultPos(i).y,
  }));
  const edges: FlowEdge[] = [];
  for (const w of list)
    for (const to of new Set<string>(w.next || []))
      if (to !== w.id && ids.has(to)) edges.push({ from: w.id, to });
  return { nodes, edges };
}

/** A new status at the first free spot. Its name is whatever was typed (checked on save). */
export function addNode(
  d: FlowDraft,
  id: string,
  name: string,
  category = 'inprogress',
): FlowDraft {
  const pos = defaultPos(d.nodes.length);
  return { ...d, nodes: [...d.nodes, { id, name, category, x: pos.x, y: pos.y }] };
}

export const renameNode = (d: FlowDraft, id: string, patch: Partial<FlowNode>): FlowDraft => ({
  ...d,
  nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
});

/** Removing a status also removes its transitions. */
export const removeNode = (d: FlowDraft, id: string): FlowDraft => ({
  nodes: d.nodes.filter((n) => n.id !== id),
  edges: d.edges.filter((e) => e.from !== id && e.to !== id),
});

/** A transition between two different statuses; the same one twice is kept once. */
export function connect(d: FlowDraft, from: string, to: string): FlowDraft {
  const ok = from !== to && d.nodes.some((n) => n.id === from) && d.nodes.some((n) => n.id === to);
  if (!ok || d.edges.some((e) => e.from === from && e.to === to)) return d;
  return { ...d, edges: [...d.edges, { from, to }] };
}

export const removeEdge = (d: FlowDraft, from: string, to: string): FlowDraft => ({
  ...d,
  edges: d.edges.filter((e) => !(e.from === from && e.to === to)),
});

const norm = (s: string) => s.trim().toLowerCase();

/** The message to show when the draft can't be saved, or '' when it is fine. */
export function checkDraft(d: FlowDraft): string {
  const seen = new Set<string>();
  for (const n of d.nodes) {
    const k = norm(n.name);
    if (!k) return 'Every status needs a name.';
    if (seen.has(k))
      return `The status name “${n.name.trim()}” is a duplicate. Names must be unique in a project.`;
    seen.add(k);
  }
  if (!d.nodes.length) return 'A project needs at least one status.';
  return '';
}

export const sameDraft = (a: FlowDraft, b: FlowDraft) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The workflow with the draft applied. Statuses that already exist keep their other settings
 * (colour, column limit…); new ones go before the last status, as "Add status" does. Also returns what the
 * tickets need: `renamed` statuses and `removed` ones (`to` = the status their tickets move to).
 */
export function applyDraft(wf: any[], d: FlowDraft) {
  const byId = new Map(wf.map((w) => [w.id, w]));
  const nodeIds = new Set(d.nodes.map((n) => n.id));
  const nextOf = (id: string) => d.edges.filter((e) => e.from === id).map((e) => e.to);
  const make = (n: FlowNode) => {
    const old = byId.get(n.id) || {};
    return {
      ...old,
      id: n.id,
      name: n.name.trim(),
      category: n.category,
      x: Math.round(n.x),
      y: Math.round(n.y),
      next: nextOf(n.id),
    };
  };
  const kept = wf.filter((w) => nodeIds.has(w.id));
  const fresh = d.nodes.filter((n) => !byId.has(n.id));
  const out = kept.map((w) => make(d.nodes.find((n) => n.id === w.id)!));
  const at = Math.max(0, out.length - 1);
  out.splice(at, 0, ...fresh.map(make));
  const renamed = kept
    .map((w) => ({ from: w.name as string, to: d.nodes.find((n) => n.id === w.id)!.name.trim() }))
    .filter((r) => r.from !== r.to);
  const removed = wf
    .filter((w) => !nodeIds.has(w.id))
    .map((w) => ({
      from: w.name as string,
      to: (out.find((x) => x.category === w.category) || out[0])?.name as string,
    }));
  return { workflow: out, renamed, removed };
}

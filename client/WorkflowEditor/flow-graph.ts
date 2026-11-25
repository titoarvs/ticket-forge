// TF-141: the status flow as a graph. Pure helpers (no React, no store) that turn a project's
// workflow into nodes and edges, edit that draft, check it and write it back. Run
// `npm test` for tests/tf-141-status-flow.test.ts.

export type FlowNode = {
  id: string;
  name: string;
  category: string;
  x: number;
  y: number;
  /** Set only when changed on the canvas; undefined keeps what the status has, null clears it. */
  color?: string | null;
  wip?: number | null;
  fromAny?: boolean;
  /** New statuses: the status whose board column this one comes after. */
  after?: string;
};
export type FlowEdge = { from: string; to: string };
export type FlowDraft = { nodes: FlowNode[]; edges: FlowEdge[] };

type Pt = { x: number; y: number };
// the square tile; the name hangs below it
export const NODE_W = 96;
export const NODE_H = 96;
export const LABEL_H = 54;
export const STEP_X = 232;
const STEP_Y = 232;
const COLS = 6;
const PAD = 16;
// closer than this in both directions and two nodes (with their names) would cover each other
const ROOM_X = 160;
const ROOM_Y = 160;

/** Where a status without a saved position goes: a grid, in board order. */
export const defaultPos = (i: number) => ({
  x: PAD + (i % COLS) * STEP_X,
  y: PAD + Math.floor(i / COLS) * STEP_Y,
});

const clear = (p: Pt, others: Pt[]) =>
  others.every((o) => Math.abs(o.x - p.x) >= ROOM_X || Math.abs(o.y - p.y) >= ROOM_Y);

/** The free spot nearest to `p`, so nodes never cover each other. */
export function settle(p: Pt, others: Pt[]): Pt {
  if (clear(p, others)) return p;
  const step = 16;
  for (let r = 1; r < 120; r++) {
    let best: Pt | null = null;
    let d0 = Infinity;
    for (let i = -r; i <= r; i++)
      for (const [dx, dy] of [
        [r, i],
        [i, r],
        [-r, i],
        [i, -r],
      ]) {
        const c = { x: p.x + dx * step, y: p.y + dy * step };
        const d = Math.hypot(dx, dy);
        if (d < d0 && clear(c, others)) [best, d0] = [c, d];
      }
    if (best) return best;
  }
  return p;
}

/** One node per status and one edge per saved transition (`next`). */
export function toDraft(wf: any[]): FlowDraft {
  const list = Array.isArray(wf) ? wf : [];
  const ids = new Set(list.map((w) => w.id));
  const nodes: FlowNode[] = [];
  list.forEach((w, i) => {
    const d = defaultPos(i);
    const at = {
      x: typeof w.x === 'number' ? w.x : d.x,
      y: typeof w.y === 'number' ? w.y : d.y,
    };
    nodes.push({
      id: w.id,
      name: String(w.name ?? ''),
      category: w.category || 'inprogress',
      ...settle(at, nodes),
    });
  });
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
  at?: Pt,
): FlowDraft {
  const end = d.nodes.reduce<FlowNode | null>((m, n) => (!m || n.x > m.x ? n : m), null);
  const want = at || (end ? { x: end.x + STEP_X, y: end.y } : defaultPos(0));
  return { ...d, nodes: [...d.nodes, { id, name, category, ...settle(want, d.nodes) }] };
}

/** A new status a given one can move to, to its right unless `at` says where. */
export function addAfter(
  d: FlowDraft,
  from: string,
  n: { id: string; name: string; category: string },
  at?: Pt,
): FlowDraft {
  const a = d.nodes.find((x) => x.id === from);
  if (!a) return addNode(d, n.id, n.name, n.category, at);
  const out = addNode(d, n.id, n.name, n.category, at || { x: a.x + STEP_X, y: a.y });
  return connect(renameNode(out, n.id, { after: from }), from, n.id);
}

/** A new status in the middle of a transition; what is to the right moves over to make room. */
export function insertOn(
  d: FlowDraft,
  e: FlowEdge,
  n: { id: string; name: string; category: string },
): FlowDraft {
  const a = d.nodes.find((x) => x.id === e.from);
  const b = d.nodes.find((x) => x.id === e.to);
  if (!a || !b) return d;
  const tight = b.x > a.x && b.x - a.x < STEP_X * 1.7;
  const at = tight ? { x: b.x, y: b.y } : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const moved = tight
    ? { ...d, nodes: d.nodes.map((x) => (x.x >= b.x ? { ...x, x: x.x + STEP_X } : x)) }
    : d;
  // on the board it goes after whichever of the two comes first
  const first = d.nodes.indexOf(a) < d.nodes.indexOf(b) ? a.id : b.id;
  const out = renameNode(addNode(moved, n.id, n.name, n.category, at), n.id, { after: first });
  return connect(connect(removeEdge(out, e.from, e.to), e.from, n.id), n.id, e.to);
}

/** Every status back in rows, in the order of `ids` (the board order). */
export const tidy = (d: FlowDraft, ids: string[]): FlowDraft => ({
  ...d,
  nodes: d.nodes.map((n) => ({ ...n, ...defaultPos(Math.max(0, ids.indexOf(n.id))) })),
});

/** “New status”, “New status 2”… : the first one no status uses yet. */
export function freshName(d: FlowDraft): string {
  const used = new Set(d.nodes.map((n) => norm(n.name)));
  let name = 'New status';
  for (let k = 2; used.has(norm(name)); k++) name = `New status ${k}`;
  return name;
}

/** Each status can move to the one before and after it: a sensible start for a custom workflow. */
export function stepByStep(wf: any[]) {
  wf.forEach((w, i) => {
    w.next = [wf[i - 1]?.id, wf[i + 1]?.id].filter(Boolean);
    w.fromAny = false;
  });
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
    const out: any = {
      ...old,
      id: n.id,
      name: n.name.trim(),
      category: n.category,
      x: Math.round(n.x),
      y: Math.round(n.y),
      next: nextOf(n.id),
    };
    for (const k of ['color', 'wip', 'fromAny'] as const) {
      if (n[k] === undefined) continue;
      if (n[k]) out[k] = n[k];
      else delete out[k];
    }
    return out;
  };
  const kept = wf.filter((w) => nodeIds.has(w.id));
  const fresh = d.nodes.filter((n) => !byId.has(n.id));
  const out = kept.map((w) => make(d.nodes.find((n) => n.id === w.id)!));
  const loose = fresh.filter((n) => !n.after || !nodeIds.has(n.after));
  out.splice(Math.max(0, out.length - 1), 0, ...loose.map(make));
  // one added after another new status waits until that one is in; a finished status stays last
  let wait = fresh.filter((n) => !loose.includes(n));
  while (wait.length) {
    const n = wait.find((x) => out.some((o) => o.id === x.after)) || wait[0];
    const i = out.findIndex((o) => o.id === n.after);
    const end = i === out.length - 1 && out[i]?.category === 'done' && n.category !== 'done';
    out.splice(i < 0 || end ? Math.max(0, out.length - 1) : i + 1, 0, make(n));
    wait = wait.filter((x) => x !== n);
  }
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

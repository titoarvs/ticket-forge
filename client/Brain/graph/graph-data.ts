'use client';
// Which notes and links the graph shows: the filtered notes, or (around the open note) it and the
// notes up to two links away.
import type { Note } from '../make-resolver';

export type GraphData = { nodes: Note[]; edges: [string, string][] };

/** Every note's neighbours, both directions. */
function neighbours(all: Note[]) {
  const near = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!near.has(a)) near.set(a, new Set());
    near.get(a)!.add(b);
  };
  for (const n of all)
    for (const o of n.out) {
      link(n.id, o);
      link(o, n.id);
    }
  return near;
}

/** The note and the shown notes up to two links from it (stops growing past 250). */
function around(selected: string, all: Note[], shown: Set<string>) {
  const near = neighbours(all);
  const keep = new Set([selected]);
  let frontier = [selected];
  for (let d = 0; d < 2; d++) {
    const next: string[] = [];
    for (const id of frontier)
      for (const x of near.get(id) || [])
        if (!keep.has(x) && shown.has(x)) {
          keep.add(x);
          next.push(x);
        }
    frontier = next;
    if (keep.size > 250) break;
  }
  return keep;
}

/** One link per pair of notes, whichever way they link. */
function linksBetween(all: Note[], ids: Set<string>) {
  const edges: [string, string][] = [];
  const seen = new Set<string>();
  for (const n of all) {
    if (!ids.has(n.id)) continue;
    for (const o of n.out) {
      if (!ids.has(o)) continue;
      const k = n.id < o ? `${n.id}\u0000${o}` : `${o}\u0000${n.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push([n.id, o]);
    }
  }
  return edges;
}

/**
 * The Index links to everything, so it's left out (it would pull every note into one knot) unless
 * it's the open note.
 */
export function graphData(notes: Note[], all: Note[], local: boolean, selected: string): GraphData {
  let ids = new Set(notes.filter((n) => n.type !== 'index' || n.id === selected).map((n) => n.id));
  const allById = new Map(all.map((n) => [n.id, n]));
  if (local && selected && allById.has(selected)) ids = around(selected, all, ids);
  return {
    nodes: [...ids].map((id) => allById.get(id)!).filter(Boolean),
    edges: linksBetween(all, ids),
  };
}

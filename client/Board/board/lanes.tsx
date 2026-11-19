'use client';
// Swimlanes (none, by epic or by assignee), grouping issues by status, sub-task progress, and the
// card's redraw signature.
import type { ReactNode } from 'react';
import { type Any, isDone, epic } from '../../core';
import { TypeIcon, Avatar } from '../../ui';
import { codeSig } from '../../codeStatus';

/** zone: where a card dropped in this lane goes; fields: what an issue created in it gets. */
export type Lane = { id: string; title: ReactNode; items: Any[]; zone: Any; fields: Any };

function epicLanes(p: Any, list: Any[]): Lane[] {
  return [
    ...p.epics.map((e: Any) => ({
      id: `e:${e.id}`,
      title: (
        <>
          <TypeIcon type="Epic" />
          <span className="key">{e.key}</span> {e.title}
        </>
      ),
      items: list.filter((t: Any) => t.epicId === e.id),
      zone: { epic: e.id },
      fields: { epicId: e.id },
    })),
    {
      id: 'e:none',
      title: 'Issues without epic',
      items: list.filter((t: Any) => !epic(t.epicId)),
      zone: { epic: null },
      fields: {},
    },
  ];
}

function assigneeLanes(list: Any[]): Lane[] {
  const names = [...new Set(list.map((t: Any) => t.assignee).filter(Boolean))].sort() as string[];
  return [
    ...names.map((n) => ({
      id: `a:${n}`,
      title: (
        <>
          <Avatar name={n} /> {n}
        </>
      ),
      items: list.filter((t: Any) => t.assignee === n),
      zone: { assignee: n },
      fields: { assignee: n },
    })),
    {
      id: 'a:none',
      title: (
        <>
          <Avatar name="" /> Unassigned
        </>
      ),
      items: list.filter((t: Any) => !t.assignee),
      zone: { assignee: null },
      fields: {},
    },
  ];
}

/** Lanes with issues (the single "all" lane always shows). */
export function buildLanes(p: Any, list: Any[], group: string): Lane[] {
  const lanes =
    group === 'epic'
      ? epicLanes(p, list)
      : group === 'assignee'
        ? assigneeLanes(list)
        : [{ id: 'all', title: null, items: list, zone: {}, fields: {} }];
  return lanes.filter((l) => l.items.length || l.id === 'all');
}

/** Status name → its issues, in workflow order (unknown statuses are left out). */
export function byStatus(wf: Any[], items: Any[]) {
  const m = new Map<string, Any[]>(wf.map((w) => [w.name, []]));
  for (const t of items) m.get(t.status)?.push(t);
  return m;
}

/** Issue id → [done, total] sub-tasks, counted once per render rather than per card. */
export function subtaskCounts(tickets: Any[]) {
  const counts = new Map<string, [number, number]>();
  for (const k of tickets)
    if (k.parentId) {
      const c = counts.get(k.parentId) || [0, 0];
      c[1]++;
      if (isDone(k)) c[0]++;
      counts.set(k.parentId, c);
    }
  return counts;
}

/** Everything a card shows: the card redraws only when this changes. */
export const cardSig = (t: Any) =>
  [
    codeSig(t),
    t.updatedAt,
    t.flagged ? 1 : 0,
    t.status,
    t.title,
    t.assignee,
    t.storyPoints,
    t.priority,
    t.epicId,
    t.prs.length,
    (t.links || []).length,
    (t.labels || []).join(),
    (t.comments || []).length,
    (t.testCases || []).map((x: Any) => x.status).join(),
  ].join('|');

'use client';
// How the backlog is grouped: by sprint (the default), epic, status, or not at all.
import {
  type Any,
  P,
  filtered,
  isSub,
  S,
  statusNames,
  epic,
  filtersActive,
  openSprints,
  sprint,
  isDone,
} from '../../core';

export type Group = {
  id: string;
  kind: 'sprint' | 'epic' | 'status' | 'none';
  title: string;
  items: Any[];
  sprint?: Any;
  epic?: Any;
};

function statusGroups(list: Any[]): Group[] {
  return statusNames().map((s) => ({
    id: `s:${s}`,
    kind: 'status',
    title: s,
    items: list.filter((t: Any) => t.status === s),
  }));
}

/** One group per epic, then the issues without one; empty epics show only when nothing is filtered. */
function epicGroups(list: Any[]): Group[] {
  const groups: Group[] = P().epics.map((e: Any) => ({
    id: `e:${e.id}`,
    kind: 'epic',
    epic: e,
    title: e.title,
    items: list.filter((t: Any) => t.epicId === e.id),
  }));
  groups.push({
    id: 'e:none',
    kind: 'epic',
    title: 'Issues without epic',
    items: list.filter((t: Any) => !epic(t.epicId)),
  });
  return groups.filter((g) => g.items.length || (!filtersActive() && g.epic));
}

/**
 * The open sprints (the active one first), then the Backlog: everything not in an open sprint,
 * except finished issues of closed sprints.
 */
function sprintGroups(list: Any[]): Group[] {
  const open = [...openSprints()].sort((a: Any, b: Any) =>
    a.state === 'active' ? -1 : b.state === 'active' ? 1 : 0,
  );
  const inOpen = (t: Any) => open.some((s: Any) => s.id === t.sprintId);
  const doneInClosed = (t: Any) => sprint(t.sprintId)?.state === 'closed' && isDone(t);
  const groups: Group[] = open.map((s: Any) => ({
    id: `sp:${s.id}`,
    kind: 'sprint',
    sprint: s,
    title: s.name,
    items: list.filter((t: Any) => t.sprintId === s.id),
  }));
  groups.push({
    id: 'sp:none',
    kind: 'sprint',
    title: 'Backlog',
    items: list.filter((t: Any) => !inOpen(t) && !doneInClosed(t)),
  });
  return groups;
}

/** The filtered issues in their groups. Sub-tasks show only when filtering for them. */
export function backlogGroups(): Group[] {
  const list = filtered(P().tickets).filter((t: Any) => !isSub(t) || S.filter.type === 'Sub-task');
  if (S.groupBy === 'status') return statusGroups(list);
  if (S.groupBy === 'none') return [{ id: 'all', kind: 'none', title: 'All issues', items: list }];
  if (S.groupBy === 'epic') return epicGroups(list);
  return sprintGroups(list);
}

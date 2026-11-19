'use client';
// Selecting rows, Jira-style: tick boxes, ⌘/Ctrl-click a row to add or remove it, Shift-click to
// select a range.
import { S, can, emit } from '../../core';

let lastPick: string | null = null;
/** The rows on screen, top to bottom (set on every backlog render), for Shift-click ranges. */
let visibleIds: string[] = [];

export const setVisibleIds = (ids: string[]) => {
  visibleIds = ids;
};

/** Whether this person can do anything with selected rows. */
export const showChecks = () =>
  can('issue.edit') || can('issue.delete') || can('sprint.manage') || can('test.run');

/** Selects every row from the last one picked to this one (or just this one). */
export function pickRange(id: string) {
  const a = lastPick ? visibleIds.indexOf(lastPick) : -1;
  const b = visibleIds.indexOf(id);
  if (a < 0 || b < 0) {
    S.checked.add(id);
    lastPick = id;
    return;
  }
  for (const x of visibleIds.slice(Math.min(a, b), Math.max(a, b) + 1)) S.checked.add(x);
}

export function toggleCheck(id: string, on: boolean) {
  if (on) S.checked.add(id);
  else S.checked.delete(id);
  lastPick = id;
  emit();
}

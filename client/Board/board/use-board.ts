'use client';
// What the board shows: the active sprint (or every issue), the filtered issues, the columns
// (one at a time on tablets and phones, collapsed ones as a strip) and the swimlanes.
import { P, activeSprint, S, type Any, filtered, saveUi, emit, can } from '../../core';
import { useNarrow, COLLAPSED_W } from '../Card';
import { buildLanes, byStatus, subtaskCounts } from './lanes';

/** Adds or removes an id from one of the remembered UI sets (collapsed columns or lanes). */
export function flip(set: Set<string>, id: string) {
  if (set.has(id)) set.delete(id);
  else set.add(id);
  saveUi();
  emit();
}

export const laneKey = (id: string) => `lane:${id}`;
export const laneClosed = (id: string) => S.collapsed.has(laneKey(id));

export function useBoard() {
  const p = P();
  const act = activeSprint();
  const useSprint = Boolean(act && !S.boardAll);
  const wf: Any[] = p.workflow;
  const list = filtered(
    useSprint ? p.tickets.filter((t: Any) => t.sprintId === act.id) : p.tickets,
  );
  const group: string = S.boardGroup;
  // Tablets and phones: one column at a time, picked with the tabs above the board (collapsing
  // doesn't apply there).
  const narrow = useNarrow();
  const tab: string = wf.some((w) => w.id === S.boardTab) ? S.boardTab : wf[0]?.id;
  const shown = narrow ? wf.filter((w) => w.id === tab) : wf;
  const isCollapsed = (id: string) => !narrow && S.boardCollapsed.has(id);
  const lanes = buildLanes(p, list, group);
  return {
    p,
    act,
    useSprint,
    wf,
    list,
    group,
    narrow,
    tab,
    shown,
    isCollapsed,
    toggleCol: (id: string) => flip(S.boardCollapsed, id),
    // Column widths: collapsed columns are a narrow strip.
    cols: shown
      .map((w) =>
        narrow ? 'minmax(0, 1fr)' : isCollapsed(w.id) ? `${COLLAPSED_W}px` : 'minmax(264px, 1fr)',
      )
      .join(' '),
    all: byStatus(wf, list),
    kidCount: subtaskCounts(p.tickets),
    lanes,
    createOk: can('issue.create'),
    sprintFields: useSprint ? { sprintId: act.id } : {},
    /** Opens quick create in this column of the first open lane. */
    openCreate: (w: Any) => {
      const l = lanes.find((x) => !laneClosed(x.id));
      if (!l) return;
      S.boardCreate = `${l.id}|${w.id}`;
      emit();
    },
  };
}

export type BoardModel = ReturnType<typeof useBoard>;

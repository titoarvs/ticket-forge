'use client';
// What each backlog row shows, worked out from the project, and the signatures that decide when a
// row has to be drawn again (drawing is what costs with thousands of rows).
import { type Any, P, S, epic, isSub, isDone, idx, releases } from '../../core';
import { codeSig } from '../../codeStatus';

export type RowData = {
  t: Any;
  e: Any;
  kc: [number, number];
  blocked: boolean;
  active: boolean;
  checked: boolean;
  compact: boolean;
  page: string;
  sig: string;
};

type RowFacts = {
  e: Any;
  kids: [number, number];
  blocked: boolean;
  active: boolean;
  checked: boolean;
  showEpic: boolean;
  compact: boolean;
  popped: boolean;
};

/** Everything a row shows, as one string: the row redraws only when this changes. */
function rowSig(t: Any, x: RowFacts) {
  return [
    t.updatedAt,
    t.key,
    t.type,
    t.title,
    t.status,
    t.assignee,
    t.storyPoints,
    t.priority,
    t.flagged ? 1 : 0,
    t.layer,
    (t.labels || []).slice(0, 2).join(','),
    (t.fixVersions || []).join(','),
    x.e ? `${x.e.id}${x.e.title}${x.e.color}` : '',
    t.prs.length,
    codeSig(t),
    x.kids[0],
    x.kids[1],
    +x.blocked,
    +x.active,
    +x.checked,
    +x.showEpic,
    +x.compact,
    +x.popped,
  ].join('|');
}

/** Things every row depends on (workflow colours and transitions, permissions, the current user). */
export const pageSig = () =>
  [
    JSON.stringify(P().workflow),
    P().flowMode,
    S.user?.id,
    (S.user?.permissions || []).length,
    S.user?.name,
    releases()
      .map((r: Any) => r.id + r.name + r.status)
      .join(),
  ].join('|');

/** Whether an open issue blocks this one. */
function isBlocked(t: Any, byId: Map<string, Any>) {
  return (t.links || []).some(
    (l: Any) => l.type === 'is blocked by' && byId.get(l.targetId) && !isDone(byId.get(l.targetId)),
  );
}

export function rowData(t: Any, showEpic: boolean, compact: boolean, page: string): RowData {
  const { byId, kids: kidMap } = idx();
  const e = epic(t.epicId);
  const kids: Any[] = isSub(t) ? [] : kidMap.get(t.id) || [];
  const kc: [number, number] = [kids.filter(isDone).length, kids.length];
  const blocked = isBlocked(t, byId);
  const active = S.drawer?.kind === 'issue' && S.drawer.id === t.id;
  const checked = S.checked.has(t.id);
  const popped = Boolean(S.pop?.ids?.includes(t.id));
  const facts = { e, kids: kc, blocked, active, checked, showEpic, compact, popped };
  return {
    t,
    e: showEpic ? e : null,
    kc,
    blocked,
    active,
    checked,
    compact,
    page,
    sig: rowSig(t, facts),
  };
}

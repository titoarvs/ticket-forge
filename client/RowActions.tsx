'use client';

// Issue row actions, Jira-style. On a backlog row you click the field you want to change (status,
// assignee, story points, priority) and pick from a small popup; "…" (or a right-click on the row)
// has the rest: move to the top or bottom of the backlog or to a sprint, assign to me, flag, epic,
// copy the link, duplicate, delete. When the row is part of a selection, the change applies to
// every selected issue.
// One popup for the whole page (S.pop), drawn by <RowPop />: rows stay light (plain buttons, no
// menus inside them), so a backlog of thousands of issues still scrolls and updates quickly.

export {
  openPop,
  setStatusFor,
  assignTo,
  setPoints,
  setPriority,
  setFlag,
  setEpic,
  moveTo,
  StatusCell,
  AssigneeCell,
  PointsCell,
  PriorityCell,
  MoreCell,
  rowContextMenu,
} from './RowActions/move-to';
export { RowPop } from './RowActions/RowPop';

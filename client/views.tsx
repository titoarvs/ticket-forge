'use client';

// Project views: Summary, Backlog, Board, Epics, Reports, Test cases, Test automation, Source,
// Settings.

export { rowDnd, zoneDnd, Crumbs, Header, FilterBar, epicProgress, ProgBar } from './views/row-dnd';
export { daysLeft, Summary } from './views/Summary';
export { IssueRow, Backlog } from './views/Backlog';
export { BulkBar } from './views/BulkBar';
export { Epics } from './views/Epics';
export { testRows, setTcStatus } from './views/test-rows';
export { Tests } from './views/Tests';
export { Reports } from './views/Reports';
export { automationItems } from './views/automation-items';
export { Automation } from './views/Automation';
export { CommitInput, lines, ShotModal } from './views/ShotModal';

/**
 * The status lozenge and assignee avatar as buttons that open the row popup (also used on the
 * Issues page).
 */
export { StatusCell as RowStatus, AssigneeCell as RowAssignee } from './RowActions';

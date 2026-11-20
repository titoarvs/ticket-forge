'use client';

// Board (Jira-style): one column per workflow status, with sticky column headers, column limits,
// collapsible columns, swimlanes by epic or assignee, and quick create. Assignee, story points and
// priority can be changed on the card itself (the same popups as the backlog rows; they save at
// once and go back if the save fails). On tablets and phones the board shows one column at a time
// with a tab for each, so nothing scrolls sideways. With custom transitions, columns an issue can't
// move to are greyed out while dragging.

export { Board } from './Board/Board';

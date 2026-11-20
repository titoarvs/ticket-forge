'use client';

// Actions (Claude, automation, pull requests, sprints, exports) and the dialogs that go with them.

import { I } from './ui';

export {
  findTc,
  openDrawer,
  loadEngine,
  logout,
  exportAs,
  moveTicket,
  inlineCreate,
  createSubtask,
  duplicateIssue,
  confirmDeleteIssue,
  addEpic,
  delEpic,
  DeleteEpicModal,
  ConvertSubModal,
  convertToSubtask,
} from './actions/move-ticket';
export {
  CreateIssueModal,
  aiTicket,
  openCreateIssue,
  writeWithClaude,
  NewWithClaudeModal,
} from './actions/CreateIssueModal';
export { runTicketAi, AskModal, RegroupModal } from './actions/RegroupModal';
export {
  bulkTests,
  linkPr,
  refreshPr,
  saveComment,
  SprintModal,
  CompleteSprintModal,
} from './actions/bulk-tests';
export {
  createSprint,
  deleteSprint,
  runsOnGitHub,
  runTests,
  collectGitHubRun,
  installBrowser,
} from './actions/run-tests';
export { ScriptModal, AiSettingsModal, ClaudeSettingsModal } from './actions/AiSettingsModal';
export { BlankProjectModal } from './actions/BlankProjectModal';

export { I };

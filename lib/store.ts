// Projects and issues in the database. Clients save with patches (changed issues + changed
// sections), which are checked against the user's permissions and merged per issue, so several
// people can work at once.

export {
  NO_DRAFT_TITLE,
  has,
  projectWorkspace,
  canAccess,
  requireAccess,
  requireProject,
  requirePerm,
  noteVersion,
  listProjects,
  getProject,
  projectJson,
  projectVersion,
  projectChanges,
  createProject,
  canDeleteProject,
  deleteProject,
} from './store/create-project';
export { appendComment } from './store/append-comment';
export { patchProject, listVersions } from './store/patch-project';
export {
  restoreVersion,
  listSpecs,
  codeContext,
  saveSpecs,
  markSpecsReady,
  linkSpecChange,
  approveSpecChange,
  acceptSpecChange,
  importJsonProjects,
  logActivity,
} from './store/restore-version';
export { listActivity } from './store/list-activity';

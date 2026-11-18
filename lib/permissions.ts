// The permission catalogue. Roles are admin-defined sets of these keys.
export const PERMISSIONS = [
  { group: 'Projects', key: 'project.create', label: 'Create and import projects', desc: 'Create projects from documents, blank projects and backups.' },
  { group: 'Projects', key: 'project.settings', label: 'Edit project settings', desc: 'Name, key, summary, workflow statuses, people and automation URL.' },
  { group: 'Projects', key: 'project.repo', label: 'Set up the repository', desc: 'Link a project’s local repository path and connect GitHub (Project settings → Code & GitHub).' },
  { group: 'Projects', key: 'project.database', label: 'Set up the database', desc: 'Connect and test the databases of the app a project builds (Project settings → Database).' },
  { group: 'Projects', key: 'project.delete', label: 'Delete projects', desc: 'Not used to decide who deletes projects: only the project creator and owners can (with their password).' },
  { group: 'Issues', key: 'issue.create', label: 'Create issues', desc: 'Create issues, sub-tasks and duplicates.' },
  { group: 'Issues', key: 'issue.edit', label: 'Edit issues', desc: 'Change any field, acceptance criteria, test cases, links and pull requests; reorder the backlog.' },
  { group: 'Issues', key: 'issue.delete', label: 'Delete issues', desc: 'Delete issues and their sub-tasks.' },
  { group: 'Issues', key: 'issue.restore', label: 'Restore issue versions', desc: 'Restore an issue to one of its saved versions (for admins and managers).' },
  { group: 'Issues', key: 'issue.comment', label: 'Comment', desc: 'Add comments and edit or delete their own comments.' },
  { group: 'Planning', key: 'sprint.manage', label: 'Manage sprints', desc: 'Create, edit, start, complete and delete sprints, and plan issues into them.' },
  { group: 'Planning', key: 'epic.manage', label: 'Manage epics', desc: 'Create, edit, recolour and delete epics, and re-organize issues into epics.' },
  { group: 'Claude & testing', key: 'ai.use', label: 'Use Claude', desc: 'Generate backlogs and use Claude actions (enhance, split, write tests, write issues).' },
  { group: 'Claude & testing', key: 'test.run', label: 'Run test automation', desc: 'Run automated tests, record results and edit automation scripts.' },
  { group: 'Claude & testing', key: 'export', label: 'Export', desc: 'Download Excel, Word, PDF, HTML, CSV and JSON exports.' },
  { group: 'Administration', key: 'users.manage', label: 'Manage users and access', desc: 'Invite users, change roles and project access, define roles, configure email.' },
];
export const ALL = PERMISSIONS.map((p) => p.key);

export const DEFAULT_ROLES = [
  { id: 'admin', name: 'Administrator', description: 'Full access to everything, including users and roles.', permissions: ALL, is_system: true },
  { id: 'lead', name: 'Project lead', description: 'Runs projects: everything except user administration.', permissions: ALL.filter((k) => k !== 'users.manage'), is_system: false },
  { id: 'member', name: 'Team member', description: 'Works on issues, sprints and tests in their projects.', permissions: ['issue.create', 'issue.edit', 'issue.comment', 'sprint.manage', 'ai.use', 'test.run', 'export'], is_system: false },
  { id: 'qa', name: 'QA tester', description: 'Runs tests, records results and comments.', permissions: ['issue.comment', 'test.run', 'export'], is_system: false },
  { id: 'viewer', name: 'Viewer', description: 'Read-only access to their projects; can comment.', permissions: ['issue.comment'], is_system: false },
];

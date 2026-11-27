// The pages of a project: their names, and the feature the owner can lock each with. Plain data, so
// the sidebar can use it without loading the pages themselves (view-list.tsx has those).
export const VIEWS: Record<string, string> = {
  summary: 'Summary',
  issues: 'Issues',
  backlog: 'Backlog',
  board: 'Board',
  epics: 'Epics',
  releases: 'Releases',
  timeline: 'Timeline',
  activity: 'Activity',
  reports: 'Reports',
  tests: 'Test cases',
  testmgmt: 'Test management',
  automation: 'Test automation',
  prs: 'Pull requests',
  codejobs: 'Code jobs',
  source: 'Source documents',
  brain: 'Obsidian',
  settings: 'Project settings',
};
/** Pages that belong to a feature the owner can lock (Administration → Features). */
export const VIEW_FEATURE: Record<string, string> = {
  issues: 'issues',
  board: 'board',
  timeline: 'timeline',
  releases: 'releases',
  activity: 'activity',
  reports: 'reports',
  source: 'source',
  tests: 'tests',
  testmgmt: 'testmgmt',
  automation: 'automation',
  prs: 'prs',
  codejobs: 'code',
  brain: 'brain',
};

'use client';
// The component behind each project page. Names and locks are in views.ts; the sidebar is in
// client/AppShell/.
import { Summary, Backlog, Epics, Reports, Tests, Automation } from '../views';
import { Settings } from '../ProjectSettings';
import { Sources } from '../Sources';
import { Timeline } from '../Timeline';
import { Board } from '../Board';
import { TestManagement } from '../TestRepo';
import { PullRequests } from '../PullRequests';
import { Issues } from '../Issues';
import { Releases } from '../Releases';
import { Activity } from '../Activity';
import { Brain } from '../Brain';
import { ProjectCodeJobs } from '../CodeJobsPage';

export { VIEWS, VIEW_FEATURE } from './views';

export const COMPONENTS: Record<string, () => React.ReactNode> = {
  summary: Summary,
  issues: Issues,
  backlog: Backlog,
  board: Board,
  epics: Epics,
  releases: Releases,
  timeline: Timeline,
  activity: Activity,
  reports: Reports,
  tests: Tests,
  testmgmt: TestManagement,
  automation: Automation,
  prs: PullRequests,
  codejobs: ProjectCodeJobs,
  source: Sources,
  brain: Brain,
  settings: Settings,
};

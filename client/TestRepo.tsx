'use client';

// Test management, in the style of Xray for Jira. Saved on the project as `testRepo`:
//   Tests       reusable test definitions (steps: action / data / expected), in folders, linked to any number of issues
//   Test Plans  sets of tests for a goal (an epic, a sprint, a release), with progress
//   Executions  runs of tests: each test and each step Passed / Failed / Blocked, with comments, evidence and defects
//   Coverage    per issue: OK (all its tests pass), NOK (one fails), Not run, Uncovered
// Issues show their tests in the issue panel (TestsSection). Existing test cases on issues can be imported.

export { RUN_STATUS, repo } from './TestRepo/run-status';
export {
  WF,
  WfLoz,
  wfAction,
  latestRun,
  coverageOf,
  RunLoz,
  CovLoz,
  TestManagement,
} from './TestRepo/TestManagement';
export { openTest } from './TestRepo/open-test';
export { openExecution } from './TestRepo/open-execution';
export { TestsSection, exportTestsCsv } from './TestRepo/TestsSection';
export { recordAutomationResult } from './TestRepo/record-automation-result';

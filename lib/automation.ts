// Test automation: Claude turns test cases into Playwright scripts, which run in a real
// (headless) Chromium against the app under test. Each script runs in its own process.

export {
  RUN_DIR,
  runPrefix,
  browserSpec,
  noBrowser,
  engineStatus,
  installBrowser,
  assertPublicTarget,
  snapshotPage,
  snapshotApp,
  detectLogin,
  testLogin,
} from './automation/snapshot-app';
export {
  discoverPages,
  automationSystem,
  SCRIPT_BASE,
  generateScripts,
  runScript,
} from './automation/discover-pages';
export { runAutomation } from './automation/run-automation';
export { followGitHubRuns } from './automation/follow-github-runs';

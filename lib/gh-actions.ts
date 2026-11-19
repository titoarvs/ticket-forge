// Playwright tests on GitHub Actions. TicketForge sends the run (scripts, App setup with test
// passwords, run settings) to a workflow in a repository you choose, encrypted with a key that only
// TicketForge and that repository's TICKETFORGE_RUN_KEY secret know. The workflow runs the same
// runner TicketForge uses locally (run-one.mjs and its helpers, copied into .github/ticketforge/)
// in Playwright's container, and uploads the encrypted results; TicketForge downloads them and
// records them like any other run (results, screenshots, comments on the issue).
// Works from the deployed TicketForge too: nothing needs to reach TicketForge, it calls GitHub's
// API.

export { SECRET, gh, newRunKey, runnerStatus } from './gh-actions/runner-status';
export { setupRunner, dispatchRuns, checkRun } from './gh-actions/setup-runner';

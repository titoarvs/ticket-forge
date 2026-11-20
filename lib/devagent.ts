// Code generation and pull requests for an issue, on a local clone of the project's GitHub
// repository.
// Each job works in its own git worktree and branch (your checkout is never touched): a TicketForge
// agent (lib/agents.ts) runs as a Claude Code agent and implements the issue there, you review the
// diff in TicketForge, then TicketForge commits, pushes and opens the pull request.
// Local only: it needs the repository folder, git and Claude Code on the machine running
// TicketForge.

export {
  resolveFolder,
  listFolders,
  inspectRepo,
  githubToken,
  getJob,
  listJobs,
  jobForTicket,
  jobsForTicket,
  backendSummary,
  BRAIN_DIR,
  compareJob,
  MAX_PARALLEL,
  queueInfo,
  reviewJob,
  codeRabbitJob,
} from './devagent/review-job';
export { checkTools, issueContext, apiContract, jobDiff } from './devagent/api-contract';
export { startJob, followUp, cancelJob, discardJob, commitLocal } from './devagent/commit-local';
export {
  remoteInfo,
  setUpdateLabel,
  writePrText,
  prDraft,
  pushToPullRequest,
  startPrReview,
  postReview,
} from './devagent/start-pr-review';
export { reviewComments, describePullRequest, openPullRequest } from './devagent/open-pull-request';
export { learnRepo, parseRepoSource, cloneRepo, codeTask, branchFor } from './devagent/clone-repo';

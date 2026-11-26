// What happens to an issue as its AI code moves along:
// - the code job finishes writing: the issue moves to the workflow's review status ("In Review")
//   and the job's branch is attached to it (`ticket.branches`);
// - its pull request is merged (and none of its others is still open): the issue moves to Done.
// Pure helpers with no app state, so they can be tested on their own; client/codeStatus.tsx applies
// them (when it sees a job finish, and on a merge), and client/DevCode/code-modal/pr-actions.ts
// marks a branch pushed when its pull request is opened. Nothing here writes to GitHub.

type Any = any;

/** Job statuses that mean the job's branch holds finished code. */
export const CODE_ON_BRANCH = ['review', 'pr', 'merged', 'committed'];

/**
 * The workflow's review status: an in-progress status named like "review", "In Review" first.
 * '' when the workflow has none (the issue is then left where it is).
 */
export function reviewStatus(workflow: Any[] = []): string {
  const list = workflow.filter(
    (w) => w?.category === 'inprogress' && /\breview/i.test(String(w.name || '')),
  );
  return (list.find((w) => /^in review$/i.test(String(w.name).trim())) || list[0])?.name || '';
}

/**
 * The status to move an issue in `status` to once its code is written, or '' to leave it alone:
 * an issue that is already in review, done, or further along the workflow than review (QA, say)
 * stays put.
 */
export function reviewMoveFor(status: string, workflow: Any[] = []): string {
  const to = reviewStatus(workflow);
  if (!to || status === to) return '';
  const at = workflow.findIndex((w) => w?.name === status);
  if (at >= 0 && workflow[at].category === 'done') return '';
  if (at > workflow.findIndex((w) => w?.name === to)) return '';
  return to;
}

export type BranchLink = {
  name: string;
  base: string;
  repo: string;
  provider: string;
  side: string;
  jobId: string;
  /** Whether the branch is on the remote (pushed); a local branch has no web address yet. */
  pushed: boolean;
  url: string;
  at: string;
};

const OWNER_NAME = /^[\w.-]+\/[\w.-]+$/;

/** The branch's page, when it is pushed to a GitHub repository; '' otherwise. */
export function branchUrl(b: { name: string; repo: string; provider?: string; pushed: boolean }) {
  if (!b.pushed || (b.provider && b.provider !== 'GitHub') || !OWNER_NAME.test(b.repo || ''))
    return '';
  return `https://github.com/${b.repo}/tree/${b.name.split('/').map(encodeURIComponent).join('/')}`;
}

/** The branch a code job wrote its code on, or null when it has none (yet). */
export function branchOfJob(job: Any, at = new Date().toISOString()): BranchLink | null {
  if (!job?.branch || !CODE_ON_BRANCH.includes(job.status)) return null;
  const pushed = job.where === 'github' || Boolean(job.pr) || ['pr', 'merged'].includes(job.status);
  const b = {
    name: String(job.branch),
    base: String(job.base || ''),
    repo: String(job.repo || ''),
    provider: String(job.provider || 'GitHub'),
    side: String(job.side || 'frontend'),
    jobId: String(job.id || ''),
    pushed,
    url: '',
    at,
  };
  return { ...b, url: branchUrl(b) };
}

/**
 * Adds the branch to the issue's `branches`, or updates the entry with the same repository and
 * name (a later round, or the branch now pushed). A pushed branch never goes back to local.
 * Returns 'added', 'updated' or '' (nothing changed).
 */
export function attachBranch(t: Any, b: BranchLink): 'added' | 'updated' | '' {
  if (!t || !b?.name) return '';
  if (!Array.isArray(t.branches)) t.branches = [];
  const old = t.branches.find((x: Any) => x.name === b.name && x.repo === b.repo);
  if (!old) {
    t.branches.push({ ...b });
    return 'added';
  }
  const pushed = old.pushed || b.pushed;
  const next = { ...old, ...b, pushed, url: branchUrl({ ...b, pushed }), at: old.at || b.at };
  if (JSON.stringify(next) === JSON.stringify(old)) return '';
  Object.assign(old, next);
  return 'updated';
}

/** Pull request statuses that mean the work isn't merged yet (Pushed: the branch waits for its PR). */
const PENDING_PR = ['Open', 'Draft', 'Pushed'];

/** The workflow's "Done", else its first status in the done category; '' when it has none. */
export function doneStatus(workflow: Any[] = []): string {
  const done = workflow.filter((w) => w?.category === 'done');
  return (done.find((w) => /^done$/i.test(String(w.name).trim())) || done[0])?.name || '';
}

/**
 * The status to move an issue to now that a pull request of it is merged, or '' to leave it:
 * an issue that is already done, has no merged pull request, or still has one open (a draft, or a
 * pushed branch whose request isn't opened yet) stays put. Declined requests don't count.
 */
export function doneMoveFor(t: Any, workflow: Any[] = []): string {
  const to = doneStatus(workflow);
  if (!t || !to || t.status === to) return '';
  if (workflow.find((w) => w?.name === t.status)?.category === 'done') return '';
  const prs: Any[] = Array.isArray(t.prs) ? t.prs : [];
  if (!prs.some((r) => r?.status === 'Merged')) return '';
  if (prs.some((r) => PENDING_PR.includes(r?.status))) return '';
  return to;
}

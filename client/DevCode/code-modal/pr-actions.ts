'use client';
// What happens after the agent's changes are reviewed: commit locally, open a pull request, push to
// an existing one, approve and merge (TF-123), or post an AI review on the pull request.
import { type Any, api, toast, mutate, logEvent, aiBody, uid, nowIso } from '../../core';
import type { CodeJobs } from './use-code-jobs';
import type { PrForm } from './pr-compose';
import { attachBranch, branchOfJob } from '../../code-review-flow';
import { doneOnMerge } from '../../codeStatus';

export type PrContext = { t: Any; cj: CodeJobs; form: PrForm; reviewedPr?: Any };

const openInTab = (url: string) => window.open(url, '_blank', 'noopener');

/** The job's branch is on the remote now: attach it to the issue, or mark the attached one pushed. */
function attachPushedBranch(t: Any, job: Any, pr: Any) {
  const b = branchOfJob({
    ...job,
    status: 'pr',
    pr,
    branch: pr.branch || job.branch,
    base: pr.base || job.base,
    repo: pr.repo || job.repo,
  });
  if (b && attachBranch(t, b) === 'added') logEvent(t, `attached branch ${b.name}`, 'Development');
}
/** "!" for a GitLab merge request, "#" for a pull request. */
export const prMark = (provider?: string) => (provider === 'GitLab' ? '!' : '#');
export const prNoun = (provider?: string) =>
  provider === 'GitLab' ? 'merge request' : 'pull request';

export async function commitLocal({ t, cj, form }: PrContext) {
  const r = await cj.act('commit', { action: 'commit', title: form.title });
  if (!r?.commit) return;
  cj.setJob(r.job);
  const { branch, sha, repoPath } = r.commit;
  mutate(() => {
    logEvent(
      t,
      `committed the ${cj.side} changes written by AI on the local branch ${branch} (${sha}) in ${repoPath}`,
      'Development',
    );
  });
  toast(`On branch ${branch} in ${repoPath}. Nothing was pushed.`, 'ok', {
    title: `Committed ${sha} locally`,
  });
}

/** The AI drafts the title and description from the diff, the agent's summary and the issue. */
export async function draftPr({ cj, form }: PrContext) {
  cj.setBusy('draft');
  try {
    const r = await api(cj.base, {
      method: 'POST',
      body: aiBody({ action: 'prDraft', jobId: cj.job?.id }),
    });
    form.setTitle(r.title);
    form.setPrBody(r.body);
  } catch (e: Any) {
    toast(`Couldn’t write the description: ${e.message}`, 'err');
  } finally {
    cj.setBusy('');
  }
}

/** Pushes the changes to the pull request the job was started for. */
export async function pushUpdate({ t, cj, form }: PrContext) {
  const { job } = cj;
  const r = await cj.act('push', { action: 'push', message: form.title });
  if (!r?.job) return;
  cj.setJob(r.job);
  const { provider, number, url } = job.target;
  const what = provider === 'GitLab' ? 'merge request !' : 'pull request #';
  mutate(() => {
    logEvent(t, `pushed ${r.commit} to ${what}${number} with changes written by AI`, 'Development');
  });
  toast(
    `Pushed ${r.commit} to ${prMark(provider)}${number}: the ${prNoun(provider)} is updated.`,
    'ok',
    {
      title: 'Changes pushed',
      action: { label: 'Open', onClick: () => openInTab(url) },
    },
  );
}

/** Pushed with your own git setup: the request is opened on GitHub/GitLab (no token to open it here). */
function pushedForCompare(t: Any, job: Any, pr: Any) {
  const noun = prNoun(job.provider);
  mutate(() => {
    attachPushedBranch(t, job, pr);
    logEvent(t, `pushed ${pr.branch} with code written by AI`, 'Development');
  });
  toast(`Pushed ${pr.branch}. Open the ${noun} on ${job.provider || 'GitHub'} to finish.`, 'ok', {
    title: 'Branch pushed',
    action: { label: `Open ${noun}`, onClick: () => openInTab(pr.url) },
  });
  openInTab(pr.url);
}

export async function openPr({ t, cj, form }: PrContext) {
  const { job } = cj;
  const body = form.prBody.trim() || undefined;
  const r = await cj.act('pr', { action: 'pr', title: form.title, draft: form.draft, body });
  if (!r?.pr) return;
  cj.setJob(r.job);
  if (r.pr.compare) return pushedForCompare(t, job, r.pr);
  mutate(() => {
    attachPushedBranch(t, job, r.pr);
    t.prs.push({ id: uid(), ...r.pr, checkedAt: nowIso() });
    logEvent(
      t,
      `opened ${prNoun(job.provider)} ${r.pr.repo} #${r.pr.number} with code written by AI`,
      'Development',
    );
  });
  toast(`Opened ${r.pr.repo} #${r.pr.number}`);
}

/** Records an approval; when it fails the job is read again for the current count. */
export async function approve({ cj }: PrContext) {
  const r = await cj.act('approve', { action: 'approve' });
  if (r) toast(`Approved ${r.approvals?.length || 0} of ${r.required}`);
  else await cj.reloadJob();
}

/** Merges the pull request. A blocked merge still records the approval, so the job is read again. */
export async function merge({ t, cj }: PrContext) {
  const r = await cj.act('merge', { action: 'merge' });
  if (!r) return cj.reloadJob();
  mutate(() => {
    const pr = t.prs.find(
      (x: Any) =>
        (x.url && x.url === r.pr?.url) ||
        (x.number && x.number === r.pr?.number && x.repo === r.repo),
    );
    if (pr) {
      pr.status = 'Merged';
      pr.mergedAt = r.merged?.at || nowIso();
    }
    logEvent(
      t,
      `merged pull request #${r.pr?.number} after ${r.approvals?.length || 0} of ${r.required} approvals`,
      'Development',
    );
  });
  toast(`${r.repo} #${r.pr?.number} is merged.`, 'ok', {
    title: 'Code merged',
    action: r.pr?.url ? { label: 'Open', onClick: () => openInTab(r.pr.url) } : undefined,
  });
  await doneOnMerge(t);
}

/** Posts the AI review as a comment on the pull request it reviewed. */
export async function postReview({ cj, reviewedPr }: PrContext) {
  const { job } = cj;
  const r = await cj.act('postReview', { action: 'postReview' });
  if (!r?.id) return;
  if (reviewedPr)
    mutate(() => {
      reviewedPr.aiReview = { ...(reviewedPr.aiReview || {}), posted: r.posted };
    });
  const { provider, number, url } = job.target;
  toast(`The review is a comment on ${prMark(provider)}${number} now.`, 'ok', {
    title: 'Review posted',
    action: { label: 'Open', onClick: () => openInTab(url) },
  });
}

'use client';
// Everything shown once a job exists, from its header down to the pull request.
import { type Any, can } from '../../core';
import { Ico, I } from '../../ui';
import { JobSteps, ApprovalBox } from '../ApprovalBox';
import type { CodeJobs } from './use-code-jobs';
import { type PrContext, approve, merge, postReview } from './pr-actions';
import { JobHeader } from './job-header';
import { JobTabs, type TabState } from './job-tabs';
import { AskForChanges, ReviewButtons } from './follow-up';
import { UpdatePrBox, NewPrBox } from './pr-compose';
import { CommittedBanner, PushedBanner, PrOpenBanner } from './banners';

type JobViewProps = {
  t: Any;
  ctx: PrContext;
  ui: TabState;
  isPrReview: boolean;
  onDiscarded: () => void;
};

/** Statuses after which you can ask the agent for more changes. */
const CAN_FOLLOW = ['review', 'report', 'empty', 'failed', 'cancelled'];

export function JobView({ t, ctx, ui, isPrReview, onDiscarded }: JobViewProps) {
  const cj: CodeJobs = ctx.cj;
  const { job, busy } = cj;
  const inReview = job.status === 'review';
  return (
    <>
      <JobHeader cj={cj} onDiscarded={onDiscarded} />
      <JobSteps job={job} />
      {job.error && (
        <div className="warn-banner danger">
          <Ico svg={I.warn} />
          <span>{job.error}</span>
        </div>
      )}
      <JobTabs t={t} cj={cj} ui={ui} isPrReview={isPrReview} onPost={() => postReview(ctx)} />
      {job.remote && ['review', 'pr', 'merged'].includes(job.status) && (
        <ApprovalBox
          job={job}
          busy={busy}
          onApprove={() => approve(ctx)}
          onMerge={() => merge(ctx)}
        />
      )}
      {CAN_FOLLOW.includes(job.status) && <AskForChanges cj={cj} />}
      {inReview && !job.pr && !job.remote && <ReviewButtons cj={cj} ui={ui} />}
      {job.status === 'committed' && (
        <CommittedBanner job={job} t={t} side={cj.side} onFrontend={() => cj.setSide('frontend')} />
      )}
      {inReview && can('issue.edit') && job.target && <UpdatePrBox ctx={ctx} />}
      {inReview && can('issue.edit') && !job.target && <NewPrBox ctx={ctx} />}
      {job.pr?.compare && <PushedBanner job={job} />}
      {job.pr && !job.pr.compare && job.status !== 'merged' && <PrOpenBanner job={job} />}
    </>
  );
}

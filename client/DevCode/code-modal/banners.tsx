'use client';
// What happened to the changes: committed locally, pushed for you to open the request, or opened.
import type { Any } from '../../core';
import { Ico, I } from '../../ui';
import { prMark, prNoun } from './pr-actions';

export function CommittedBanner({
  job,
  t,
  side,
  onFrontend,
}: {
  job: Any;
  t: Any;
  side: string;
  onFrontend: () => void;
}) {
  const next = side === 'backend' && t.layer === 'both';
  return (
    <div className="ok-banner">
      <Ico svg={I.check} />
      <span>
        Committed on the local branch <code>{job.branch}</code> in <code>{job.repoPath}</code>.
        Nothing was pushed.
        {next ? ' Next: the Frontend tab, which builds on this API.' : ''}
      </span>
      {next && (
        <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={onFrontend}>
          Go to Frontend
        </button>
      )}
    </div>
  );
}

/** Pushed with your own git setup: the request still has to be opened on GitHub or GitLab. */
export function PushedBanner({ job }: { job: Any }) {
  return (
    <div className="ok-banner">
      <Ico svg={I.check} />
      <span>
        Committed and pushed <code>{job.branch}</code> with your git setup.{' '}
        <a href={job.pr.url} target="_blank" rel="noopener noreferrer">
          Open the {prNoun(job.provider)} on {job.provider || 'GitHub'}
        </a>{' '}
        to finish; link it to this issue in Development once it’s open.
      </span>
    </div>
  );
}

export function PrOpenBanner({ job }: { job: Any }) {
  return (
    <div className="ok-banner">
      <Ico svg={I.check} />
      <span>
        {job.provider === 'GitLab' ? 'Merge request' : 'Pull request'}{' '}
        <a href={job.pr.url} target="_blank" rel="noopener noreferrer">
          {prMark(job.provider)}
          {job.pr.number} {job.pr.title}
        </a>{' '}
        {job.target
          ? 'is updated with these changes.'
          : `is open${job.pr.draft ? ' as a draft' : ''} and linked to this issue.`}
      </span>
    </div>
  );
}

'use client';
// The running or finished job: its status, agent and round, Stop / Discard, and where it works.
import { type Any, openModal, ago } from '../../core';
import { Spinner, Ico, I, Confirm } from '../../ui';
import { STATUS } from '../ApprovalBox';
import type { CodeJobs } from './use-code-jobs';

const statusIcon = (status: string) =>
  ['failed', 'cancelled'].includes(status)
    ? I.warn
    : ['empty', 'discarded'].includes(status)
      ? I.clock
      : I.check;

function confirmDiscard(cj: CodeJobs, onDiscarded: () => void) {
  openModal(
    <Confirm
      title="Discard these changes?"
      label="Discard"
      text={`The worktree and the local branch ${cj.job.branch} are removed. Nothing was pushed.`}
      onYes={async () => {
        await cj.act('discard', { action: 'discard' });
        cj.setJob(null);
        onDiscarded();
      }}
    />,
  );
}

function JobMeta({ job }: { job: Any }) {
  return (
    <div className="cj-meta small">
      <span className="cj-branch" title={`${job.branch} → ${job.base}`}>
        <Ico svg={I.pr} />
        <code>{job.branch}</code>
        <span className="muted">→</span>
        <code>{job.base}</code>
      </span>
      <span>
        <Ico svg={I.folder} />
        {job.repo || 'local repository'}
      </span>
      <span>
        <Ico svg={I.clock} />
        Started {ago(job.startedAt)}
      </span>
      {job.remote && (
        <span>
          <Ico svg={I.external} />
          {job.runUrl ? (
            <a href={job.runUrl} target="_blank" rel="noopener noreferrer">
              GitHub Actions run
            </a>
          ) : (
            'AI API + GitHub'
          )}
        </span>
      )}
      {job.costUsd ? <span>${job.costUsd.toFixed(2)}</span> : null}
    </div>
  );
}

/** onDiscarded: what to show once the job is discarded (a fresh start screen). */
export function JobHeader({ cj, onDiscarded }: { cj: CodeJobs; onDiscarded: () => void }) {
  const { job, running } = cj;
  return (
    <div className="cj-head">
      <div className="cj-title">
        <span className={`cj-badge s-${job.status}`}>
          {running ? <Spinner /> : <Ico svg={statusIcon(job.status)} />}
          {STATUS[job.status] || job.status}
        </span>
        {job.agentName && (
          <span className="cj-agent">
            <Ico svg={I.bot} />
            {job.agentName}
          </span>
        )}
        {job.rounds > 1 && <span className="cj-agent">Round {job.rounds}</span>}
        <span className="spacer" />
        {running && (
          <button className="btn sm" onClick={() => cj.act('cancel', { action: 'cancel' })}>
            <Ico svg={I.stop} />
            Stop
          </button>
        )}
        {!running && !['pr', 'merged'].includes(job.status) && (
          <button className="btn sm subtle" onClick={() => confirmDiscard(cj, onDiscarded)}>
            <Ico svg={I.trash} />
            Discard
          </button>
        )}
      </div>
      <JobMeta job={job} />
    </div>
  );
}

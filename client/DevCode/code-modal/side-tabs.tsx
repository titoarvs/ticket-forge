'use client';
// Projects with a separate backend: a tab per repository, each with the state of its job.
import type { Any } from '../../core';
import { Spinner, LAYER_LABEL } from '../../ui';
import { be, myPath } from '../FolderPicker';
import { dev } from '../dev';
import { STATUS } from '../ApprovalBox';
import { type CodeJobs, isRunning } from './use-code-jobs';

function SideState({ j }: { j: Any }) {
  if (isRunning(j))
    return (
      <>
        <Spinner /> {j.status === 'queued' ? 'waiting' : 'working'}
      </>
    );
  return <>{j && j.status !== 'discarded' ? STATUS[j.status] || j.status : 'Not started'}</>;
}

function LayerHint({ t }: { t: Any }) {
  if (!t.layer) return <>Mark the issue frontend, backend or both in its details.</>;
  return (
    <>
      This issue is marked <b>{LAYER_LABEL[t.layer]}</b>.
      {t.layer === 'both'
        ? ' Build both at once, or the backend first so the frontend gets its API summary.'
        : ''}
    </>
  );
}

export function SideTabs({ t, cj }: { t: Any; cj: CodeJobs }) {
  return (
    <div className="side-tabs" role="tablist" aria-label="Repository">
      {(['backend', 'frontend'] as const).map((k) => (
        <button
          key={k}
          role="tab"
          aria-selected={cj.side === k}
          className={cj.side === k ? 'on' : ''}
          onClick={() => cj.setSide(k)}
        >
          <span className={`layer-chip l-${k}`}>{k === 'backend' ? 'Backend' : 'Frontend'}</span>
          <span className="muted small">
            {k === 'backend' ? be().repo || myPath('backend') : dev().repo || myPath('frontend')}
          </span>
          <span className="side-state small">
            <SideState j={cj.jobs[k]} />
          </span>
        </button>
      ))}
      <span className="side-hint small muted">
        <LayerHint t={t} />
      </span>
    </div>
  );
}

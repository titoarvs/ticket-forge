'use client';
// Write code with AI for one issue: start, watch, review, ask for changes, open the pull request.
// CodeView is the content; it fills the Code job page (/p/<id>/code/<issueId>, CodePage.tsx) and,
// for the few places that still want it in place, the CodeModal. This file only puts the parts in
// client/DevCode/code-modal/ together.
import { useState, useEffect } from 'react';
import { type Any } from '../core';
import { Modal, Spinner } from '../ui';
import { useCodeJobs, type CodeJobs } from './code-modal/use-code-jobs';
import { useReviewedPr } from './code-modal/review-verdict';
import { usePrForm } from './code-modal/pr-compose';
import { prMark } from './code-modal/pr-actions';
import { SideTabs } from './code-modal/side-tabs';
import { StartPanel } from './code-modal/start-panel';
import { JobView } from './code-modal/job-view';

type CodeModalProps = { t: Any; agentId?: string; initialSide?: string };

/** The API both repositories' jobs agreed on ("Build both at once"). */
function ContractBox({ contract }: { contract: string }) {
  return (
    <details className="contract-box">
      <summary className="small">
        <b>API contract</b> <span className="muted">shared by the backend and frontend jobs</span>
      </summary>
      <pre>{contract}</pre>
    </details>
  );
}

/** "Write code" or "Code review · #12": what the job shown is. */
export function codeTitle(job: Any) {
  return job?.kind === 'pr-review' && job.target
    ? `Code review · ${prMark(job.target.provider)}${job.target.number}`
    : 'Write code';
}

/** The content: the repository tabs, then the start panel or the job. */
export function CodeView({
  t,
  cj,
  onDiscarded,
}: {
  t: Any;
  cj: CodeJobs;
  onDiscarded: () => void;
}) {
  const form = usePrForm(t);
  const [contract, setContract] = useState('');
  const [tab, setTab] = useState('');
  const [reviewTab, setReviewTab] = useState(0);
  const { job, loading } = cj;
  useEffect(() => {
    setTab('');
  }, [job?.id]);
  const { isPrReview, reviewedPr } = useReviewedPr(t, job);
  const noJob = !job || job.status === 'discarded';
  return (
    <>
      {cj.backend && !loading && <SideTabs t={t} cj={cj} />}
      {contract && <ContractBox contract={contract} />}
      {loading ? (
        <div className="muted">
          <Spinner /> Loading…
        </div>
      ) : noJob ? (
        <StartPanel t={t} cj={cj} setContract={setContract} />
      ) : (
        <JobView
          t={t}
          ctx={{ t, cj, form, reviewedPr }}
          ui={{ tab, setTab, reviewTab, setReviewTab }}
          isPrReview={isPrReview}
          onDiscarded={onDiscarded}
        />
      )}
    </>
  );
}

export function CodeModal({ t, agentId = 'build', initialSide }: CodeModalProps) {
  const [round, setRound] = useState(0);
  return (
    <CodeModalRound
      key={round}
      t={t}
      agentId={agentId}
      initialSide={initialSide}
      again={() => setRound(round + 1)}
    />
  );
}

function CodeModalRound({
  t,
  agentId = 'build',
  initialSide,
  again,
}: CodeModalProps & { again: () => void }) {
  const cj = useCodeJobs(t, agentId, initialSide);
  return (
    <Modal
      title={`${codeTitle(cj.job)} · ${t.key}`}
      wide="xl"
      persistent={cj.running}
      actions={[{ label: cj.running ? 'Close (keeps running)' : 'Close' }]}
    >
      <CodeView t={t} cj={cj} onDiscarded={again} />
    </Modal>
  );
}

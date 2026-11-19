'use client';
// Issue panel → Write code with AI: start, watch, review, ask for changes, open the pull request.
// This component only puts the parts in client/DevCode/code-modal/ together.
import { useState, useEffect } from 'react';
import { type Any, openModal } from '../core';
import { Modal, Spinner } from '../ui';
import { useCodeJobs } from './code-modal/use-code-jobs';
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

export function CodeModal({ t, agentId = 'build', initialSide }: CodeModalProps) {
  const cj = useCodeJobs(t, agentId, initialSide);
  const form = usePrForm(t);
  const [contract, setContract] = useState('');
  const [tab, setTab] = useState('');
  const [reviewTab, setReviewTab] = useState(0);
  const { job, running, loading } = cj;
  useEffect(() => {
    setTab('');
  }, [job?.id]);
  const { isPrReview, reviewedPr } = useReviewedPr(t, job);

  const title = isPrReview
    ? `Code review · ${prMark(job.target.provider)}${job.target.number}`
    : 'Write code';
  const noJob = !job || job.status === 'discarded';
  return (
    <Modal
      title={`${title} · ${t.key}`}
      wide="xl"
      persistent={running}
      actions={[{ label: running ? 'Close (keeps running)' : 'Close' }]}
    >
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
          onDiscarded={() => openModal(<CodeModal t={t} />)}
        />
      )}
    </Modal>
  );
}

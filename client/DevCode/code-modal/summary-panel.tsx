'use client';
// The Summary / Report tab: the verdict, posting a review on the pull request, downloads, and the
// agent's write-up.
import { type Any, P, toast, ago, can, downloadFrom, saveBlob } from '../../core';
import { Spinner, Ico, I } from '../../ui';
import { Markdown } from '../../GuideCard';
import type { CodeJobs } from './use-code-jobs';
import { prMark } from './pr-actions';
import { reportVerdict } from './review-verdict';

type SummaryProps = { cj: CodeJobs; isPrReview: boolean; onPost: () => void };

async function downloadDocx(job: Any) {
  try {
    const name = await downloadFrom(`/api/projects/${P().id}/code`, {
      body: { action: 'docx', jobId: job.id },
      fallbackName: `${job.agentName} - ${job.ticketKey}.docx`,
    });
    toast(`Downloaded ${name}`);
  } catch (e: Any) {
    toast(`Couldn’t download the report: ${e.message}`, 'err');
  }
}

const downloadMd = (job: Any) =>
  saveBlob(
    new Blob([job.summary], { type: 'text/markdown' }),
    `${job.agentName} - ${job.ticketKey}.md`,
  );

/** Post the review on the pull request (once), and open it. */
function PostReview({ cj, onPost }: Omit<SummaryProps, 'isPrReview'>) {
  const { job, busy } = cj;
  const mark = `${prMark(job.target.provider)}${job.target.number}`;
  return (
    <>
      {job.posted ? (
        <span className="muted small">
          <Ico svg={I.check} /> Posted on {mark} {ago(job.posted)}
        </span>
      ) : (
        <button className="btn sm primary" disabled={!!busy} onClick={onPost}>
          {busy === 'postReview' ? (
            <>
              <Spinner />
              Posting…
            </>
          ) : (
            <>
              <Ico svg={I.comment} />
              Post on {mark}
            </>
          )}
        </button>
      )}
      <a className="btn sm subtle" href={job.target.url} target="_blank" rel="noopener noreferrer">
        <Ico svg={I.external} />
        Open
      </a>
    </>
  );
}

function SummaryToolbar({ cj, isPrReview, onPost, verdict }: SummaryProps & { verdict: Any }) {
  const { job } = cj;
  const report = job.status === 'report';
  if (!verdict.text && !(report && (isPrReview || can('export')))) return null;
  return (
    <div className="cj-toolbar">
      {verdict.text && (
        <span className={`cj-verdict v-${verdict.tone}`}>
          <Ico svg={verdict.tone === 'ok' ? I.check : I.warn} />
          {verdict.text}
        </span>
      )}
      <span className="spacer" />
      {isPrReview && report && <PostReview cj={cj} onPost={onPost} />}
      {report && can('export') && (
        <>
          <button className="btn sm subtle" onClick={() => downloadDocx(job)}>
            <Ico svg={I.download} />
            .docx
          </button>
          <button className="btn sm subtle" onClick={() => downloadMd(job)}>
            <Ico svg={I.download} />
            .md
          </button>
        </>
      )}
    </div>
  );
}

export function SummaryPanel(props: SummaryProps) {
  const { job } = props.cj;
  const verdict = reportVerdict(job.summary || '');
  const text = verdict.text
    ? job.summary.replace(/^\s*\*\*Verdict:[^*]*\*\*\s*/i, '')
    : job.summary;
  return (
    <>
      <SummaryToolbar {...props} verdict={verdict} />
      <div className="cj-doc code-md">
        <Markdown text={text} />
      </div>
    </>
  );
}

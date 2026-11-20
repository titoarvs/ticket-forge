'use client';
import { type Any, S, ago } from '../core';
import { Ico, I, Spinner } from '../ui';

export const STATUS: Record<string, string> = {
  committed: 'Committed locally',
  report: 'Report ready',
  starting: 'Starting…',
  queued: 'Waiting for a free agent slot',
  running: 'Claude Code is working…',
  review: 'Ready for review',
  empty: 'No changes',
  failed: 'Failed',
  cancelled: 'Stopped',
  pr: 'Pull request open',
  merged: 'Merged',
  discarded: 'Discarded',
};
/**
 * Approvals on a code job (TF-123): who approved, the count against what the project asks for, and
 * Approve / Approve and merge. Any member who can open the project can approve; merging needs the
 * pull request to be open. Not enough approvals blocks the merge with how many are still needed
 * (the server's message).
 */
export function ApprovalBox({
  job,
  busy,
  onApprove,
  onMerge,
}: {
  job: Any;
  busy: string;
  onApprove: () => void;
  onMerge: () => void;
}) {
  const approvals: Any[] = job.approvals || [];
  const need = job.required || 1;
  const mine = approvals.some((a) => a.userId === S.user?.id);
  if (job.status === 'merged')
    return (
      <div className="ok-banner" role="status">
        <Ico svg={I.check} />
        <span>
          {job.pr?.url ? (
            <>
              Pull request{' '}
              <a href={job.pr.url} target="_blank" rel="noopener noreferrer">
                #{job.pr.number}
              </a>{' '}
              merged
            </>
          ) : (
            'Merged'
          )}
          {job.merged?.by ? (
            <>
              {' '}
              by <b>{job.merged.by}</b>
            </>
          ) : (
            ''
          )}
          {job.merged?.at ? ` ${ago(job.merged.at)}` : ''}
          {job.merged?.sha ? (
            <>
              {' '}
              (<code>{job.merged.sha}</code>)
            </>
          ) : (
            ''
          )}{' '}
          with{' '}
          <b>
            {approvals.length} of {need}
          </b>{' '}
          approval{need === 1 ? '' : 's'}
          {approvals.length ? `: ${approvals.map((a) => a.name).join(', ')}` : ''}.
        </span>
      </div>
    );
  return (
    <div className="cj-approve">
      <div className="cj-approve-h">
        <b>Approvals</b>
        <span className={`cj-approve-n ${approvals.length >= need ? 'ok' : ''}`} aria-live="polite">
          {approvals.length} of {need}
        </span>
        <span className="muted small">
          {approvals.length >= need
            ? 'Enough approvals to merge.'
            : `${need - approvals.length} more approval${need - approvals.length === 1 ? '' : 's'} needed.`}
        </span>
      </div>
      {approvals.length > 0 && (
        <ul className="cj-approve-list small">
          {approvals.map((a) => (
            <li key={a.userId}>
              <Ico svg={I.check} />
              {a.name}
              <span className="muted"> · {ago(a.at)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="cj-approve-btns">
        <button
          className="btn"
          disabled={!!busy || mine}
          onClick={onApprove}
          title={mine ? 'You already approved this code' : 'Approve this code'}
        >
          {busy === 'approve' ? (
            <>
              <Spinner />
              Approving…
            </>
          ) : (
            <>
              <Ico svg={I.check} />
              {mine ? 'You approved' : 'Approve'}
            </>
          )}
        </button>
        {job.status === 'pr' && job.pr ? (
          <button
            className="btn primary"
            disabled={!!busy}
            onClick={onMerge}
            title={`Approves, then merges pull request #${job.pr.number} on GitHub once there are ${need} approval${need === 1 ? '' : 's'}`}
          >
            {busy === 'merge' ? (
              <>
                <Spinner />
                Merging…
              </>
            ) : (
              <>
                <Ico svg={I.pr} />
                Approve and merge
              </>
            )}
          </button>
        ) : (
          <span className="muted small">Open the pull request to merge it.</span>
        )}
      </div>
    </div>
  );
}
/**
 * Where the job is: set up → agent working → your review → shipped (or the report, for read-only
 * agents).
 */
export function JobSteps({ job }: { job: Any }) {
  const report = job.status === 'report' || job.kind === 'pr-review';
  const steps = report
    ? ['Set up', 'Agent reading', 'Report ready']
    : ['Set up', 'Agent working', 'Your review', job.target ? 'Pushed' : 'Pull request'];
  const at: Record<string, number> = {
    starting: 0,
    queued: 0,
    running: 1,
    review: 2,
    empty: 2,
    failed: 1,
    cancelled: 1,
    report: 2,
    committed: 3,
    pr: 3,
    merged: 3,
  };
  const cur = at[job.status] ?? 1;
  const bad = ['failed', 'cancelled'].includes(job.status);
  const finished = report
    ? job.status === 'report'
    : ['committed', 'pr', 'merged'].includes(job.status);
  return (
    <ol className="cj-steps">
      {steps.map((label, i) => {
        const state =
          i < cur || (finished && i === cur) ? 'done' : i === cur ? (bad ? 'bad' : 'on') : '';
        return (
          <li key={label} className={state}>
            <span className="dot">
              {state === 'done' ? <Ico svg={I.check} /> : state === 'bad' ? '!' : i + 1}
            </span>
            <span>
              {job.status === 'committed' && i === 3
                ? 'Committed'
                : job.status === 'merged' && i === 3
                  ? 'Merged'
                  : label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
const VERB_RE =
  /^(\s*↳\s*)?(Reading|Editing|Writing|Finding files|Searching|Listing|Running|Planning:|Delegating to)\s*([\s\S]*)$/;
const VERB_ICON: Record<string, string> = {
  Reading: I.doc,
  Editing: I.pencil,
  Writing: I.pencil,
  'Finding files': I.search,
  Searching: I.search,
  Listing: I.folder,
  Running: I.play,
  'Planning:': I.check,
  'Delegating to': I.bot,
};
const KIND_ICON: Record<string, string> = {
  info: I.clock,
  text: I.comment,
  done: I.check,
  error: I.warn,
  warn: I.warn,
  you: I.user,
};
const hhmm = (at: string) => {
  try {
    return new Date(at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
};
/** The agent's steps as a timeline: tool calls as compact rows, messages as text. */
export function Activity({ log, running }: { log: Any[]; running: boolean }) {
  return (
    <ol className="cj-feed">
      {log.map((l: Any, i: number) => {
        const m = l.kind === 'tool' ? String(l.text).match(VERB_RE) : null;
        if (m)
          return (
            <li key={i} className={`ev tool${m[1] ? ' sub' : ''}`}>
              <span className="ev-ic">
                <Ico svg={VERB_ICON[m[2]] || I.play} />
              </span>
              <span className="ev-verb">{m[2].replace(':', '')}</span>
              <code className="ev-arg" title={m[3]}>
                {m[3].split('\n')[0]}
              </code>
              <time>{hhmm(l.at)}</time>
            </li>
          );
        return (
          <li key={i} className={`ev k-${l.kind}`}>
            <span className="ev-ic">
              <Ico svg={KIND_ICON[l.kind] || I.clock} />
            </span>
            <span className="ev-text">{l.text}</span>
            <time>{hhmm(l.at)}</time>
          </li>
        );
      })}
      {running && (
        <li className="ev live">
          <span className="ev-ic">
            <Spinner />
          </span>
          <span className="ev-text muted">Working…</span>
        </li>
      )}
    </ol>
  );
}

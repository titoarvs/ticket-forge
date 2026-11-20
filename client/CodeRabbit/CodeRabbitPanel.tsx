'use client';
import { type Any, mutate, logEvent, newTicket, addLink, toast, ago } from '../core';
import { Spinner, Ico, I } from '../ui';
import { openDrawer } from '../actions';
import { FindingsList } from './FindingsList';

export const SEVS = ['critical', 'major', 'minor', 'trivial', 'info'];
export const SEV_LABEL: Record<string, string> = {
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
  trivial: 'Trivial',
  info: 'Info',
};
const SEV_PRIORITY: Record<string, string> = {
  critical: 'Highest',
  major: 'High',
  minor: 'Medium',
  trivial: 'Low',
  info: 'Low',
};
export const FINDING_STATUS: Record<string, string> = {
  open: 'Open',
  bug: 'Filed as bug',
  agent: 'Sent to agent',
  resolved: 'Resolved on PR',
  dismissed: 'Dismissed',
};
export const SevChip = ({ s }: { s: string }) => (
  <span className={`sev-chip sev-${s}`}>{SEV_LABEL[s] || s}</span>
);
export const where = (f: Any) =>
  `${f.file}${f.startLine ? `:${f.startLine}${f.endLine && f.endLine !== f.startLine ? `-${f.endLine}` : ''}` : ''}`;
/** The saved review for this job round on the issue, or null. */
const savedReview = (t: Any, job: Any) =>
  (t.codeReviews || []).find((r: Any) => r.jobId === job.id && r.round === job.coderabbit?.round);
/** Saves a finished CodeRabbit review on the issue (once per job round). */
export function saveReview(t: Any, job: Any) {
  const cr = job.coderabbit;
  if (!cr || cr.status !== 'done' || savedReview(t, job)) return;
  mutate(() => {
    (t.codeReviews ??= []).push({
      id: `${job.id}-${cr.round}`,
      source: 'CodeRabbit',
      jobId: job.id,
      round: cr.round,
      side: job.side,
      branch: job.branch,
      at: cr.finishedAt,
      warning: cr.warning || '',
      findings: cr.findings.map((f: Any) => ({ ...f, status: 'open' })),
    });
    logEvent(
      t,
      `CodeRabbit reviewed the ${job.side} changes: ${cr.findings.length} finding${cr.findings.length === 1 ? '' : 's'}`,
      'Development',
    );
  });
}
/**
 * Files a finding as a Bug issue linked to the issue it came from. Call inside nothing: it mutates
 * itself.
 */
export function fileBug(t: Any, review: Any, f: Any, { quiet = false } = {}) {
  if (f.status === 'bug') return null;
  let bug: Any = null;
  mutate((p: Any) => {
    bug = newTicket({
      type: 'Bug',
      title: f.title.slice(0, 200) || `Code review finding in ${f.file}`,
      epicId: t.epicId || null,
      priority: SEV_PRIORITY[f.severity] || 'Medium',
      labels: ['coderabbit', f.severity],
      ...(review.side ? { layer: review.side } : {}),
      description: [
        review.origin === 'pr'
          ? `Found by CodeRabbit on ${review.prRef} (${review.prUrl}) for ${t.key}.`
          : `Found by CodeRabbit while reviewing ${t.key} (${review.side || 'code'}, branch ${review.branch}).`,
        '',
        `Location: ${where(f)}`,
        f.url ? `Comment: ${f.url}` : '',
        '',
        f.comment || '',
        f.fix ? `\nHow to fix:\n${f.fix}` : '',
      ]
        .join('\n')
        .trim(),
      acceptanceCriteria: [
        `The problem at ${where(f)} is fixed`,
        'A test covers the case that failed',
      ],
    });
    p.tickets.push(bug);
    addLink(bug, 'relates to', t);
    f.status = 'bug';
    f.bugKey = bug.key;
    f.bugId = bug.id;
    logEvent(t, `filed ${bug.key} from a CodeRabbit finding (${f.severity})`, 'Development');
  });
  if (!quiet && bug)
    toast(`Created ${bug.key}`, 'ok', {
      action: { label: 'Open', onClick: () => openDrawer('issue', bug.id) },
    });
  return bug;
}
export const setStatus = (f: Any, status: string) =>
  mutate(() => {
    f.status = status;
  });
/** The text the Build agent gets for findings. */
export const fixText = (list: Any[]) =>
  `Fix these CodeRabbit review findings. For each one, change the code, keep the change focused, and say in your summary what you did (or why you disagree):\n\n${list.map((f, i) => `${i + 1}. [${f.severity}] ${where(f)}: ${f.title}\n${(f.fix || f.comment || '').slice(0, 2500)}`).join('\n\n')}`;
/** The CodeRabbit tab of a code job. */
export function CodeRabbitPanel({
  t,
  job,
  busy,
  run,
  follow,
}: {
  t: Any;
  job: Any;
  busy: string;
  run: () => void;
  follow: (text: string) => void;
}) {
  const cr = job.coderabbit;
  const review = savedReview(t, job);
  const findings: Any[] = review?.findings || cr?.findings || [];
  if (!cr) return <p className="muted">No CodeRabbit review yet.</p>;
  if (cr.status === 'running')
    return (
      <div className="cr-run">
        <Spinner />
        <div>
          <b>CodeRabbit is reviewing the changes</b>
          <div className="muted small">
            Started {ago(cr.startedAt)} · reviews usually take several minutes; you can close this
            window.
            {cr.log?.length ? ` ${cr.log[cr.log.length - 1]}` : ''}
          </div>
          {findings.length > 0 && (
            <div className="small" style={{ marginTop: 4 }}>
              {findings.length} finding{findings.length === 1 ? '' : 's'} so far
            </div>
          )}
        </div>
      </div>
    );
  if (cr.status === 'failed')
    return (
      <div className="warn-banner danger">
        <Ico svg={I.warn} />
        <span>{cr.error}</span>
        <button className="btn sm" style={{ marginLeft: 'auto' }} disabled={!!busy} onClick={run}>
          Try again
        </button>
      </div>
    );
  const openOnes = findings.filter((f) => f.status === 'open');
  const serious = openOnes.filter((f) => ['critical', 'major'].includes(f.severity));
  return (
    <>
      <div className="cj-toolbar">
        {SEVS.map((s) => {
          const n = findings.filter((f) => f.severity === s).length;
          return n ? (
            <span key={s} className="cr-count">
              <SevChip s={s} />
              {n}
            </span>
          ) : null;
        })}
        {!findings.length && (
          <span className="cj-verdict v-ok">
            <Ico svg={I.check} />
            No findings
          </span>
        )}
        <span className="spacer" />
        {review && serious.length > 0 && job.status === 'review' && (
          <button
            className="btn sm ai"
            disabled={!!busy}
            onClick={() => {
              follow(fixText(serious));
              mutate(() =>
                serious.forEach((f) => {
                  f.status = 'agent';
                }),
              );
            }}
          >
            <Ico svg={I.sparkle} />
            Fix {serious.length} critical & major
          </button>
        )}
        {review && serious.length > 0 && (
          <button
            className="btn sm"
            onClick={() => {
              const made = serious
                .map((f) => fileBug(t, review, f, { quiet: true }))
                .filter(Boolean);
              toast(
                `Created ${made.length} bug${made.length === 1 ? '' : 's'}: ${made.map((b: Any) => b.key).join(', ')}`,
              );
            }}
          >
            <Ico svg={I.flag} />
            File {serious.length} as bugs
          </button>
        )}
        <button
          className="btn sm subtle"
          disabled={!!busy || job.status !== 'review'}
          onClick={run}
          title="Review the current changes again"
        >
          <Ico svg={I.refresh} />
          Review again
        </button>
      </div>
      {cr.warning && (
        <div className="warn-banner" style={{ marginBottom: 10 }}>
          <Ico svg={I.warn} />
          <span>{cr.warning}</span>
        </div>
      )}
      <FindingsList
        t={t}
        review={review}
        findings={findings}
        onFix={job.status === 'review' ? (list) => follow(fixText(list)) : null}
        busy={!!busy}
      />
    </>
  );
}

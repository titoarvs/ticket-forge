'use client';
import { useState, useEffect } from 'react';
import { type Any, api, P, ago, copyText } from '../core';
import { I, Ico, Avatar, TypeIcon } from '../ui';
import { openDrawer } from '../actions';
import { DiffReview } from '../DiffReview';
import { VERDICT_CLS } from './ReviewModal';

// ---------------------------------------------------------------- the page
export const ACTIVE = ['Open', 'Draft'];
export const STALE_MS = 10 * 60 * 1000;
const when = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString([], {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';
/** What needs attention on a request (from GitHub / GitLab and the AI review). */
export function flagsOf(r: Any) {
  const active = ACTIVE.includes(r.status);
  const failing = active && r.checks?.state === 'failing';
  const changes =
    active && (r.review?.state === 'changes' || r.aiReview?.verdict === 'Changes requested');
  const conflicts = active && r.conflicts === true;
  const approved = r.review?.state === 'approved' || r.aiReview?.verdict === 'Approve';
  const unreviewed =
    active &&
    !r.aiReview &&
    (!r.review || r.review.state === 'none' || r.review.state === 'pending');
  const ready =
    r.status === 'Open' &&
    approved &&
    !changes &&
    !conflicts &&
    r.checks?.state !== 'failing' &&
    r.checks?.state !== 'pending';
  return { failing, changes, conflicts, unreviewed, ready };
}
export const FOCUS: [string, string, string][] = [
  ['failing', 'Checks failing', 't-fail'],
  ['changes', 'Changes requested', 't-blocked'],
  ['conflicts', 'Conflicts', 't-fail'],
  ['unreviewed', 'Not reviewed', ''],
  ['ready', 'Ready to merge', 't-pass'],
];
export const SORTS: [string, string][] = [
  ['updated', 'Recently updated'],
  ['oldest', 'Oldest open first'],
  ['size', 'Largest change'],
  ['issue', 'Issue key'],
];
/** When the request last changed on its host (never when TicketForge last read it). */
export const time = (r: Any) =>
  String(r.updatedAt || r.mergedAt || r.closedAt || r.createdAt || '');
export function ChecksChip({ c }: { c: Any }) {
  if (!c || c.state === 'none') return null;
  const [cls, icon, label] =
    c.state === 'failing'
      ? ['t-fail', I.close, `${c.failed} failing`]
      : c.state === 'pending'
        ? ['t-blocked', I.clock, `${c.pending} running`]
        : ['t-pass', I.check, 'Checks pass'];
  return (
    <span
      className={`pr-chip ${cls}`}
      title={`${c.passed} passed · ${c.failed} failed · ${c.pending} running (${c.total} checks)`}
    >
      <Ico svg={icon} />
      {label}
    </span>
  );
}
export function ReviewChip({ r }: { r: Any }) {
  const v = r.review;
  if (!v || v.state === 'none') return null;
  if (v.state === 'changes')
    return (
      <span className="pr-chip t-fail" title={`${v.changes} requested changes`}>
        Changes requested
      </span>
    );
  if (v.state === 'approved')
    return (
      <span className="pr-chip t-pass" title={`${v.approved} approved`}>
        <Ico svg={I.check} />
        Approved{v.approved > 1 ? ` ×${v.approved}` : ''}
      </span>
    );
  return (
    <span className="pr-chip" title={`Waiting for ${(r.reviewers || []).join(', ')}`}>
      Review requested
    </span>
  );
}
export function SizeChip({ s }: { s: Any }) {
  if (!s || (s.additions == null && s.files == null)) return null;
  const a = s.additions || 0,
    d = s.deletions || 0,
    total = a + d;
  const blocks = 5,
    green = total ? Math.round((a / total) * blocks) : 0;
  return (
    <span
      className="pr-size"
      title={`${a} added · ${d} removed${s.files != null ? ` · ${s.files} files` : ''}${s.commits != null ? ` · ${s.commits} commits` : ''}`}
    >
      {s.additions != null && (
        <>
          <b className="add">+{a}</b>
          <b className="del">−{d}</b>
        </>
      )}
      {s.additions != null && (
        <span className="pr-size-bar" aria-hidden>
          {Array.from({ length: blocks }, (_, i) => (
            <i key={i} className={i < green ? 'add' : 'del'} />
          ))}
        </span>
      )}
      {s.files != null && (
        <span className="muted">
          {s.files} file{s.files === 1 ? '' : 's'}
        </span>
      )}
    </span>
  );
}
export const StatusIcon = ({ r }: { r: Any }) => (
  <span className={`pr-ico s-${String(r.status).toLowerCase()}`} title={r.status}>
    <Ico svg={r.status === 'Merged' ? I.check : r.status === 'Declined' ? I.close : I.pr} />
  </span>
);
/**
 * The AI code job behind a request (when it came from Write code with AI), as a side-by-side diff.
 * Everyone who sees the page sees it.
 */
function PrCodeChanges({ t, r }: { t: Any; r: Any }) {
  const [job, setJob] = useState<Any>(null);
  useEffect(() => {
    let live = true;
    const same = (x: Any) =>
      (x.pr?.url && x.pr.url === r.url) ||
      (x.pr?.number && x.pr.number === r.number && x.repo === r.repo) ||
      (x.branch && x.branch === r.branch);
    api(`/api/projects/${encodeURIComponent(P().id)}/code?ticketId=${encodeURIComponent(t.id)}`)
      .then((d: Any) => {
        if (live)
          setJob([d.jobs?.frontend, d.jobs?.backend, d.job].filter(Boolean).find(same) || null);
      })
      .catch(() => {
        if (live) setJob(null);
      });
    return () => {
      live = false;
    };
  }, [t.id, r.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!job || !job.files?.length) return null;
  return (
    <section className="pr-d-code">
      <h4>
        Code changes{' '}
        <span className="muted small">written by {job.agentName || 'an AI agent'}</span>
      </h4>
      <DiffReview job={job} />
    </section>
  );
}
/** The expanded part of a row: description, checks, reviews, AI review and timeline. */
export function PrDetails({ t, r }: { t: Any; r: Any }) {
  const [more, setMore] = useState(false);
  const checks = [...(r.checks?.items || [])].sort(
    (a: Any, b: Any) =>
      ['failed', 'pending', 'passed'].indexOf(a.state) -
      ['failed', 'pending', 'passed'].indexOf(b.state),
  );
  const body = String(r.body || '');
  return (
    <div className="pr-details" onClick={(e) => e.stopPropagation()}>
      <section className="pr-d-main">
        <h4>Description</h4>
        {body ? (
          <>
            <div className={`pr-desc ${body.length > 400 && !more ? 'clamped' : ''}`}>{body}</div>
            {body.length > 400 && (
              <button className="link-btn small" onClick={() => setMore(!more)}>
                {more ? 'Show less' : 'Show more'}
              </button>
            )}
          </>
        ) : (
          <p className="muted small">
            {r.fetched === false
              ? 'Not read from the host yet: refresh to load it.'
              : 'No description.'}
          </p>
        )}
        {r.labels?.length > 0 && (
          <div className="pr-labels">
            {r.labels.map((l: string) => (
              <span key={l} className="label-chip">
                {l}
              </span>
            ))}
          </div>
        )}
        {checks.length > 0 && (
          <>
            <h4>
              Checks{' '}
              <span className="muted small">
                {r.checks.passed} passed · {r.checks.failed} failed · {r.checks.pending} running
              </span>
            </h4>
            <ul className="pr-checks">
              {checks.slice(0, 12).map((c: Any, i: number) => (
                <li key={i} className={`c-${c.state}`}>
                  <Ico
                    svg={c.state === 'passed' ? I.check : c.state === 'failed' ? I.close : I.clock}
                  />
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noopener noreferrer">
                      {c.name}
                    </a>
                  ) : (
                    <span>{c.name}</span>
                  )}
                </li>
              ))}
            </ul>
            {checks.length > 12 && (
              <p className="muted small">
                and {checks.length - 12} more on {r.provider}.
              </p>
            )}
          </>
        )}
      </section>
      <aside className="pr-d-side">
        <h4>Reviews</h4>
        {r.review?.users?.length ? (
          <ul className="pr-reviewers">
            {r.review.users.map((u: Any) => (
              <li key={u.login}>
                <Avatar name={u.login} size={20} />
                {u.login}
                <span
                  className={`loz ${u.state === 'approved' ? 't-pass' : u.state === 'changes' ? 't-fail' : ''}`}
                >
                  {u.state === 'approved'
                    ? 'Approved'
                    : u.state === 'changes'
                      ? 'Changes'
                      : 'Dismissed'}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {(r.reviewers || []).length > 0 && (
          <p className="muted small">Waiting for {r.reviewers.join(', ')}</p>
        )}
        {!r.review?.users?.length && !(r.reviewers || []).length && (
          <p className="muted small">No reviews yet.</p>
        )}
        {r.aiReview && (
          <div className="pr-ai">
            <span className={`loz ${VERDICT_CLS[r.aiReview.verdict] || ''}`}>
              AI: {r.aiReview.verdict}
            </span>
            <span className="muted small">
              {r.aiReview.agent} · {ago(r.aiReview.at)}
              {r.aiReview.posted ? ' · posted on the request' : ''}
            </span>
          </div>
        )}
        <h4>Branch</h4>
        {r.branch ? (
          <p className="pr-branch">
            <code>{r.branch}</code> → <code>{r.base || '…'}</code>
            <button
              className="icon-btn"
              title="Copy branch name"
              aria-label="Copy branch name"
              onClick={() => copyText(r.branch)}
            >
              <Ico svg={I.copy} />
            </button>
          </p>
        ) : (
          <p className="muted small">Unknown</p>
        )}
        {r.conflicts === true && (
          <p className="warn-text small">
            <Ico svg={I.warn} /> Has merge conflicts with {r.base || 'the base branch'}.
          </p>
        )}
        <h4>Timeline</h4>
        <ul className="pr-timeline small">
          {r.createdAt && (
            <li>
              Opened {when(r.createdAt)}
              {r.author ? ` by ${r.author}` : ''}
            </li>
          )}
          {r.updatedAt && <li>Updated {ago(r.updatedAt)}</li>}
          {r.mergedAt && <li>Merged {when(r.mergedAt)}</li>}
          {!r.mergedAt && r.closedAt && <li>Closed {when(r.closedAt)}</li>}
          {r.checkedAt && <li className="muted">Checked {ago(r.checkedAt)}</li>}
        </ul>
        <button type="button" className="pr-issue small" onClick={() => openDrawer('issue', t.id)}>
          <TypeIcon type={t.type} />
          <span className="key">{t.key}</span>
          <span className="pr-issue-t">{t.title}</span>
        </button>
      </aside>
      <PrCodeChanges t={t} r={r} />
    </div>
  );
}

'use client';
import { useState, useEffect } from 'react';
import {
  type Any,
  ticket,
  api,
  P,
  mutate,
  logEvent,
  toast,
  ago,
  openModal,
  closeModal,
  aiBody,
} from '../core';
import { Ico, I, Modal, Spinner } from '../ui';
import { Markdown } from '../GuideCard';
import { openDrawer } from '../actions';
import {
  SevChip,
  where,
  FINDING_STATUS,
  setStatus,
  fileBug,
  SEVS,
  fixText,
} from './CodeRabbitPanel';

/**
 * Findings as expandable cards: comment, fix instructions, and Fix with agent / File as bug /
 * Dismiss.
 */
export function FindingsList({
  t,
  review,
  findings,
  onFix,
  busy = false,
}: {
  t: Any;
  review: Any;
  findings: Any[];
  onFix: ((list: Any[]) => void) | null;
  busy?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!findings.length) return null;
  return (
    <div className="cr-list">
      {findings.map((f) => (
        <div key={f.id} className={`cr-item s-${f.status}`}>
          <button
            className="cr-head"
            onClick={() => setOpen(open === f.id ? null : f.id)}
            aria-expanded={open === f.id}
          >
            <SevChip s={f.severity} />
            <span className="cr-title">{f.title}</span>
            <code className="cr-where">{where(f)}</code>
            {f.status !== 'open' ? (
              <span className="cr-st">
                {f.status === 'bug' ? f.bugKey : FINDING_STATUS[f.status]}
              </span>
            ) : f.outdated ? (
              <span className="cr-st">Outdated</span>
            ) : (
              <span />
            )}
            <Ico svg={I.chevron} className={open === f.id ? '' : 'closed'} />
          </button>
          {open === f.id && (
            <div className="cr-body">
              {f.category && (
                <div className="muted small" style={{ marginBottom: 4 }}>
                  {f.category}
                </div>
              )}
              {f.comment && (
                <div className="code-md small">
                  <Markdown text={f.comment} />
                </div>
              )}
              {f.fix && (
                <details>
                  <summary className="small">Fix instructions for an agent</summary>
                  <pre className="cr-fix">{f.fix}</pre>
                </details>
              )}
              {review && (
                <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {onFix && ['open', 'resolved'].includes(f.status) && (
                    <button
                      className="btn sm ai"
                      disabled={busy}
                      onClick={() => {
                        onFix([f]);
                        setStatus(f, 'agent');
                      }}
                    >
                      <Ico svg={I.sparkle} />
                      Fix with agent
                    </button>
                  )}
                  {f.status !== 'bug' ? (
                    <button className="btn sm" onClick={() => fileBug(t, review, f)}>
                      <Ico svg={I.flag} />
                      File as bug
                    </button>
                  ) : (
                    <button
                      className="btn sm subtle"
                      onClick={() => f.bugId && ticket(f.bugId) && openDrawer('issue', f.bugId)}
                    >
                      Open {f.bugKey}
                    </button>
                  )}
                  {f.url && (
                    <a
                      className="btn sm subtle"
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Ico svg={I.external} />
                      Comment
                    </a>
                  )}
                  {f.status === 'open' ? (
                    <button className="btn sm subtle" onClick={() => setStatus(f, 'dismissed')}>
                      Dismiss
                    </button>
                  ) : (
                    f.status !== 'bug' && (
                      <button className="btn sm subtle" onClick={() => setStatus(f, 'open')}>
                        Reopen
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
// ---------------------------------------------------------------- CodeRabbit on linked pull
// requests
const prRefOf = (r: Any) => `${r.provider === 'GitLab' ? '!' : '#'}${r.number}`;
export const prReview = (t: Any, r: Any) =>
  (t.codeReviews || []).find((x: Any) => x.origin === 'pr' && x.prId === r.id);
/**
 * Reads CodeRabbit's comments on a linked pull/merge request and merges them into the issue
 * (statuses are kept).
 */
export async function importPrFindings(t: Any, r: Any, { quiet = false } = {}) {
  const res = await api(`/api/projects/${P().id}/coderabbit`, {
    method: 'POST',
    body: { ticketId: t.id, prId: r.id },
  });
  let added = 0;
  mutate(() => {
    let rv = prReview(t, r);
    if (!rv) {
      rv = {
        id: `pr-${r.id}`,
        source: 'CodeRabbit',
        origin: 'pr',
        prId: r.id,
        prUrl: r.url,
        prRef: `${r.repo} ${prRefOf(r)}`,
        branch: r.branch || '',
        side: '',
        findings: [],
      };
      (t.codeReviews ??= []).push(rv);
    }
    rv.at = res.readAt;
    for (const f of res.findings) {
      const old = rv.findings.find((x: Any) => x.id === f.id);
      if (old) {
        Object.assign(old, {
          ...f,
          status: old.status === 'open' && f.resolved ? 'resolved' : old.status,
          bugKey: old.bugKey,
          bugId: old.bugId,
        });
      } else {
        rv.findings.push({ ...f, status: f.resolved ? 'resolved' : 'open' });
        added++;
      }
    }
    rv.findings.sort((a: Any, b: Any) => SEVS.indexOf(a.severity) - SEVS.indexOf(b.severity));
    if (added)
      logEvent(
        t,
        `imported ${added} CodeRabbit finding${added === 1 ? '' : 's'} from ${rv.prRef}`,
        'Development',
      );
  });
  if (!quiet)
    toast(
      res.findings.length
        ? `${res.findings.length} CodeRabbit finding${res.findings.length === 1 ? '' : 's'} on ${prRefOf(r)} (${added} new)`
        : `CodeRabbit hasn’t left review comments on ${prRefOf(r)}.`,
    );
  return prReview(t, r);
}
/** Open counts by severity for a saved PR review, as small chips. */
export function PrFindingChips({ t, r }: { t: Any; r: Any }) {
  const rv = prReview(t, r);
  if (!rv) return null;
  const open = rv.findings.filter((f: Any) => f.status === 'open');
  return (
    <button
      className="cr-chips"
      onClick={() => openPrFindings(t, r)}
      title={`CodeRabbit on ${rv.prRef}: read ${ago(rv.at)}`}
    >
      🐇{' '}
      {open.length ? (
        SEVS.map((s) => {
          const n = open.filter((f: Any) => f.severity === s).length;
          return n ? (
            <span key={s} className={`sev-dot sev-${s}`}>
              {n} {s}
            </span>
          ) : null;
        })
      ) : (
        <span className="muted">no open findings</span>
      )}
    </button>
  );
}
function PrFindingsModal({
  t,
  r,
  fix,
}: {
  t: Any;
  r: Any;
  fix: ((t: Any, r: Any, text: string) => Promise<void>) | null;
}) {
  const [busy, setBusy] = useState(true);
  const [, setTick] = useState(0);
  const load = async () => {
    setBusy(true);
    try {
      await importPrFindings(t, r, { quiet: true });
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
      setTick((x) => x + 1);
    }
  };
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rv = prReview(t, r);
  const findings = rv?.findings || [];
  const open = findings.filter((f: Any) => f.status === 'open' && !f.outdated);
  const serious = open.filter((f: Any) => ['critical', 'major'].includes(f.severity));
  const sendFix = fix
    ? async (list: Any[]) => {
        await fix(t, r, fixText(list));
      }
    : null;
  return (
    <Modal title={`CodeRabbit · ${prRefOf(r)}`} wide actions={[{ label: 'Close' }]}>
      <p className="muted small" style={{ marginTop: 0 }}>
        <b>{r.title}</b> · {r.repo}
        {rv?.at ? ` · read ${ago(rv.at)}` : ''}. CodeRabbit’s review comments on the{' '}
        {r.provider === 'GitLab' ? 'merge request' : 'pull request'}; resolved threads are marked,
        outdated ones flagged.
      </p>
      <div className="cj-toolbar">
        {busy ? (
          <span className="muted small">
            <Spinner /> Reading the comments…
          </span>
        ) : (
          SEVS.map((s) => {
            const n = findings.filter((f: Any) => f.severity === s).length;
            return n ? (
              <span key={s} className="cr-count">
                <SevChip s={s} />
                {n}
              </span>
            ) : null;
          })
        )}
        <span className="spacer" />
        {rv && serious.length > 0 && sendFix && (
          <button
            className="btn sm ai"
            onClick={() => {
              sendFix(serious);
              mutate(() =>
                serious.forEach((f: Any) => {
                  f.status = 'agent';
                }),
              );
            }}
          >
            <Ico svg={I.sparkle} />
            Fix {serious.length} critical & major
          </button>
        )}
        {rv && serious.length > 0 && (
          <button
            className="btn sm"
            onClick={() => {
              const made = serious
                .map((f: Any) => fileBug(t, rv, f, { quiet: true }))
                .filter(Boolean);
              toast(
                `Created ${made.length} bug${made.length === 1 ? '' : 's'}: ${made.map((b: Any) => b.key).join(', ')}`,
              );
              setTick((x) => x + 1);
            }}
          >
            <Ico svg={I.flag} />
            File {serious.length} as bugs
          </button>
        )}
        <button className="btn sm subtle" disabled={busy} onClick={load}>
          <Ico svg={I.refresh} />
          Read again
        </button>
      </div>
      {!busy && !findings.length && (
        <p className="muted">
          CodeRabbit hasn’t left review comments on this{' '}
          {r.provider === 'GitLab' ? 'merge request' : 'pull request'} (or its app isn’t installed
          on the repository).
        </p>
      )}
      <FindingsList t={t} review={rv} findings={findings} onFix={sendFix} />
    </Modal>
  );
}
let fixPr: ((t: Any, r: Any, text: string) => Promise<void>) | null = null;
/**
 * DevCode registers how to start an agent on a pull request's branch (it owns the code job window).
 */
export const setPrFixer = (fn: typeof fixPr) => {
  fixPr = fn;
};
export const openPrFindings = (t: Any, r: Any) =>
  openModal(
    <PrFindingsModal t={t} r={r} fix={['Open', 'Draft'].includes(r.status) ? fixPr : null} />,
  );
void closeModal;
void aiBody;

'use client';
// CodeRabbit findings: shown in the code job window, saved on the issue (t.codeReviews), turned into Bug issues or
// sent to the Build agent, and summarised in Reports → Code review findings.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { P, api, aiBody, mutate, newTicket, addLink, logEvent, toast, ago, ticket, openModal, closeModal, type Any } from './core';
import { Ico, I, Spinner, Modal } from './ui';
import { Markdown } from './GuideCard';
import { openDrawer } from './actions';

const SEVS = ['critical', 'major', 'minor', 'trivial', 'info'];
const SEV_LABEL: Record<string, string> = { critical: 'Critical', major: 'Major', minor: 'Minor', trivial: 'Trivial', info: 'Info' };
const SEV_PRIORITY: Record<string, string> = { critical: 'Highest', major: 'High', minor: 'Medium', trivial: 'Low', info: 'Low' };
const FINDING_STATUS: Record<string, string> = {
  open: 'Open',
  bug: 'Filed as bug',
  agent: 'Sent to agent',
  resolved: 'Resolved on PR',
  dismissed: 'Dismissed',
};
export const SevChip = ({ s }: { s: string }) => <span className={`sev-chip sev-${s}`}>{SEV_LABEL[s] || s}</span>;
const where = (f: Any) =>
  `${f.file}${f.startLine ? `:${f.startLine}${f.endLine && f.endLine !== f.startLine ? `-${f.endLine}` : ''}` : ''}`;

/** The saved review for this job round on the issue, or null. */
const savedReview = (t: Any, job: Any) => (t.codeReviews || []).find((r: Any) => r.jobId === job.id && r.round === job.coderabbit?.round);

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

/** Files a finding as a Bug issue linked to the issue it came from. Call inside nothing: it mutates itself. */
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
      acceptanceCriteria: [`The problem at ${where(f)} is fixed`, 'A test covers the case that failed'],
    });
    p.tickets.push(bug);
    addLink(bug, 'relates to', t);
    f.status = 'bug';
    f.bugKey = bug.key;
    f.bugId = bug.id;
    logEvent(t, `filed ${bug.key} from a CodeRabbit finding (${f.severity})`, 'Development');
  });
  if (!quiet && bug) toast(`Created ${bug.key}`, 'ok', { action: { label: 'Open', onClick: () => openDrawer('issue', bug.id) } });
  return bug;
}
export const setStatus = (f: Any, status: string) =>
  mutate(() => {
    f.status = status;
  });

/** The text the Build agent gets for findings. */
const fixText = (list: Any[]) =>
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
            Started {ago(cr.startedAt)} · reviews usually take several minutes; you can close this window.
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
              const made = serious.map((f) => fileBug(t, review, f, { quiet: true })).filter(Boolean);
              toast(`Created ${made.length} bug${made.length === 1 ? '' : 's'}: ${made.map((b: Any) => b.key).join(', ')}`);
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

/** Findings as expandable cards: comment, fix instructions, and Fix with agent / File as bug / Dismiss. */
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
          <button className="cr-head" onClick={() => setOpen(open === f.id ? null : f.id)} aria-expanded={open === f.id}>
            <SevChip s={f.severity} />
            <span className="cr-title">{f.title}</span>
            <code className="cr-where">{where(f)}</code>
            {f.status !== 'open' ? (
              <span className="cr-st">{f.status === 'bug' ? f.bugKey : FINDING_STATUS[f.status]}</span>
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
                    <button className="btn sm subtle" onClick={() => f.bugId && ticket(f.bugId) && openDrawer('issue', f.bugId)}>
                      Open {f.bugKey}
                    </button>
                  )}
                  {f.url && (
                    <a className="btn sm subtle" href={f.url} target="_blank" rel="noopener noreferrer">
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

// ---------------------------------------------------------------- CodeRabbit on linked pull requests
const prRefOf = (r: Any) => `${r.provider === 'GitLab' ? '!' : '#'}${r.number}`;
export const prReview = (t: Any, r: Any) => (t.codeReviews || []).find((x: Any) => x.origin === 'pr' && x.prId === r.id);

/** Reads CodeRabbit's comments on a linked pull/merge request and merges them into the issue (statuses are kept). */
export async function importPrFindings(t: Any, r: Any, { quiet = false } = {}) {
  const res = await api(`/api/projects/${P().id}/coderabbit`, { method: 'POST', body: { ticketId: t.id, prId: r.id } });
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
    if (added) logEvent(t, `imported ${added} CodeRabbit finding${added === 1 ? '' : 's'} from ${rv.prRef}`, 'Development');
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
    <button className="cr-chips" onClick={() => openPrFindings(t, r)} title={`CodeRabbit on ${rv.prRef}: read ${ago(rv.at)}`}>
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

function PrFindingsModal({ t, r, fix }: { t: Any; r: Any; fix: ((t: Any, r: Any, text: string) => Promise<void>) | null }) {
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
        {r.provider === 'GitLab' ? 'merge request' : 'pull request'}; resolved threads are marked, outdated ones flagged.
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
              const made = serious.map((f: Any) => fileBug(t, rv, f, { quiet: true })).filter(Boolean);
              toast(`Created ${made.length} bug${made.length === 1 ? '' : 's'}: ${made.map((b: Any) => b.key).join(', ')}`);
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
          CodeRabbit hasn’t left review comments on this {r.provider === 'GitLab' ? 'merge request' : 'pull request'} (or its app isn’t
          installed on the repository).
        </p>
      )}
      <FindingsList t={t} review={rv} findings={findings} onFix={sendFix} />
    </Modal>
  );
}
let fixPr: ((t: Any, r: Any, text: string) => Promise<void>) | null = null;
/** DevCode registers how to start an agent on a pull request's branch (it owns the code job window). */
export const setPrFixer = (fn: typeof fixPr) => {
  fixPr = fn;
};
export const openPrFindings = (t: Any, r: Any) =>
  openModal(<PrFindingsModal t={t} r={r} fix={['Open', 'Draft'].includes(r.status) ? fixPr : null} />);
void closeModal;
void aiBody;

/** Reports → Code review findings: every saved CodeRabbit review in the project. */
export function CodeReviewReport() {
  const p = P();
  const rows: { t: Any; r: Any; f: Any }[] = p.tickets.flatMap((t: Any) =>
    (t.codeReviews || []).flatMap((r: Any) => r.findings.map((f: Any) => ({ t, r, f }))),
  );
  const [sev, setSev] = useState('');
  if (!rows.length)
    return (
      <div className="card wide">
        <h3>Code review findings</h3>
        <p className="sub">CodeRabbit findings on the code the agents write.</p>
        <p className="muted small">
          No CodeRabbit reviews yet. Open an issue’s <b>Write code with AI</b> job and choose <b>CodeRabbit review</b> once the agent
          finishes.
        </p>
      </div>
    );
  const reviews = p.tickets.reduce((n: number, t: Any) => n + (t.codeReviews || []).length, 0);
  const count = (fn: (x: { f: Any }) => boolean) => rows.filter(fn).length;
  const files = Object.entries(
    rows.reduce((m: Record<string, number>, x) => {
      m[x.f.file] = (m[x.f.file] || 0) + 1;
      return m;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const openSerious = rows
    .filter((x) => x.f.status === 'open' && (!sev || x.f.severity === sev))
    .sort((a, b) => SEVS.indexOf(a.f.severity) - SEVS.indexOf(b.f.severity));
  const max = Math.max(1, ...SEVS.map((s) => count((x) => x.f.severity === s)));
  return (
    <div className="card wide cr-report">
      <h3>Code review findings</h3>
      <p className="sub">
        {rows.length} CodeRabbit findings from {reviews} review{reviews === 1 ? '' : 's'} on {new Set(rows.map((x) => x.t.id)).size} issues.
      </p>
      <div className="cr-kpis">
        {Object.entries(FINDING_STATUS).map(([k, label]) => (
          <div key={k} className="cr-kpi">
            <b>{count((x) => x.f.status === k)}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="cr-grid">
        <div>
          <h4>By severity</h4>
          {SEVS.map((s) => {
            const n = count((x) => x.f.severity === s);
            return (
              <button
                key={s}
                className={`cr-bar ${sev === s ? 'on' : ''}`}
                onClick={() => setSev(sev === s ? '' : s)}
                title="Filter the open findings below"
              >
                <SevChip s={s} />
                <span className="cr-track">
                  <i className={`sev-${s}`} style={{ width: `${(n / max) * 100}%` }} />
                </span>
                <b>{n}</b>
              </button>
            );
          })}
        </div>
        <div>
          <h4>Files with the most findings</h4>
          <table className="tbl">
            <tbody>
              {files.map(([f, n]) => (
                <tr key={f}>
                  <td>
                    <code className="small">{f}</code>
                  </td>
                  <td className="num">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <h4>
        Open findings{sev ? ` · ${SEV_LABEL[sev]}` : ''} <span className="muted small">({openSerious.length})</span>
      </h4>
      {openSerious.length ? (
        <table className="tbl">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Finding</th>
              <th>Issue</th>
              <th>Found</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {openSerious.slice(0, 50).map(({ t, r, f }) => (
              <tr key={`${r.id}-${f.id}`}>
                <td>
                  <SevChip s={f.severity} />
                </td>
                <td>
                  <div>{f.title}</div>
                  <code className="muted small">{where(f)}</code>
                </td>
                <td>
                  <Link
                    href={`/p/${p.id}/backlog`}
                    onClick={(e) => {
                      e.preventDefault();
                      openDrawer('issue', t.id);
                    }}
                  >
                    {t.key}
                  </Link>{' '}
                  <span className="muted small">{r.origin === 'pr' ? r.prRef : r.side}</span>
                </td>
                <td className="muted small">{ago(r.at)}</td>
                <td>
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button className="btn sm" onClick={() => fileBug(t, r, f)}>
                      File as bug
                    </button>
                    <button className="btn sm subtle" onClick={() => setStatus(f, 'dismissed')}>
                      Dismiss
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">Nothing open{sev ? ' at this severity' : ''}. </p>
      )}
    </div>
  );
}

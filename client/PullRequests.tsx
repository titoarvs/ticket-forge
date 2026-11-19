'use client';
// Pull requests: every pull / merge request linked to the project's issues in one place. Each shows
// what GitHub / GitLab says (checks, reviews, conflicts, size, comments, description) and the AI
// review; "Needs attention" filters pick out failing checks, requested changes, conflicts,
// unreviewed and ready-to-merge requests. Rows expand into details. AI actions: Review with AI
// (read-only) and Update with AI. Open requests refresh by themselves when stale.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  S,
  P,
  useStore,
  api,
  aiBody,
  can,
  toast,
  openModal,
  closeModal,
  ago,
  emit,
  epic,
  mutate,
  logEvent,
  copyText,
  setMenu,
  store,
  type Any,
} from './core';
import {
  Ico,
  I,
  Modal,
  Spinner,
  EmptyState,
  TypeIcon,
  LayerChip,
  Avatar,
  Swatch,
  Confirm,
  Menu,
} from './ui';
import { TF, TA, SF, MenuItem } from './fields';
import { openDrawer, linkPr, refreshPr } from './actions';
import { openCode, openUpdatePr, codeReady } from './DevCode';
import Link from 'next/link';
import { useAgents } from './Agents';
import { PrFindingChips, openPrFindings } from './CodeRabbit';
import { DiffReview } from './DiffReview';

const prCls = (s: string) =>
  (({ Open: 'pr-open', Merged: 'pr-merged', Declined: 'pr-declined', Draft: 'pr-draft' }) as Any)[
    s
  ] || 'pr-open';
const ref = (r: Any) => (r.number ? `${r.provider === 'GitLab' ? '!' : '#'}${r.number}` : '');
const VERDICT_CLS: Record<string, string> = {
  Approve: 't-pass',
  'Approve with comments': 't-blocked',
  'Changes requested': 't-fail',
  Reviewed: '',
};

/**
 * Review an open request with a read-only review agent. The findings open in the code dialog, ready
 * to post.
 */
function ReviewModal({ t, pr }: { t: Any; pr: Any }) {
  const [agent, setAgent] = useState('review');
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const noun = pr.provider === 'GitLab' ? 'merge request' : 'pull request';
  const agents = useAgents();
  const custom = (agents?.agents || []).filter(
    (a: Any) => a.custom && a.runner === 'code' && !a.writes && a.enabled,
  );
  // Built-in reviewers that were removed (Administration → Agents) give way to the custom ones.
  useEffect(() => {
    if (
      agents &&
      agent === 'review' &&
      !(agents.agents || []).some((a: Any) => a.id === 'review' && a.enabled) &&
      custom[0]
    )
      setAgent(custom[0].id);
  }, [agents]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    setBusy(true);
    try {
      const job = await api(`/api/projects/${P().id}/code`, {
        method: 'POST',
        body: aiBody({ action: 'prReview', ticketId: t.id, prId: pr.id, agent, focus }),
      });
      closeModal();
      openCode(t, job.side);
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Review ${ref(pr)} with AI`}
      wide
      actions={[
        { label: 'Cancel' },
        { label: busy ? 'Starting…' : 'Start review', kind: 'ai', disabled: busy, onClick: go },
      ]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        <b>{pr.title}</b> · {pr.repo} · <code>{pr.branch}</code> → <code>{pr.base}</code>. The
        reviewer reads the {noun}’s diff and code on its own branch, checks it against {t.key}’s
        acceptance criteria and writes findings (blocking, should fix, nits). It never changes code.
        You can post the review on the {noun} afterwards.
      </p>
      <div className="upd-modes" role="radiogroup" aria-label="Reviewer">
        {(
          [
            [
              'review',
              '🔍 Code review',
              'Correctness, security, tests and the acceptance criteria.',
            ],
            [
              'ui-review',
              '🧐 UI/UX review',
              'Usability, accessibility, states, copy and responsive layout.',
            ],
          ] as [string, string, string][]
        )
          .filter(
            ([k]) =>
              !agents ||
              (agents.agents || []).some((a: Any) => a.id === k && a.enabled) ||
              (k === 'review' && !custom.length),
          )
          .map(([k, l, d]) => (
            <button
              key={k}
              role="radio"
              aria-checked={agent === k}
              className={agent === k ? 'on' : ''}
              onClick={() => setAgent(k)}
            >
              <b>{l}</b>
              <span className="muted small">{d}</span>
            </button>
          ))}
        {custom.map((a: Any) => (
          <button
            key={a.id}
            role="radio"
            aria-checked={agent === a.id}
            className={agent === a.id ? 'on' : ''}
            onClick={() => setAgent(a.id)}
          >
            <b>
              {a.icon} {a.name}
            </b>
            <span className="muted small">{a.summary} · custom</span>
          </button>
        ))}
      </div>
      <label className="field" style={{ marginTop: 10 }}>
        <span>Focus on (optional)</span>
        <TA
          rows={2}
          value={focus}
          placeholder="e.g. the payroll rounding rules and the permission checks on the new endpoint"
          onChange={(e) => setFocus(e.target.value)}
        />
      </label>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Runs in Claude Code with the model set for <b>Code review</b> in Administration → AI → Model
        routing.
      </p>
    </Modal>
  );
}

/** Link a pull request to an issue from this page. */
function LinkModal() {
  const p = P();
  const [issue, setIssue] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const t = p.tickets.find((x: Any) => x.id === issue);
  const go = async () => {
    if (!t) return;
    setBusy(true);
    if (await linkPr(t, url)) closeModal();
    setBusy(false);
  };
  return (
    <Modal
      title="Link a pull request"
      actions={[
        { label: 'Cancel' },
        {
          label: busy ? 'Looking up…' : 'Link',
          kind: 'primary',
          disabled: busy || !t || !url.trim(),
          onClick: go,
        },
      ]}
    >
      <label className="field">
        <span>Issue</span>
        <SF value={issue} onChange={(e) => setIssue(e.target.value)}>
          {p.tickets.map((x: Any) => (
            <MenuItem key={x.id} value={x.id}>
              {x.key} {x.title}
            </MenuItem>
          ))}
        </SF>
      </label>
      <label className="field">
        <span>Pull or merge request URL</span>
        <TF
          value={url}
          autoFocus
          placeholder="https://github.com/org/repo/pull/12"
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
    </Modal>
  );
}

// ---------------------------------------------------------------- the page
const ACTIVE = ['Open', 'Draft'];
const STALE_MS = 10 * 60 * 1000;
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
function flagsOf(r: Any) {
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
const FOCUS: [string, string, string][] = [
  ['failing', 'Checks failing', 't-fail'],
  ['changes', 'Changes requested', 't-blocked'],
  ['conflicts', 'Conflicts', 't-fail'],
  ['unreviewed', 'Not reviewed', ''],
  ['ready', 'Ready to merge', 't-pass'],
];
const SORTS: [string, string][] = [
  ['updated', 'Recently updated'],
  ['oldest', 'Oldest open first'],
  ['size', 'Largest change'],
  ['issue', 'Issue key'],
];
/** When the request last changed on its host (never when TicketForge last read it). */
const time = (r: Any) => String(r.updatedAt || r.mergedAt || r.closedAt || r.createdAt || '');

function ChecksChip({ c }: { c: Any }) {
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
function ReviewChip({ r }: { r: Any }) {
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
function SizeChip({ s }: { s: Any }) {
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
const StatusIcon = ({ r }: { r: Any }) => (
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
function PrDetails({ t, r }: { t: Any; r: Any }) {
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

export function PullRequests() {
  useStore();
  const p = P();
  const [status, setStatus] = useState(() => store.get('tf.pr.status', 'active'));
  const [focus, setFocus] = useState('');
  const [q, setQ] = useState('');
  const [repo, setRepo] = useState('');
  const [sort, setSort] = useState(() => store.get('tf.pr.sort', 'updated'));
  const [group, setGroup] = useState(() => store.get('tf.pr.group', 'none'));
  const [open, setOpen] = useState<string | null>(null);
  const [busy] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const rows: { t: Any; r: Any }[] = p.tickets.flatMap((t: Any) =>
    (t.prs || []).map((r: Any) => ({ t, r })),
  );
  const edit = can('issue.edit');
  const ai = can('ai.use') && codeReady();
  const canAi = (r: Any) =>
    ACTIVE.includes(r.status) && ['GitHub', 'GitLab'].includes(r.provider) && r.branch;
  const save = (k: string, v: string) => store.set(`tf.pr.${k}`, v);

  // Opening the page brings open requests up to date (quietly, one at a time) when they were last
  // read 10+ minutes ago.
  const stopRef = useRef(false);
  const refreshList = async (list: { t: Any; r: Any }[], quiet: boolean) => {
    if (!list.length) return;
    setProgress({ done: 0, total: list.length });
    let failed = 0;
    for (let i = 0; i < list.length && !stopRef.current; i++) {
      if (!(await refreshPr(list[i].t, list[i].r.id, { quiet: true }))) failed += 1;
      setProgress({ done: i + 1, total: list.length });
    }
    setProgress(null);
    if (!quiet)
      toast(
        failed
          ? `${list.length - failed} of ${list.length} updated; ${failed} couldn’t be read.`
          : `${list.length} request${list.length === 1 ? '' : 's'} updated`,
        failed ? 'warn' : 'ok',
      );
  };
  useEffect(() => {
    stopRef.current = false;
    if (edit) {
      const stale = rows
        .filter(
          (x) =>
            ACTIVE.includes(x.r.status) &&
            ['GitHub', 'GitLab'].includes(x.r.provider) &&
            Date.now() - Date.parse(x.r.checkedAt || 0) > STALE_MS,
        )
        .slice(0, 12);
      refreshList(stale, true);
    }
    return () => {
      stopRef.current = true;
    };
  }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = (s: string) => rows.filter((x) => x.r.status === s).length;
  const fcount = (k: string) => rows.filter((x) => (flagsOf(x.r) as Any)[k]).length;
  const repos = [...new Set(rows.map((x) => x.r.repo).filter(Boolean))] as string[];
  const ql = q.trim().toLowerCase();
  const shown = rows
    .filter(
      ({ t, r }) =>
        (focus
          ? (flagsOf(r) as Any)[focus]
          : status === 'all' ||
            (status === 'active' ? ACTIVE.includes(r.status) : r.status === status)) &&
        (!repo || r.repo === repo) &&
        (!ql ||
          [r.title, r.branch, r.repo, ref(r), t.key, t.title, r.author, ...(r.labels || [])].some(
            (v) =>
              String(v || '')
                .toLowerCase()
                .includes(ql),
          )),
    )
    .sort((a, b) =>
      sort === 'oldest'
        ? time(a.r).localeCompare(time(b.r))
        : sort === 'size'
          ? (b.r.size?.additions || 0) +
            (b.r.size?.deletions || 0) -
            ((a.r.size?.additions || 0) + (a.r.size?.deletions || 0))
          : sort === 'issue'
            ? a.t.key.localeCompare(b.t.key, undefined, { numeric: true })
            : time(b.r).localeCompare(time(a.r)),
    );
  const groups: { key: string; title: ReactNode; items: { t: Any; r: Any }[] }[] = [];
  if (group === 'none') groups.push({ key: 'all', title: null, items: shown });
  else
    for (const x of shown) {
      const k =
        group === 'repo'
          ? x.r.repo || 'Other'
          : group === 'status'
            ? x.r.status
            : epic(x.t.epicId)?.id || 'none';
      let g = groups.find((y) => y.key === k);
      if (!g) {
        g = {
          key: k,
          title:
            group === 'epic' ? (
              epic(k) ? (
                <>
                  <Swatch color={epic(k).color} />
                  {epic(k).title}
                </>
              ) : (
                'No epic'
              )
            ) : (
              k
            ),
          items: [],
        };
        groups.push(g);
      }
      g.items.push(x);
    }
  const unlink = (t: Any, r: Any) =>
    openModal(
      <Confirm
        title={`Unlink ${r.title}?`}
        label="Unlink"
        text={`It stays on ${r.provider || 'its host'}; it's only removed from ${t.key}.`}
        onYes={() =>
          mutate(() => {
            t.prs = t.prs.filter((x: Any) => x.id !== r.id);
            logEvent(t, `unlinked pull request ${r.title}`);
          })
        }
      />,
    );
  const clearAll = () => {
    setStatus('all');
    setFocus('');
    setQ('');
    setRepo('');
  };

  const row = ({ t, r }: { t: Any; r: Any }) => {
    const id = `${t.id}-${r.id}`;
    const isOpen = open === id;
    const f = flagsOf(r);
    return (
      <div
        key={id}
        className={`pr-item s-${String(r.status).toLowerCase()} ${isOpen ? 'open' : ''}`}
      >
        <div
          className="pr-row"
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('a, button')) setOpen(isOpen ? null : id);
          }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
              e.preventDefault();
              setOpen(isOpen ? null : id);
            }
          }}
        >
          <StatusIcon r={r} />
          <div className="pr-body">
            <div className="pr-l1">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="pr-title">
                {r.title}
              </a>
              <span className="pr-num">{ref(r)}</span>
              <span className={`loz ${prCls(r.status)}`}>{r.status}</span>
              {r.aiReview && (
                <span
                  className={`loz ${VERDICT_CLS[r.aiReview.verdict] || ''}`}
                  title={`${r.aiReview.agent} · ${ago(r.aiReview.at)}${r.aiReview.posted ? ' · posted on the request' : ''}`}
                >
                  AI: {r.aiReview.verdict}
                  {r.aiReview.posted ? ' ✓' : ''}
                </span>
              )}
            </div>
            <div className="pr-l2 muted small">
              <span>{r.repo}</span>
              {r.branch && (
                <span className="pr-br">
                  <code>{r.branch}</code> → <code>{r.base || '…'}</code>
                </span>
              )}
              {r.author && (
                <span className="pr-who">
                  <Avatar name={r.author} size={16} />
                  {r.author}
                </span>
              )}
              {r.createdAt && <span>opened {ago(r.createdAt)}</span>}
              {r.updatedAt && <span>updated {ago(r.updatedAt)}</span>}
            </div>
            <div className="pr-l3">
              <ChecksChip c={r.checks} />
              <ReviewChip r={r} />
              <PrFindingChips t={t} r={r} />
              {f.conflicts && (
                <span className="pr-chip t-fail">
                  <Ico svg={I.warn} />
                  Conflicts
                </span>
              )}
              {f.ready && <span className="pr-chip t-pass">Ready to merge</span>}
              <SizeChip s={r.size} />
              {r.comments > 0 && (
                <span className="pr-meta" title={`${r.comments} comments`}>
                  <Ico svg={I.comment} />
                  {r.comments}
                </span>
              )}
              <button
                type="button"
                className="pr-issue small"
                onClick={() => openDrawer('issue', t.id)}
                title="Open the issue"
              >
                <TypeIcon type={t.type} />
                <span className="key">{t.key}</span>
                <span className="pr-issue-t">{t.title}</span>
                {t.layer && <LayerChip layer={t.layer} short />}
              </button>
            </div>
          </div>
          <div className="pr-acts">
            {ai && canAi(r) && (
              <button
                className="btn sm ai"
                onClick={() => openModal(<ReviewModal t={t} pr={r} />)}
                title="A read-only review agent reviews the diff against the issue"
              >
                <Ico svg={I.sparkle} />
                Review
              </button>
            )}
            {['GitHub', 'GitLab'].includes(r.provider) && (
              <button
                className="btn sm subtle"
                onClick={() => openPrFindings(t, r)}
                title="CodeRabbit's review comments: fix with an agent, file as bugs, or dismiss"
              >
                🐇 CodeRabbit
              </button>
            )}
            {ai && edit && canAi(r) && (
              <button
                className="btn sm"
                onClick={() => openUpdatePr(t, r)}
                title="Change, enhance, address review comments or re-describe it with AI"
              >
                Update
              </button>
            )}
            {edit && (
              <button
                className="icon-btn"
                title="Refresh from the host"
                aria-label="Refresh"
                disabled={!!busy || !!progress}
                onClick={() => refreshPr(t, r.id)}
              >
                <Ico svg={I.refresh} />
              </button>
            )}
            <a
              className="icon-btn"
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open on ${r.provider || 'the host'}`}
              aria-label={`Open on ${r.provider || 'the host'}`}
            >
              <Ico svg={I.external} />
            </a>
            <Menu
              id={`pr-${id}`}
              button={
                <button
                  className="icon-btn"
                  aria-label="More actions"
                  title="More"
                  onClick={() => setMenu(`pr-${id}`)}
                >
                  <Ico svg={I.more} />
                </button>
              }
            >
              {r.branch && (
                <button onClick={() => copyText(r.branch)}>
                  <Ico svg={I.copy} />
                  Copy branch name
                </button>
              )}
              <button onClick={() => copyText(r.url)}>
                <Ico svg={I.link} />
                Copy link
              </button>
              <button onClick={() => openDrawer('issue', t.id)}>
                <Ico svg={I.expand} />
                Open {t.key}
              </button>
              {edit && (
                <>
                  <hr />
                  <button style={{ color: 'var(--danger)' }} onClick={() => unlink(t, r)}>
                    <Ico svg={I.trash} />
                    Unlink from {t.key}
                  </button>
                </>
              )}
            </Menu>
            <button
              className="icon-btn pr-toggle"
              aria-label={isOpen ? 'Hide details' : 'Show details'}
              title={isOpen ? 'Hide details' : 'Details'}
              onClick={() => setOpen(isOpen ? null : id)}
            >
              <Ico svg={I.chevron} />
            </button>
          </div>
        </div>
        {isOpen && <PrDetails t={t} r={r} />}
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-h">
          <h1>Pull requests</h1>
          <span className="spacer" />
          {progress ? (
            <span className="muted small pr-progress">
              <Spinner />
              Updating from GitHub/GitLab… {progress.done} of {progress.total}
            </span>
          ) : (
            edit &&
            rows.some((x) => ACTIVE.includes(x.r.status)) && (
              <button
                className="btn"
                disabled={!!busy}
                onClick={() =>
                  refreshList(
                    rows.filter((x) => ACTIVE.includes(x.r.status)),
                    false,
                  )
                }
              >
                <Ico svg={I.refresh} />
                Refresh open
              </button>
            )
          )}
          {ai && (
            <Link
              className="btn"
              href={`/p/${p.id}/codejobs`}
              title="Every code generation for this project: running, ready for review, shipped"
            >
              <Ico svg={I.bot} />
              Code jobs
            </Link>
          )}
          {edit && (
            <button className="btn primary" onClick={() => openModal(<LinkModal />)}>
              <Ico svg={I.plus} />
              Link pull request
            </button>
          )}
        </div>
        <p className="muted small" style={{ marginTop: -6 }}>
          Every pull and merge request linked to this project’s issues, with their checks, reviews
          and conflicts from GitHub / GitLab.
          {ai ? (
            ' Review them with AI, or update them with AI on their own branch.'
          ) : can('ai.use') && can('project.settings') ? (
            <>
              {' '}
              Set up the local repository in{' '}
              <a
                href={`/p/${p.id}/settings`}
                onClick={() => {
                  S.setTab = 'code';
                  emit();
                }}
              >
                Project settings → Code & GitHub
              </a>{' '}
              to review and update them with AI.
            </>
          ) : (
            ''
          )}
        </p>

        <div className="pr-stats">
          {[
            ['active', 'Active', count('Open') + count('Draft')],
            ['Open', 'Open', count('Open')],
            ['Draft', 'Draft', count('Draft')],
            ['Merged', 'Merged', count('Merged')],
            ['Declined', 'Declined', count('Declined')],
            ['all', 'All', rows.length],
          ].map(([k, l, n]) => (
            <button
              key={k as string}
              type="button"
              className={!focus && status === k ? 'on' : ''}
              onClick={() => {
                setFocus('');
                setStatus(k as string);
                save('status', k as string);
              }}
            >
              <b>{n as number}</b>
              <span>{l as string}</span>
            </button>
          ))}
        </div>
        {rows.some((x) => ACTIVE.includes(x.r.status)) && (
          <div className="pr-focus" role="group" aria-label="Needs attention">
            <span className="muted small">Needs attention</span>
            {FOCUS.map(([k, l, cls]) => {
              const n = fcount(k);
              return (
                <button
                  key={k}
                  type="button"
                  className={`pr-chip ${n ? cls : ''} ${focus === k ? 'on' : ''}`}
                  disabled={!n && focus !== k}
                  aria-pressed={focus === k}
                  onClick={() => setFocus(focus === k ? '' : k)}
                >
                  {l}
                  <b>{n}</b>
                </button>
              );
            })}
          </div>
        )}

        <div className="row pr-tools">
          <TF
            filter
            search
            value={q}
            placeholder="Search title, branch, issue, label…"
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search pull requests"
          />
          {repos.length > 1 && (
            <SF
              filter
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              aria-label="Repository"
            >
              <MenuItem value="">All repositories</MenuItem>
              {repos.map((x) => (
                <MenuItem key={x} value={x}>
                  {x}
                </MenuItem>
              ))}
            </SF>
          )}
          <SF
            filter
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              save('sort', e.target.value);
            }}
            aria-label="Sort"
          >
            {SORTS.map(([k, l]) => (
              <MenuItem key={k} value={k}>
                {l}
              </MenuItem>
            ))}
          </SF>
          <SF
            filter
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              save('group', e.target.value);
            }}
            aria-label="Group by"
          >
            <MenuItem value="none">No grouping</MenuItem>
            <MenuItem value="status">Group by status</MenuItem>
            <MenuItem value="repo">Group by repository</MenuItem>
            <MenuItem value="epic">Group by epic</MenuItem>
          </SF>
          <span className="spacer" />
          <span className="muted small">
            {shown.length} of {rows.length}
          </span>
        </div>

        {!rows.length ? (
          <EmptyState
            icon={I.pr}
            title="No pull requests yet"
            actions={
              edit ? (
                <button className="btn primary" onClick={() => openModal(<LinkModal />)}>
                  <Ico svg={I.plus} />
                  Link pull request
                </button>
              ) : undefined
            }
          >
            <p>
              Pull requests appear here when a coding agent opens one (Write code with AI on an
              issue), or when you link one to an issue.
            </p>
          </EmptyState>
        ) : !shown.length ? (
          <EmptyState
            compact
            icon={I.search}
            tone="neutral"
            title="No pull requests match"
            actions={
              <button className="btn" onClick={clearAll}>
                Show all
              </button>
            }
          />
        ) : (
          groups.map((g) => (
            <div key={g.key} className="pr-group">
              {g.title && (
                <h3 className="pr-group-h">
                  {g.title}
                  <span className="count">{g.items.length}</span>
                </h3>
              )}
              <div className="pr-list">{g.items.map(row)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

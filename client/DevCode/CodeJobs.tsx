'use client';
import { useState, useEffect } from 'react';
import { refreshCodeStatus } from '../codeStatus';
import {
  type Any,
  P,
  api,
  aiBody,
  mutate,
  logEvent,
  S,
  emit,
  toast,
  closeModal,
  ago,
  openModal,
} from '../core';
import { Modal, Ico, I, Spinner } from '../ui';
import { SF, MenuItem, TA } from '../fields';
import { ParallelCheck } from '../DevPlan';
import { hasBackend } from './FolderPicker';
import { openCode } from './open-write-code';
import { STATUS } from './ApprovalBox';

// ---------------------------------------------------------------- many issues at once
const LIVE = ['starting', 'queued', 'running'];
const sideOf = (t: Any) =>
  hasBackend()
    ? t.layer === 'both'
      ? 'both'
      : t.layer === 'backend'
        ? 'backend'
        : 'frontend'
    : 'frontend';
/**
 * Backlog → select issues → Write code with AI: one job per issue (both repositories for Frontend +
 * Backend issues).
 */
export function BulkCodeModal({ ids }: { ids: string[] }) {
  const tickets = P().tickets.filter((x: Any) => ids.includes(x.id));
  const [agents, setAgents] = useState<Any[]>([]);
  const [agentId, setAgentId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Any>(null);
  const base = `/api/projects/${P().id}/code`;
  useEffect(() => {
    api(`${base}?ticketId=`)
      .then((r) => setAgents((r.agents || []).filter((a: Any) => a.enabled && a.writes)))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const jobsCount = tickets.reduce((n: number, x: Any) => n + (sideOf(x) === 'both' ? 2 : 1), 0);
  const start = async (only?: string[]) => {
    setBusy(true);
    try {
      const ticketIds = only || tickets.map((x: Any) => x.id);
      const r = await api(base, {
        method: 'POST',
        body: aiBody({ action: 'start-many', ticketIds, instructions: text, agentId }),
      });
      setResult({
        ...r,
        held: tickets.filter((x: Any) => !ticketIds.includes(x.id)).map((x: Any) => x.key),
      });
      refreshCodeStatus();
      mutate(() => {
        for (const x of tickets)
          if (r.started.some((j: Any) => j.ticketId === x.id))
            logEvent(x, 'started writing code with AI (batch)', 'Development');
      });
      S.checked.clear();
      emit();
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };
  if (result)
    return (
      <Modal title="Code jobs" wide actions={[{ label: 'Close (jobs keep running)' }]}>
        <div
          className={`warn-banner ${result.skipped.length ? '' : 'ok-banner'}`}
          style={{ marginBottom: 12 }}
        >
          <Ico svg={result.skipped.length ? I.warn : I.check} />
          <span>
            Started {result.started.length} job{result.started.length === 1 ? '' : 's'}
            {result.skipped.length
              ? `; skipped ${result.skipped.map((x: Any) => `${x.key} (${x.reason})`).join(', ')}`
              : ''}
            . Up to {result.queue.max} run at once; the rest wait in line.
            {result.held?.length
              ? ` Held back to avoid conflicts: ${result.held.join(', ')}. Start them once the first round is merged.`
              : ''}
          </span>
        </div>
        <CodeJobs />
      </Modal>
    );
  return (
    <Modal
      title={`Write code for ${tickets.length} issue${tickets.length === 1 ? '' : 's'}`}
      wide
      actions={[{ label: 'Cancel' }]}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Each issue gets its own branch, worktree and Claude Code agent. Frontend + Backend issues
        get an API contract and a job in each repository. Jobs run a few at a time; the rest wait in
        line, and you review each one as it finishes.
      </p>
      <ul className="bulk-code-list">
        {tickets.map((x: Any) => (
          <li key={x.id}>
            <code>{x.key}</code>
            <span className="bcl-title">{x.title}</span>
            {hasBackend() ? (
              <span className={`layer-chip l-${sideOf(x)}`}>
                {
                  { frontend: 'Frontend', backend: 'Backend', both: 'FE + BE' }[
                    sideOf(x) as 'frontend'
                  ]
                }
              </span>
            ) : null}
            <span className="muted small">{x.acceptanceCriteria?.length || 0} AC</span>
          </li>
        ))}
      </ul>
      <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="field" style={{ minWidth: 240 }}>
          <span>Agent</span>
          <SF value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <MenuItem value="">
              {hasBackend()
                ? 'Automatic: Frontend / Backend Developer per repository'
                : 'Build a Ticket'}
            </MenuItem>
            {agents.map((a: Any) => (
              <MenuItem key={a.id} value={a.id}>
                {a.icon} {a.name} · {a.model}
              </MenuItem>
            ))}
          </SF>
        </label>
      </div>
      <label className="field">
        <span>Extra instructions for every issue (optional)</span>
        <TA
          rows={3}
          value={text}
          placeholder="e.g. Follow the patterns in src/features/orders. Add a Vitest test for each acceptance criterion."
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <ParallelCheck
        ids={tickets.map((x: Any) => x.id)}
        busy={busy}
        onStart={(ids) => start(ids)}
      />
      <button className="btn ai" disabled={busy || !tickets.length} onClick={() => start()}>
        {busy ? (
          <>
            <Spinner />
            Starting…
          </>
        ) : (
          <>
            <Ico svg={I.sparkle} />
            {tickets.length > 1
              ? `Start all ${jobsCount} job${jobsCount === 1 ? '' : 's'}`
              : `Start ${jobsCount} job${jobsCount === 1 ? '' : 's'}`}
          </>
        )}
      </button>
    </Modal>
  );
}
/**
 * Every code job in the project, live: status, progress, changes and cost; click one to open it.
 */
export function CodeJobs() {
  const [data, setData] = useState<Any>(null);
  const base = `/api/projects/${P().id}/code`;
  const load = () =>
    api(`${base}?list=1`)
      .then(setData)
      .catch((e: Any) => toast(e.message, 'err'));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!data?.jobs?.some((j: Any) => LIVE.includes(j.status))) return;
    const h = setTimeout(load, 2500);
    return () => clearTimeout(h);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data)
    return (
      <div className="muted">
        <Spinner /> Loading…
      </div>
    );
  const jobs = data.jobs || [];
  if (!jobs.length)
    return (
      <p className="muted">
        No code jobs yet. Select issues in the backlog and choose <b>Write code with AI</b>, or open
        an issue’s Development section.
      </p>
    );
  const n = (s: string[]) => jobs.filter((j: Any) => s.includes(j.status)).length;
  const stop = async (j: Any) => {
    try {
      await api(base, { method: 'POST', body: { action: 'cancel', jobId: j.id } });
      load();
    } catch (e: Any) {
      toast(e.message, 'err');
    }
  };
  const open = (j: Any) => {
    const t = P().tickets.find((x: Any) => x.id === j.ticketId);
    if (t) {
      closeModal();
      openCode(t, j.side);
    }
  };
  return (
    <div className="jobs-ov">
      <div className="jobs-sum">
        <span>
          <b>{n(['running', 'starting'])}</b> running
        </span>
        <span>
          <b>{n(['queued'])}</b> waiting
        </span>
        <span>
          <b>{n(['review', 'report'])}</b> ready for review
        </span>
        <span>
          <b>{n(['pr', 'committed'])}</b> shipped
        </span>
        {n(['failed', 'cancelled', 'empty']) > 0 && (
          <span className="bad">
            <b>{n(['failed', 'cancelled', 'empty'])}</b> need attention
          </span>
        )}
        <span className="spacer" />
        <span className="muted small">
          {data.queue.max === 'GitHub'
            ? 'Runs through the AI API and GitHub'
            : `${data.queue.running} of ${data.queue.max} agent slots busy`}
        </span>
      </div>
      <div className="jobs-list">
        {jobs.map((j: Any) => {
          const t = P().tickets.find((x: Any) => x.id === j.ticketId);
          const add = (j.files || []).reduce((s: number, f: Any) => s + f.added, 0),
            del = (j.files || []).reduce((s: number, f: Any) => s + f.removed, 0);
          return (
            <div
              key={j.id}
              className={`job-row s-${j.status}`}
              role="button"
              tabIndex={0}
              onClick={(e) => {
                if (!(e.target as HTMLElement).closest('button')) open(j);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') open(j);
              }}
            >
              <span className={`cj-badge s-${j.status}`}>
                {LIVE.includes(j.status) ? (
                  <Spinner />
                ) : (
                  <Ico svg={['failed', 'cancelled'].includes(j.status) ? I.warn : I.check} />
                )}
                {(
                  { queued: 'Waiting', running: 'Working', starting: 'Starting' } as Record<
                    string,
                    string
                  >
                )[j.status] ||
                  STATUS[j.status] ||
                  j.status}
              </span>
              <div className="job-main">
                <div className="job-l1">
                  <code>{j.ticketKey}</code>
                  <span className="job-title">{t?.title || ''}</span>
                  {hasBackend() && (
                    <span className={`layer-chip l-${j.side}`}>
                      {j.side === 'backend' ? 'Backend' : 'Frontend'}
                    </span>
                  )}
                </div>
                <div className="job-l2 muted small">
                  <span>{j.agentName}</span>
                  {j.todosTotal > 0 && (
                    <span>
                      Plan {j.todosDone}/{j.todosTotal}
                    </span>
                  )}
                  {LIVE.includes(j.status) && j.last ? (
                    <span className="job-last">{j.last}</span>
                  ) : j.error ? (
                    <span className="job-last bad">{j.error}</span>
                  ) : null}
                  {j.files?.length > 0 && (
                    <span>
                      {j.files.length} file{j.files.length === 1 ? '' : 's'}{' '}
                      <span className="da">+{add}</span> <span className="dr">−{del}</span>
                    </span>
                  )}
                  {j.costUsd > 0 && <span>${j.costUsd.toFixed(2)}</span>}
                  <span>{ago(j.startedAt)}</span>
                </div>
              </div>
              {LIVE.includes(j.status) ? (
                <button className="btn sm subtle" onClick={() => stop(j)}>
                  <Ico svg={I.stop} />
                  {j.status === 'queued' ? 'Remove' : 'Stop'}
                </button>
              ) : (
                <button className="btn sm" onClick={() => open(j)}>
                  {['review', 'report'].includes(j.status) ? 'Review' : 'Open'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
export const openCodeJobs = () =>
  openModal(
    <Modal title="Code jobs" wide actions={[{ label: 'Close' }]}>
      <CodeJobs />
    </Modal>,
  );

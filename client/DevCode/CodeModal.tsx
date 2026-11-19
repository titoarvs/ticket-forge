'use client';
import { useState, useRef, useEffect } from 'react';
import { refreshCodeStatus } from '../codeStatus';
import {
  type Any,
  P,
  api,
  toast,
  mutate,
  logEvent,
  aiBody,
  uid,
  nowIso,
  openModal,
  ago,
  can,
  downloadFrom,
  saveBlob,
} from '../core';
import { Modal, Spinner, LAYER_LABEL, Ico, I, Confirm } from '../ui';
import { TA, TF, CB } from '../fields';
import { Markdown } from '../GuideCard';
import { saveReview, CodeRabbitPanel } from '../CodeRabbit';
import { DiffReview } from '../DiffReview';
import { hasBackend, be, myPath } from './FolderPicker';
import { dev } from './dev';
import { STATUS, JobSteps, Activity, ApprovalBox } from './ApprovalBox';

/**
 * Issue panel → Write code with AI: start, watch, review, ask for changes, open the pull request.
 */
export function CodeModal({
  t,
  agentId: initialAgent = 'build',
  initialSide,
}: {
  t: Any;
  agentId?: string;
  initialSide?: string;
}) {
  // Projects with a separate backend: one job per repository (Frontend / Backend). "Both" issues
  // start with the backend.
  const [jobs, setJobs] = useState<Record<string, Any>>({});
  const [backend, setBackend] = useState(hasBackend());
  const [side, setSide] = useState<string>(
    initialSide ||
      (hasBackend() && (t.layer === 'backend' || t.layer === 'both') ? 'backend' : 'frontend'),
  );
  const job = jobs[side] || null;
  const setJob = (v: Any) =>
    setJobs((js) => ({ ...js, [side]: typeof v === 'function' ? v(js[side]) : v }));
  const [agents, setAgents] = useState<Any[]>([]);
  const [agentId, setAgentId] = useState(initialAgent);
  const [reviewTab, setReviewTab] = useState(0);
  const [roles, setRoles] = useState<Record<string, string | null>>({});
  const [tab, setTab] = useState('');
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [follow, setFollow] = useState('');
  const [busy, setBusy] = useState('');
  const [contract, setContract] = useState('');
  const [title, setTitle] = useState(`${t.key}: ${t.title}`);
  const [prBody, setPrBody] = useState('');
  const [draft, setDraft] = useState(dev().draft !== false);
  const logRef = useRef<HTMLDivElement>(null);
  const base = `/api/projects/${P().id}/code`;
  useEffect(() => {
    api(`${base}?ticketId=${t.id}`)
      .then((r) => {
        setJobs(r.jobs || { frontend: r.job });
        setBackend(Boolean(r.backend));
        setAgents(r.agents || []);
        setRoles(r.roles || {});
        if (initialAgent === 'build' && r.roles?.build) setAgentId(r.roles.build);
        // A "both" issue whose backend is done: open on the frontend.
        if (
          r.backend &&
          t.layer === 'both' &&
          r.jobs?.backend &&
          ['committed', 'review'].includes(r.jobs.backend.status) &&
          !r.jobs?.frontend
        )
          setSide('frontend');
      })
      .catch((e) => toast(e.message, 'err'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // With two repositories, default to the agent made for that side (unless an agent was chosen for
  // you).
  // With two repositories, default to that repository's agent (Administration → Agents → Default
  // agents).
  useEffect(() => {
    if (backend && initialAgent === 'build' && roles[side]) setAgentId(roles[side]);
  }, [side, backend, roles]); // eslint-disable-line react-hooks/exhaustive-deps
  // Follow every running job (both repositories when they run at once).
  useEffect(() => {
    const live = Object.entries(jobs).filter(
      ([, j]) =>
        j &&
        (['starting', 'queued', 'running'].includes(j.status) ||
          j.coderabbit?.status === 'running'),
    );
    if (!live.length) return;
    const h = setTimeout(
      async () => {
        const got = await Promise.all(
          live.map(async ([k, j]) => {
            try {
              return [k, j.id, await api(`${base}?jobId=${j.id}&since=${j.logSize || 0}`)] as const;
            } catch {
              return null;
            }
          }),
        );
        setJobs((js) => {
          const next = { ...js };
          for (const g of got) {
            if (!g) continue;
            const [k, id, r] = g;
            if (next[k]?.id !== id) continue;
            next[k] = { ...r, log: [...(next[k]?.log || []), ...r.log] };
          }
          return next;
        });
      },
      live.some(([, j]) => j.remote) ? 6000 : 1500,
    );
    return () => clearTimeout(h);
  }, [jobs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    logRef.current?.scrollTo({ top: 1e9 });
  }, [job?.log?.length]);
  useEffect(() => {
    setTab('');
  }, [job?.id]);
  // A finished CodeRabbit review is saved on the issue (findings, then their status: bug, sent to
  // agent, dismissed).
  useEffect(() => {
    if (job?.coderabbit?.status === 'done') saveReview(t, job);
  }, [job?.coderabbit?.status, job?.coderabbit?.round]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (kind: string, body: Any) => {
    setBusy(kind);
    try {
      const r = await api(base, { method: 'POST', body: { ...body, jobId: job?.id } });
      refreshCodeStatus();
      if (r?.id)
        setJob((j: Any) => ({
          ...r,
          log: kind === 'start' ? r.log : [...(j?.log || []), ...r.log.slice(j?.logSize ?? 0)],
        }));
      return r;
    } catch (e: Any) {
      toast(e.message, 'err');
      return null;
    } finally {
      setBusy('');
    }
  };
  // Frontend + Backend issue: agree the API, then build both repositories in parallel.
  const startBoth = async () => {
    setBusy('both');
    try {
      const r = await api(base, {
        method: 'POST',
        body: { action: 'start-both', ticketId: t.id, instructions: text },
      });
      refreshCodeStatus();
      setJobs((js) => ({ ...js, ...r.jobs }));
      setContract(r.contract || '');
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const idle = (k: string) => !jobs[k] || jobs[k].status === 'discarded';
  const canBoth = backend && t.layer === 'both' && idle('backend') && idle('frontend');
  const commitLocal = async () => {
    const r = await act('commit', { action: 'commit', title });
    if (!r?.commit) return;
    setJob(r.job);
    mutate(() => {
      logEvent(
        t,
        `committed the ${side} changes written by AI on the local branch ${r.commit.branch} (${r.commit.sha}) in ${r.commit.repoPath}`,
        'Development',
      );
    });
    toast(`On branch ${r.commit.branch} in ${r.commit.repoPath}. Nothing was pushed.`, 'ok', {
      title: `Committed ${r.commit.sha} locally`,
    });
  };
  /** The AI drafts the title and description from the diff, the agent's summary and the issue. */
  const draftPr = async () => {
    setBusy('draft');
    try {
      const r = await api(base, {
        method: 'POST',
        body: aiBody({ action: 'prDraft', jobId: job?.id }),
      });
      setTitle(r.title);
      setPrBody(r.body);
    } catch (e: Any) {
      toast(`Couldn’t write the description: ${e.message}`, 'err');
    } finally {
      setBusy('');
    }
  };
  const pushUpdate = async () => {
    const r = await act('push', { action: 'push', message: title });
    if (!r?.job) return;
    setJob(r.job);
    mutate(() => {
      logEvent(
        t,
        `pushed ${r.commit} to ${job.target.provider === 'GitLab' ? 'merge request !' : 'pull request #'}${job.target.number} with changes written by AI`,
        'Development',
      );
    });
    toast(
      `Pushed ${r.commit} to ${job.target.provider === 'GitLab' ? '!' : '#'}${job.target.number}: the ${job.target.provider === 'GitLab' ? 'merge request' : 'pull request'} is updated.`,
      'ok',
      {
        title: 'Changes pushed',
        action: { label: 'Open', onClick: () => window.open(job.target.url, '_blank', 'noopener') },
      },
    );
  };
  const openPr = async () => {
    const r = await act('pr', { action: 'pr', title, draft, body: prBody.trim() || undefined });
    if (!r?.pr) return;
    setJob(r.job);
    const noun = job.provider === 'GitLab' ? 'merge request' : 'pull request';
    if (r.pr.compare) {
      // Pushed with your git setup; the request opens on GitHub/GitLab (no token to open it from
      // here).
      mutate(() => {
        logEvent(t, `pushed ${r.pr.branch} with code written by AI`, 'Development');
      });
      toast(
        `Pushed ${r.pr.branch}. Open the ${noun} on ${job.provider || 'GitHub'} to finish.`,
        'ok',
        {
          title: 'Branch pushed',
          action: {
            label: `Open ${noun}`,
            onClick: () => window.open(r.pr.url, '_blank', 'noopener'),
          },
        },
      );
      window.open(r.pr.url, '_blank', 'noopener');
      return;
    }
    mutate(() => {
      t.prs.push({ id: uid(), ...r.pr, checkedAt: nowIso() });
      logEvent(
        t,
        `opened ${noun} ${r.pr.repo} #${r.pr.number} with code written by AI`,
        'Development',
      );
    });
    toast(`Opened ${r.pr.repo} #${r.pr.number}`);
  };
  /**
   * Approve the code (TF-123). Approve and merge also records the approval; when it is blocked the
   * approval stays, so the job is read again for the new count.
   */
  const reloadJob = async () => {
    try {
      const r = await api(`${base}?jobId=${job.id}&since=${job.logSize || 0}`);
      setJob((j: Any) => ({ ...r, log: [...(j?.log || []), ...r.log] }));
    } catch {
      /* the next poll or reopening shows it */
    }
  };
  const approve = async () => {
    const r = await act('approve', { action: 'approve' });
    if (r) toast(`Approved ${r.approvals?.length || 0} of ${r.required}`);
    else await reloadJob();
  };
  const merge = async () => {
    const r = await act('merge', { action: 'merge' });
    if (!r) {
      await reloadJob();
      return;
    }
    mutate(() => {
      const pr = t.prs.find(
        (x: Any) =>
          (x.url && x.url === r.pr?.url) ||
          (x.number && x.number === r.pr?.number && x.repo === r.repo),
      );
      if (pr) {
        pr.status = 'Merged';
        pr.mergedAt = r.merged?.at || nowIso();
      }
      logEvent(
        t,
        `merged pull request #${r.pr?.number} after ${r.approvals?.length || 0} of ${r.required} approvals`,
        'Development',
      );
    });
    toast(`${r.repo} #${r.pr?.number} is merged.`, 'ok', {
      title: 'Code merged',
      action: r.pr?.url
        ? { label: 'Open', onClick: () => window.open(r.pr.url, '_blank', 'noopener') }
        : undefined,
    });
  };
  const running = job && ['starting', 'queued', 'running'].includes(job.status);
  const d = dev();
  // An AI review of an open pull request: remember the verdict on the linked request (Pull requests
  // page).
  const isPrReview = job?.kind === 'pr-review';
  const reviewedPr = isPrReview ? t.prs.find((r: Any) => r.url === job.target?.url) : null;
  useEffect(() => {
    if (
      !isPrReview ||
      job.status !== 'report' ||
      !reviewedPr ||
      reviewedPr.aiReview?.jobId === job.id
    )
      return;
    const verdict = /request(ed)? changes/i.test(job.summary || '')
      ? 'Changes requested'
      : /approve with comments/i.test(job.summary || '')
        ? 'Approve with comments'
        : /approve/i.test(job.summary || '')
          ? 'Approve'
          : 'Reviewed';
    mutate(() => {
      reviewedPr.aiReview = {
        jobId: job.id,
        at: job.finishedAt || nowIso(),
        agent: job.agentName,
        verdict,
        posted: null,
      };
      logEvent(
        t,
        `${job.agentName} agent reviewed ${reviewedPr.provider === 'GitLab' ? '!' : '#'}${reviewedPr.number}: ${verdict}`,
        'Development',
      );
    });
  }, [isPrReview, job?.status, job?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const postReview = async () => {
    const r = await act('postReview', { action: 'postReview' });
    if (!r?.id) return;
    if (reviewedPr)
      mutate(() => {
        reviewedPr.aiReview = { ...(reviewedPr.aiReview || {}), posted: r.posted };
      });
    toast(
      `The review is a comment on ${job.target.provider === 'GitLab' ? '!' : '#'}${job.target.number} now.`,
      'ok',
      {
        title: 'Review posted',
        action: { label: 'Open', onClick: () => window.open(job.target.url, '_blank', 'noopener') },
      },
    );
  };
  return (
    <Modal
      title={`${isPrReview ? `Code review · ${job.target.provider === 'GitLab' ? '!' : '#'}${job.target.number}` : 'Write code'} · ${t.key}`}
      wide="xl"
      persistent={running}
      actions={[{ label: running ? 'Close (keeps running)' : 'Close' }]}
    >
      {backend && !loading && (
        <div className="side-tabs" role="tablist" aria-label="Repository">
          {(['backend', 'frontend'] as const).map((k) => {
            const jj = jobs[k];
            const busyK = jj && ['starting', 'queued', 'running'].includes(jj.status);
            return (
              <button
                key={k}
                role="tab"
                aria-selected={side === k}
                className={side === k ? 'on' : ''}
                onClick={() => setSide(k)}
              >
                <span className={`layer-chip l-${k}`}>
                  {k === 'backend' ? 'Backend' : 'Frontend'}
                </span>
                <span className="muted small">
                  {k === 'backend' ? be().repo || myPath('backend') : d.repo || myPath('frontend')}
                </span>
                <span className="side-state small">
                  {busyK ? (
                    <>
                      <Spinner /> {jj.status === 'queued' ? 'waiting' : 'working'}
                    </>
                  ) : jj && jj.status !== 'discarded' ? (
                    STATUS[jj.status] || jj.status
                  ) : (
                    'Not started'
                  )}
                </span>
              </button>
            );
          })}
          <span className="side-hint small muted">
            {t.layer ? (
              <>
                This issue is marked <b>{LAYER_LABEL[t.layer]}</b>.
                {t.layer === 'both'
                  ? ' Build both at once, or the backend first so the frontend gets its API summary.'
                  : ''}
              </>
            ) : (
              'Mark the issue frontend, backend or both in its details.'
            )}
          </span>
        </div>
      )}
      {contract && (
        <details className="contract-box">
          <summary className="small">
            <b>API contract</b>{' '}
            <span className="muted">shared by the backend and frontend jobs</span>
          </summary>
          <pre>{contract}</pre>
        </details>
      )}
      {loading ? (
        <div className="muted">
          <Spinner /> Loading…
        </div>
      ) : !job || ['discarded'].includes(job.status) ? (
        <>
          {agents.length > 0 && (
            <>
              <div className="pick-label small">Which agent?</div>
              {!agents.some((a: Any) => a.writes && a.enabled) && (
                <div className="warn-banner" style={{ marginBottom: 8 }}>
                  <Ico svg={I.warn} />
                  <span>
                    No agent can write code yet. Create one in Administration → Agents (kind:{' '}
                    <b>Code</b>).
                  </span>
                </div>
              )}
              <div className="agent-pick" role="radiogroup" aria-label="Agent">
                {agents
                  .filter((a: Any) => !['review', 'review-panel'].includes(a.id))
                  .map((a: Any) => (
                    <button
                      key={a.id}
                      role="radio"
                      aria-checked={agentId === a.id}
                      className={`${agentId === a.id ? 'on' : ''} ph-${String(a.phase).toLowerCase()}`}
                      disabled={!a.enabled}
                      onClick={() => setAgentId(a.id)}
                      title={a.does.join(' ')}
                    >
                      <span className="agent-icon sm" aria-hidden>
                        {a.icon}
                      </span>
                      <span className="ap-text">
                        <b>{a.name}</b>
                        <span className="muted small">
                          {a.summary}
                          {!a.enabled ? ' (turned off)' : ''}
                        </span>
                        <span className="ap-meta">
                          {a.workspaceLabel} · {a.model}
                          {a.effort ? ` · ${a.effort}` : ''}
                        </span>
                      </span>
                    </button>
                  ))}
              </div>
              {(() => {
                const a = agents.find((x: Any) => x.id === agentId);
                return a ? (
                  <ul className="ap-does small">
                    {a.does.map((x: string) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                ) : null;
              })()}
            </>
          )}
          <p className="muted small" style={{ marginTop: 0 }}>
            It runs as a Claude Code agent on <b>{t.title}</b> from its story,{' '}
            {t.acceptanceCriteria?.length || 0} acceptance criteria and {t.testCases?.length || 0}{' '}
            test cases, in a new branch{' '}
            <code>
              {d.branchPrefix ?? 'tf/'}
              {String(t.key).toLowerCase()}-…
            </code>{' '}
            from <code>{d.baseBranch || 'the default branch'}</code> of{' '}
            <b>{d.repo || d.localPath}</b>, in its own worktree. Nothing is pushed until you review
            the changes and open the pull request.
          </p>
          <label className="field">
            <span>Extra instructions (optional)</span>
            <TA
              rows={4}
              value={text}
              placeholder="e.g. Put the API in app/api/payslips. Reuse the PayslipTable component. Add a Vitest test."
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {canBoth && (
            <div className="both-box">
              <div>
                <b>Build both at once</b>
                <span className="muted small">
                  Agrees the API in a few seconds, then the backend and frontend agents work in
                  parallel, each in its own repository. About twice as fast as one after the other.
                </span>
              </div>
              <button className="btn ai" disabled={!!busy} onClick={startBoth}>
                {busy === 'both' ? (
                  <>
                    <Spinner />
                    Agreeing the API…
                  </>
                ) : (
                  <>
                    <Ico svg={I.sparkle} />
                    Build both at once
                  </>
                )}
              </button>
            </div>
          )}
          {backend &&
            side === 'frontend' &&
            t.layer === 'both' &&
            !canBoth &&
            !['committed', 'review', 'starting', 'running'].includes(jobs.backend?.status) && (
              <div className="warn-banner" style={{ marginBottom: 8 }}>
                <Ico svg={I.warn} />
                <span>
                  The backend part isn’t done yet. You can start the frontend now, but it won’t know
                  the final API.
                </span>
                <button
                  className="btn sm"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => setSide('backend')}
                >
                  Go to Backend
                </button>
              </div>
            )}
          {backend && side === 'backend' && (
            <p className="small muted" style={{ marginTop: 0 }}>
              Runs in <code>{myPath('backend')}</code>
              {be().repo ? (
                <>
                  {' '}
                  ·{' '}
                  {be().provider === 'GitLab'
                    ? 'merge request on GitLab'
                    : 'pull request on GitHub'}{' '}
                  <code>{be().repo}</code>
                </>
              ) : (
                ''
              )}
              .
            </p>
          )}
          <button
            className="btn ai"
            disabled={!!busy}
            onClick={() =>
              act('start', { action: 'start', ticketId: t.id, instructions: text, agentId, side })
            }
          >
            {busy ? (
              <>
                <Spinner />
                Starting…
              </>
            ) : (
              <>
                <Ico svg={I.sparkle} />
                {agentId === 'feature-tests' ? 'Write the tests' : 'Start the agent'}
              </>
            )}
          </button>
        </>
      ) : (
        <>
          <div className="cj-head">
            <div className="cj-title">
              <span className={`cj-badge s-${job.status}`}>
                {running ? (
                  <Spinner />
                ) : (
                  <Ico
                    svg={
                      ['failed', 'cancelled'].includes(job.status)
                        ? I.warn
                        : ['empty', 'discarded'].includes(job.status)
                          ? I.clock
                          : I.check
                    }
                  />
                )}
                {STATUS[job.status] || job.status}
              </span>
              {job.agentName && (
                <span className="cj-agent">
                  <Ico svg={I.bot} />
                  {job.agentName}
                </span>
              )}
              {job.rounds > 1 && <span className="cj-agent">Round {job.rounds}</span>}
              <span className="spacer" />
              {running && (
                <button className="btn sm" onClick={() => act('cancel', { action: 'cancel' })}>
                  <Ico svg={I.stop} />
                  Stop
                </button>
              )}
              {!running && !['pr', 'merged'].includes(job.status) && (
                <button
                  className="btn sm subtle"
                  onClick={() =>
                    openModal(
                      <Confirm
                        title="Discard these changes?"
                        label="Discard"
                        text={`The worktree and the local branch ${job.branch} are removed. Nothing was pushed.`}
                        onYes={async () => {
                          await act('discard', { action: 'discard' });
                          setJob(null);
                          openModal(<CodeModal t={t} />);
                        }}
                      />,
                    )
                  }
                >
                  <Ico svg={I.trash} />
                  Discard
                </button>
              )}
            </div>
            <div className="cj-meta small">
              <span className="cj-branch" title={`${job.branch} → ${job.base}`}>
                <Ico svg={I.pr} />
                <code>{job.branch}</code>
                <span className="muted">→</span>
                <code>{job.base}</code>
              </span>
              <span>
                <Ico svg={I.folder} />
                {job.repo || 'local repository'}
              </span>
              <span>
                <Ico svg={I.clock} />
                Started {ago(job.startedAt)}
              </span>
              {job.remote && (
                <span>
                  <Ico svg={I.external} />
                  {job.runUrl ? (
                    <a href={job.runUrl} target="_blank" rel="noopener noreferrer">
                      GitHub Actions run
                    </a>
                  ) : (
                    'AI API + GitHub'
                  )}
                </span>
              )}
              {job.costUsd ? <span>${job.costUsd.toFixed(2)}</span> : null}
            </div>
          </div>
          <JobSteps job={job} />
          {job.error && (
            <div className="warn-banner danger">
              <Ico svg={I.warn} />
              <span>{job.error}</span>
            </div>
          )}
          {(() => {
            const tabs = [
              job.summary &&
                !running && {
                  id: 'summary',
                  label: job.status === 'report' ? 'Report' : 'Summary',
                },
              job.files?.length > 0 && { id: 'changes', label: 'Changes', n: job.files.length },
              job.reviews?.length > 0 && { id: 'reviews', label: 'Reviews', n: job.reviews.length },
              job.coderabbit && {
                id: 'coderabbit',
                label: 'CodeRabbit',
                n:
                  job.coderabbit.status === 'running'
                    ? undefined
                    : (job.coderabbit.findings || []).length,
              },
              {
                id: 'activity',
                label: running ? 'Live activity' : 'Activity',
                n: job.log.filter((l: Any) => l.kind === 'tool').length,
              },
            ].filter(Boolean) as { id: string; label: string; n?: number }[];
            const cur =
              tabs.find((x) => x.id === tab)?.id ||
              (running ? 'activity' : tabs.find((x) => x.id === 'changes')?.id || tabs[0].id); // finished code opens on its diff (TF-123)
            const rawVerdict =
              (job.summary || '').match(/^\s*\*\*Verdict:\s*([^*]+?)\.?\*\*/i)?.[1] || '';
            const vClass = /request|block|reject/i.test(rawVerdict)
              ? 'bad'
              : /comment/i.test(rawVerdict)
                ? 'warn'
                : /approve/i.test(rawVerdict)
                  ? 'ok'
                  : '';
            return (
              <div className="cj-box">
                <div className="cj-tabs" role="tablist">
                  {tabs.map((x) => (
                    <button
                      key={x.id}
                      role="tab"
                      aria-selected={cur === x.id}
                      className={cur === x.id ? 'on' : ''}
                      onClick={() => setTab(x.id)}
                    >
                      {x.id === 'activity' && running && <span className="live-dot" />}
                      {x.label}
                      {x.n != null && <span className="cj-n">{x.n}</span>}
                    </button>
                  ))}
                </div>
                <div
                  className={`cj-panel ${cur === 'changes' ? 'cj-panel-diff' : ''}`}
                  ref={cur === 'activity' ? logRef : undefined}
                >
                  {cur === 'summary' && (
                    <>
                      {(rawVerdict ||
                        (job.status === 'report' && (isPrReview || can('export')))) && (
                        <div className="cj-toolbar">
                          {rawVerdict && (
                            <span className={`cj-verdict v-${vClass}`}>
                              <Ico svg={vClass === 'ok' ? I.check : I.warn} />
                              {rawVerdict}
                            </span>
                          )}
                          <span className="spacer" />
                          {isPrReview && job.status === 'report' && (
                            <>
                              {job.posted ? (
                                <span className="muted small">
                                  <Ico svg={I.check} /> Posted on{' '}
                                  {job.target.provider === 'GitLab' ? '!' : '#'}
                                  {job.target.number} {ago(job.posted)}
                                </span>
                              ) : (
                                <button
                                  className="btn sm primary"
                                  disabled={!!busy}
                                  onClick={postReview}
                                >
                                  {busy === 'postReview' ? (
                                    <>
                                      <Spinner />
                                      Posting…
                                    </>
                                  ) : (
                                    <>
                                      <Ico svg={I.comment} />
                                      Post on {job.target.provider === 'GitLab' ? '!' : '#'}
                                      {job.target.number}
                                    </>
                                  )}
                                </button>
                              )}
                              <a
                                className="btn sm subtle"
                                href={job.target.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <Ico svg={I.external} />
                                Open
                              </a>
                            </>
                          )}
                          {job.status === 'report' && can('export') && (
                            <>
                              <button
                                className="btn sm subtle"
                                onClick={async () => {
                                  try {
                                    toast(
                                      `Downloaded ${await downloadFrom(`/api/projects/${P().id}/code`, { body: { action: 'docx', jobId: job.id }, fallbackName: `${job.agentName} - ${job.ticketKey}.docx` })}`,
                                    );
                                  } catch (e: Any) {
                                    toast(`Couldn’t download the report: ${e.message}`, 'err');
                                  }
                                }}
                              >
                                <Ico svg={I.download} />
                                .docx
                              </button>
                              <button
                                className="btn sm subtle"
                                onClick={() =>
                                  saveBlob(
                                    new Blob([job.summary], { type: 'text/markdown' }),
                                    `${job.agentName} - ${job.ticketKey}.md`,
                                  )
                                }
                              >
                                <Ico svg={I.download} />
                                .md
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      <div className="cj-doc code-md">
                        <Markdown
                          text={
                            rawVerdict
                              ? job.summary.replace(/^\s*\*\*Verdict:[^*]*\*\*\s*/i, '')
                              : job.summary
                          }
                        />
                      </div>
                    </>
                  )}
                  {cur === 'changes' && <DiffReview job={job} />}
                  {cur === 'reviews' &&
                    (() => {
                      const rv = job.reviews[job.reviews.length - 1];
                      const lens = rv.lenses?.[Math.min(reviewTab, rv.lenses.length - 1)];
                      return (
                        <>
                          <div className="cj-toolbar">
                            <b className="small">
                              {rv.panel ? 'Review Panel' : rv.agent || 'Review agent'} · round{' '}
                              {rv.round}
                            </b>
                            <span className="spacer" />
                            {job.status === 'review' && (
                              <button
                                className="btn sm ai"
                                disabled={!!busy}
                                onClick={() =>
                                  act('follow', {
                                    action: 'follow',
                                    text: `Fix these review findings (skip any you disagree with and say why):\n\n${rv.text}`,
                                  })
                                }
                              >
                                <Ico svg={I.sparkle} />
                                Fix the findings
                              </button>
                            )}
                          </div>
                          {rv.panel && (
                            <div className="review-tabs" role="tablist">
                              {rv.lenses.map((l: Any, i: number) => (
                                <button
                                  key={l.id}
                                  role="tab"
                                  aria-selected={reviewTab === i}
                                  className={reviewTab === i ? 'on' : ''}
                                  onClick={() => setReviewTab(i)}
                                >
                                  {l.name}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="cj-doc code-md">
                            <Markdown text={rv.panel ? lens?.text || '' : rv.text} />
                          </div>
                        </>
                      );
                    })()}
                  {cur === 'coderabbit' && (
                    <CodeRabbitPanel
                      t={t}
                      job={job}
                      busy={busy}
                      run={() => {
                        act('coderabbit', { action: 'coderabbit' });
                        setTab('coderabbit');
                      }}
                      follow={(text) => act('follow', { action: 'follow', text })}
                    />
                  )}
                  {cur === 'activity' && (
                    <>
                      {job.todos?.length > 0 && (
                        <div className="cj-plan">
                          <div className="small">
                            <b>Plan</b>{' '}
                            <span className="muted">
                              {job.todos.filter((x: Any) => x.status === 'completed').length} of{' '}
                              {job.todos.length} done
                            </span>
                          </div>
                          <ul>
                            {job.todos.map((x: Any, i: number) => (
                              <li key={i} className={x.status}>
                                <span className="tick">
                                  {x.status === 'completed' ? (
                                    <Ico svg={I.check} />
                                  ) : x.status === 'in_progress' ? (
                                    <Spinner />
                                  ) : null}
                                </span>
                                {x.content}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <Activity log={job.log} running={running} />
                    </>
                  )}
                </div>
              </div>
            );
          })()}
          {job.remote && ['review', 'pr', 'merged'].includes(job.status) && (
            <ApprovalBox job={job} busy={busy} onApprove={approve} onMerge={merge} />
          )}
          {['review', 'report', 'empty', 'failed', 'cancelled'].includes(job.status) && (
            <div className="code-follow cj-compose">
              <TA
                rows={2}
                value={follow}
                placeholder="Ask for changes: e.g. also handle the empty state, and rename the hook to usePayslips"
                onChange={(e) => setFollow(e.target.value)}
              />
              <button
                className="btn ai"
                disabled={!follow.trim() || !!busy}
                onClick={async () => {
                  if (await act('follow', { action: 'follow', text: follow })) setFollow('');
                }}
              >
                <Ico svg={I.sparkle} />
                Make changes
              </button>
            </div>
          )}
          {job.status === 'review' && !job.pr && !job.remote && (
            <div className="review-actions">
              {roles.review && (
                <button
                  className="agent-btn hire sm"
                  disabled={!!busy}
                  onClick={() => act('review', { action: 'review' })}
                  title={`Reviewed by ${agents.find((a: Any) => a.id === roles.review)?.name || 'the review agent'}`}
                >
                  🔍 {job.reviews?.length ? 'Review again' : 'Review changes'}
                </button>
              )}
              {roles.review && agents.some((a: Any) => a.id === 'review-panel' && a.enabled) && (
                <button
                  className="agent-btn hire sm"
                  disabled={!!busy}
                  onClick={() => {
                    setReviewTab(0);
                    act('review', { action: 'review', panel: true });
                  }}
                  title="Three Review agents in parallel: correctness, security, tests & acceptance"
                >
                  🤝 Review panel
                </button>
              )}
              {agents.some((a: Any) => a.id === 'ui-review' && a.enabled) && (
                <button
                  className="agent-btn hire sm"
                  disabled={!!busy}
                  onClick={() => act('review', { action: 'review', agent: 'ui-review' })}
                  title="Usability, accessibility, states, copy and responsive layout"
                >
                  🧐 UI/UX review
                </button>
              )}
              {agents
                .filter((a: Any) => a.custom && !a.writes && a.enabled && a.id !== roles.review)
                .map((a: Any) => (
                  <button
                    key={a.id}
                    className="agent-btn hire sm"
                    disabled={!!busy}
                    onClick={() => act('review', { action: 'review', agent: a.id })}
                    title={a.summary}
                  >
                    {a.icon} {a.name}
                  </button>
                ))}
              <button
                className="agent-btn hire sm"
                disabled={!!busy || job.coderabbit?.status === 'running'}
                onClick={() => {
                  act('coderabbit', { action: 'coderabbit' });
                  setTab('coderabbit');
                }}
                title="An independent review by the CodeRabbit CLI: findings by severity, with fix instructions"
              >
                🐇{' '}
                {job.coderabbit?.status === 'running'
                  ? 'CodeRabbit is reviewing…'
                  : 'CodeRabbit review'}
              </button>
              <span className="muted small">Read-only reviewers. They never edit files.</span>
            </div>
          )}
          {job.status === 'committed' && (
            <div className="ok-banner">
              <Ico svg={I.check} />
              <span>
                Committed on the local branch <code>{job.branch}</code> in{' '}
                <code>{job.repoPath}</code>. Nothing was pushed.
                {side === 'backend' && t.layer === 'both'
                  ? ' Next: the Frontend tab, which builds on this API.'
                  : ''}
              </span>
              {side === 'backend' && t.layer === 'both' && (
                <button
                  className="btn sm"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => setSide('frontend')}
                >
                  Go to Frontend
                </button>
              )}
            </div>
          )}
          {job.status === 'review' && can('issue.edit') && job.target && (
            <div className="code-pr pr-compose">
              <div className="pr-compose-h">
                <Ico svg={I.pr} />
                <b>
                  Update{' '}
                  {job.target.provider === 'GitLab'
                    ? `merge request !${job.target.number}`
                    : `pull request #${job.target.number}`}
                </b>
                <a
                  className="muted small"
                  href={job.target.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {job.target.title}
                </a>
              </div>
              <label className="field" style={{ margin: 0 }}>
                <span>Commit message</span>
                <TF value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn primary"
                  disabled={!!busy || !title.trim()}
                  onClick={pushUpdate}
                >
                  {busy === 'push' ? (
                    <>
                      <Spinner />
                      Pushing…
                    </>
                  ) : (
                    <>
                      <Ico svg={I.pr} />
                      Commit and push to {job.target.provider === 'GitLab' ? '!' : '#'}
                      {job.target.number}
                    </>
                  )}
                </button>
                <span className="muted small">
                  Pushes to <code>{job.branch}</code>; the{' '}
                  {job.target.provider === 'GitLab' ? 'merge request' : 'pull request'} updates
                  itself, and a comment says what changed.
                </span>
              </div>
            </div>
          )}
          {job.status === 'review' && can('issue.edit') && !job.target && (
            <div className="code-pr pr-compose">
              <div className="pr-compose-h">
                <Ico svg={I.pr} />
                <b>{job.provider === 'GitLab' ? 'Merge request' : 'Pull request'}</b>
                <span className="muted small">
                  <code>{job.branch}</code> → <code>{job.base}</code>
                </span>
                {can('ai.use') && (
                  <button
                    className="btn sm ai"
                    style={{ marginLeft: 'auto' }}
                    disabled={!!busy}
                    onClick={draftPr}
                  >
                    {busy === 'draft' ? (
                      <>
                        <Spinner />
                        Writing…
                      </>
                    ) : (
                      <>
                        <Ico svg={I.sparkle} />
                        {prBody ? 'Rewrite with AI' : 'Write title & description with AI'}
                      </>
                    )}
                  </button>
                )}
              </div>
              <label className="field" style={{ margin: 0 }}>
                <span>Title</span>
                <TF value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span>Description (Markdown)</span>
                <TA
                  rows={prBody ? 10 : 3}
                  value={prBody}
                  placeholder="Leave empty for the standard description (story, acceptance criteria, the agent’s summary), or write it with AI: Summary, Changes, How to test, Acceptance criteria."
                  onChange={(e) => setPrBody(e.target.value)}
                />
              </label>
              <div className="row" style={{ gap: 8 }}>
                <CB
                  label="Draft"
                  checked={draft}
                  onChange={(e: Any) => setDraft(e.target.checked)}
                />
                <span className="spacer" />
                {!job.remote && (
                  <button
                    className="btn subtle"
                    disabled={!!busy || !title.trim()}
                    onClick={commitLocal}
                    title="Commit on the local branch without pushing"
                  >
                    {busy === 'commit' ? <Spinner /> : 'Commit locally only'}
                  </button>
                )}
                <button className="btn primary" disabled={!!busy || !title.trim()} onClick={openPr}>
                  {busy === 'pr' ? (
                    <>
                      <Spinner />
                      Opening…
                    </>
                  ) : (
                    <>
                      <Ico svg={I.pr} />
                      {job.remote ? (
                        'Open pull request'
                      ) : (
                        <>Commit, push and open {job.provider === 'GitLab' ? 'MR' : 'PR'}</>
                      )}
                    </>
                  )}
                </button>
              </div>
              <div className="muted small">
                {job.remote ? (
                  'Opens the pull request for the branch the job pushed to GitHub.'
                ) : (
                  <>
                    Commits with your git name and email, pushes <code>{job.branch}</code> to the
                    repository’s <code>origin</code> with your own git setup (SSH key or credential
                    helper; the project’s token only if that’s refused), then opens the{' '}
                    {job.provider === 'GitLab' ? 'merge request' : 'pull request'}.
                  </>
                )}
              </div>
            </div>
          )}
          {job.pr?.compare && (
            <div className="ok-banner">
              <Ico svg={I.check} />
              <span>
                Committed and pushed <code>{job.branch}</code> with your git setup.{' '}
                <a href={job.pr.url} target="_blank" rel="noopener noreferrer">
                  Open the {job.provider === 'GitLab' ? 'merge request' : 'pull request'} on{' '}
                  {job.provider || 'GitHub'}
                </a>{' '}
                to finish; link it to this issue in Development once it’s open.
              </span>
            </div>
          )}
          {job.pr && !job.pr.compare && job.status !== 'merged' && (
            <div className="ok-banner">
              <Ico svg={I.check} />
              <span>
                {job.provider === 'GitLab' ? 'Merge request' : 'Pull request'}{' '}
                <a href={job.pr.url} target="_blank" rel="noopener noreferrer">
                  {job.provider === 'GitLab' ? '!' : '#'}
                  {job.pr.number} {job.pr.title}
                </a>{' '}
                {job.target
                  ? 'is updated with these changes.'
                  : `is open${job.pr.draft ? ' as a draft' : ''} and linked to this issue.`}
              </span>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

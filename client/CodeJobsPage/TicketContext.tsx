'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { type Any, api, toast } from '../core';
import { ErrorState, Spinner, Ico, I } from '../ui';

export const LIVE = ['starting', 'queued', 'running'];
export const REVIEW = ['review', 'report'];
export const TROUBLE = ['failed', 'cancelled', 'empty'];
export const LABEL: Record<string, string> = {
  starting: 'Starting',
  queued: 'Waiting',
  running: 'Working',
  review: 'Ready for review',
  report: 'Report ready',
  committed: 'Committed',
  pr: 'Pull request open',
  merged: 'Merged',
  empty: 'No changes',
  failed: 'Failed',
  cancelled: 'Stopped',
};
export type Filter = 'live' | 'review' | 'trouble' | 'all';
/**
 * The issue "Write code" opened this page for (TF-124, /code-jobs?project=…&ticket=…): its ID, the
 * coding prompt and the linked repository or spec. With no repository or spec only the ID and the
 * prompt show.
 */
export function TicketContext({ projectId, ticketId }: { projectId: string; ticketId: string }) {
  const [c, setC] = useState<Any>(null);
  const [error, setError] = useState<Any>(null);
  const load = () => {
    setError(null);
    api(
      `/api/projects/${encodeURIComponent(projectId)}/code-context?ticketId=${encodeURIComponent(ticketId)}`,
    )
      .then(setC)
      .catch(setError);
  };
  useEffect(load, [projectId, ticketId]);
  if (error)
    return (
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <ErrorState title="Couldn’t load the issue" error={error} onRetry={load}>
          <p>Open the issue again from its project.</p>
        </ErrorState>
      </div>
    );
  if (!c)
    return (
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <Spinner /> Loading the issue…
      </div>
    );
  return (
    <div className="card" style={{ padding: 16, marginBottom: 12 }} aria-label="Issue to code">
      <div className="job-l1">
        <code>{c.key || c.ticketId}</code>
        <span className="job-title">{c.title}</span>
      </div>
      {(c.repos.length > 0 || c.spec) && (
        <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {c.repos.map((r: Any) => (
            <li key={r.label}>
              {r.label}: <code>{r.name}</code>
            </li>
          ))}
          {c.spec && (
            <li>
              Coding spec: {c.spec.status === 'ready' ? 'ready for coding' : 'draft'}
              {c.spec.files.length ? (
                <>
                  {' '}
                  ·{' '}
                  {c.spec.files.map((f: Any) => (
                    <code key={f.path} style={{ marginRight: 6 }}>
                      {f.path}
                    </code>
                  ))}
                </>
              ) : null}
              {c.spec.modules.length ? ` · modules: ${c.spec.modules.join(', ')}` : ''}
            </li>
          )}
        </ul>
      )}
      <h4 style={{ margin: '12px 0 4px' }}>Prompt</h4>
      <pre
        className="small"
        style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', margin: 0 }}
      >
        {c.prompt}
      </pre>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {/* The issue's code panel in its project: start the agent, watch it, review the diff and open the pull request. */}
        <Link
          className="btn sm ai"
          href={`/p/${encodeURIComponent(projectId)}/backlog?issue=${encodeURIComponent(c.ticketId)}&code=${c.repos.length === 1 && c.repos[0].label === 'Backend' ? 'backend' : 'frontend'}`}
          title="Opens this issue’s code panel: start the AI agent, review its changes, then open the pull request"
        >
          <Ico svg={I.sparkle} />
          Start writing code
        </Link>
        <Link
          className="btn sm subtle"
          href={`/p/${encodeURIComponent(projectId)}/codejobs?coding=1`}
          title="The project’s Coding dialog: write code for one ticket or a whole feature"
        >
          Code a whole feature…
        </Link>
        <button
          className="btn sm subtle"
          onClick={() =>
            navigator.clipboard?.writeText(c.prompt).then(
              () => toast('Prompt copied.'),
              () => toast('Couldn’t copy the prompt.', 'err'),
            )
          }
        >
          Copy prompt
        </button>
      </div>
    </div>
  );
}

'use client';
// After a round: ask the agent for changes, or have read-only reviewers look at the changes.
import { useState } from 'react';
import type { Any } from '../../core';
import { Ico, I } from '../../ui';
import { TA } from '../../fields';
import type { CodeJobs } from './use-code-jobs';
import type { TabState } from './job-tabs';

export function AskForChanges({ cj }: { cj: CodeJobs }) {
  const [text, setText] = useState('');
  const send = async () => {
    if (await cj.act('follow', { action: 'follow', text })) setText('');
  };
  return (
    <div className="code-follow cj-compose">
      <TA
        rows={2}
        value={text}
        placeholder="Ask for changes: e.g. also handle the empty state, and rename the hook to usePayslips"
        onChange={(e) => setText(e.target.value)}
      />
      <button className="btn ai" disabled={!text.trim() || !!cj.busy} onClick={send}>
        <Ico svg={I.sparkle} />
        Make changes
      </button>
    </div>
  );
}

const enabled = (agents: Any[], id: string) => agents.some((a: Any) => a.id === id && a.enabled);

/** The review agent, the Review Panel, the UI/UX agent, custom reviewers and CodeRabbit. */
export function ReviewButtons({ cj, ui }: { cj: CodeJobs; ui: TabState }) {
  const { job, agents, roles, busy } = cj;
  const review = (extra: Any = {}) => cj.act('review', { action: 'review', ...extra });
  const reviewerName = agents.find((a: Any) => a.id === roles.review)?.name || 'the review agent';
  const crRunning = job.coderabbit?.status === 'running';
  const custom = agents.filter(
    (a: Any) => a.custom && !a.writes && a.enabled && a.id !== roles.review,
  );
  return (
    <div className="review-actions">
      {roles.review && (
        <button
          className="agent-btn hire sm"
          disabled={!!busy}
          onClick={() => review()}
          title={`Reviewed by ${reviewerName}`}
        >
          <Ico svg={I.eye} />
          {job.reviews?.length ? 'Review again' : 'Review changes'}
        </button>
      )}
      {roles.review && enabled(agents, 'review-panel') && (
        <button
          className="agent-btn hire sm"
          disabled={!!busy}
          onClick={() => {
            ui.setReviewTab(0);
            review({ panel: true });
          }}
          title="Three Review agents in parallel: correctness, security, tests & acceptance"
        >
          <Ico svg={I.people} />
          Review panel
        </button>
      )}
      {enabled(agents, 'ui-review') && (
        <button
          className="agent-btn hire sm"
          disabled={!!busy}
          onClick={() => review({ agent: 'ui-review' })}
          title="Usability, accessibility, states, copy and responsive layout"
        >
          <Ico svg={I.eye} />
          UI/UX review
        </button>
      )}
      {custom.map((a: Any) => (
        <button
          key={a.id}
          className="agent-btn hire sm"
          disabled={!!busy}
          onClick={() => review({ agent: a.id })}
          title={a.summary}
        >
          {a.icon} {a.name}
        </button>
      ))}
      <button
        className="agent-btn hire sm"
        disabled={!!busy || crRunning}
        onClick={() => {
          cj.act('coderabbit', { action: 'coderabbit' });
          ui.setTab('coderabbit');
        }}
        title="An independent review by the CodeRabbit CLI: findings by severity, with fix instructions"
      >
        <Ico svg={I.eye} />
        {crRunning ? 'CodeRabbit is reviewing…' : 'CodeRabbit review'}
      </button>
      <span className="muted small">Read-only reviewers. They never edit files.</span>
    </div>
  );
}

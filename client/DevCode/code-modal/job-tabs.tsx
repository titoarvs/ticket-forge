'use client';
// The job's tabs: Summary (or Report), Changes, Reviews, CodeRabbit and Activity.
import { useEffect, useRef } from 'react';
import type { Any } from '../../core';
import { Spinner, Ico, I } from '../../ui';
import { Markdown } from '../../GuideCard';
import { CodeRabbitPanel } from '../../CodeRabbit';
import { DiffReview } from '../../DiffReview';
import { Activity } from '../ApprovalBox';
import type { CodeJobs } from './use-code-jobs';
import { SummaryPanel } from './summary-panel';

type Tab = { id: string; label: string; n?: number };
export type TabState = {
  tab: string;
  setTab: (id: string) => void;
  reviewTab: number;
  setReviewTab: (i: number) => void;
};
type TabsProps = { t: Any; cj: CodeJobs; ui: TabState; isPrReview: boolean; onPost: () => void };

function tabsOf(job: Any, running: boolean): Tab[] {
  const cr = job.coderabbit;
  return [
    job.summary &&
      !running && { id: 'summary', label: job.status === 'report' ? 'Report' : 'Summary' },
    job.files?.length > 0 && { id: 'changes', label: 'Changes', n: job.files.length },
    job.reviews?.length > 0 && { id: 'reviews', label: 'Reviews', n: job.reviews.length },
    cr && {
      id: 'coderabbit',
      label: 'CodeRabbit',
      n: cr.status === 'running' ? undefined : (cr.findings || []).length,
    },
    {
      id: 'activity',
      label: running ? 'Live activity' : 'Activity',
      n: job.log.filter((l: Any) => l.kind === 'tool').length,
    },
  ].filter(Boolean) as Tab[];
}

/** The chosen tab; otherwise live activity while running, else the diff (TF-123) or the first tab. */
function currentTab(tabs: Tab[], chosen: string, running: boolean) {
  if (tabs.some((x) => x.id === chosen)) return chosen;
  if (running) return 'activity';
  return tabs.find((x) => x.id === 'changes')?.id || tabs[0].id;
}

/** The latest review; a Review Panel shows one lens (correctness, security, tests) at a time. */
function ReviewsPanel({ cj, ui }: { cj: CodeJobs; ui: TabState }) {
  const { job, busy } = cj;
  const rv = job.reviews[job.reviews.length - 1];
  const lens = rv.lenses?.[Math.min(ui.reviewTab, rv.lenses.length - 1)];
  const fix = () =>
    cj.act('follow', {
      action: 'follow',
      text: `Fix these review findings (skip any you disagree with and say why):\n\n${rv.text}`,
    });
  return (
    <>
      <div className="cj-toolbar">
        <b className="small">
          {rv.panel ? 'Review Panel' : rv.agent || 'Review agent'} · round {rv.round}
        </b>
        <span className="spacer" />
        {job.status === 'review' && (
          <button className="btn sm ai" disabled={!!busy} onClick={fix}>
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
              aria-selected={ui.reviewTab === i}
              className={ui.reviewTab === i ? 'on' : ''}
              onClick={() => ui.setReviewTab(i)}
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
}

/** The agent's plan (its to-do list) and what it did. */
function ActivityPanel({ job, running }: { job: Any; running: boolean }) {
  const todos = job.todos || [];
  return (
    <>
      {todos.length > 0 && (
        <div className="cj-plan">
          <div className="small">
            <b>Plan</b>{' '}
            <span className="muted">
              {todos.filter((x: Any) => x.status === 'completed').length} of {todos.length} done
            </span>
          </div>
          <ul>
            {todos.map((x: Any, i: number) => (
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
  );
}

export function JobTabs({ t, cj, ui, isPrReview, onPost }: TabsProps) {
  const { job, running, busy } = cj;
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: 1e9 });
  }, [job?.log?.length]);
  const tabs = tabsOf(job, running);
  const cur = currentTab(tabs, ui.tab, running);
  const runCodeRabbit = () => {
    cj.act('coderabbit', { action: 'coderabbit' });
    ui.setTab('coderabbit');
  };
  return (
    <div className="cj-box">
      <div className="cj-tabs" role="tablist">
        {tabs.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={cur === x.id}
            className={cur === x.id ? 'on' : ''}
            onClick={() => ui.setTab(x.id)}
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
        {cur === 'summary' && <SummaryPanel cj={cj} isPrReview={isPrReview} onPost={onPost} />}
        {cur === 'changes' && <DiffReview job={job} />}
        {cur === 'reviews' && <ReviewsPanel cj={cj} ui={ui} />}
        {cur === 'coderabbit' && (
          <CodeRabbitPanel
            t={t}
            job={job}
            busy={busy}
            run={runCodeRabbit}
            follow={(text) => cj.act('follow', { action: 'follow', text })}
          />
        )}
        {cur === 'activity' && <ActivityPanel job={job} running={running} />}
      </div>
    </div>
  );
}

'use client';
// Opening a pull request for the changes, or pushing them to the one the job was started for.
import { useState } from 'react';
import { type Any, can } from '../../core';
import { Spinner, Ico, I } from '../../ui';
import { TA, TF, CB } from '../../fields';
import { dev } from '../dev';
import {
  type PrContext,
  commitLocal,
  draftPr,
  pushUpdate,
  openPr,
  prMark,
  prNoun,
} from './pr-actions';

/** The title (or commit message), description and draft switch, shared by both forms. */
export function usePrForm(t: Any) {
  const [title, setTitle] = useState(`${t.key}: ${t.title}`);
  const [prBody, setPrBody] = useState('');
  const [draft, setDraft] = useState(dev().draft !== false);
  return { title, setTitle, prBody, setPrBody, draft, setDraft };
}
export type PrForm = ReturnType<typeof usePrForm>;

/** Busy: a spinner and `busyText`; otherwise the icon and label. */
function BusyLabel({
  busy,
  busyText,
  children,
}: {
  busy: boolean;
  busyText: string;
  children: React.ReactNode;
}) {
  if (busy)
    return (
      <>
        <Spinner />
        {busyText}
      </>
    );
  return <>{children}</>;
}

export function UpdatePrBox({ ctx }: { ctx: PrContext }) {
  const { cj, form } = ctx;
  const { job, busy } = cj;
  const { provider, number, url, title } = job.target;
  return (
    <div className="code-pr pr-compose">
      <div className="pr-compose-h">
        <Ico svg={I.pr} />
        <b>
          Update {provider === 'GitLab' ? `merge request !${number}` : `pull request #${number}`}
        </b>
        <a className="muted small" href={url} target="_blank" rel="noopener noreferrer">
          {title}
        </a>
      </div>
      <label className="field" style={{ margin: 0 }}>
        <span>Commit message</span>
        <TF value={form.title} onChange={(e) => form.setTitle(e.target.value)} />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn primary"
          disabled={!!busy || !form.title.trim()}
          onClick={() => pushUpdate(ctx)}
        >
          <BusyLabel busy={busy === 'push'} busyText="Pushing…">
            <Ico svg={I.pr} />
            Commit and push to {prMark(provider)}
            {number}
          </BusyLabel>
        </button>
        <span className="muted small">
          Pushes to <code>{job.branch}</code>; the {prNoun(provider)} updates itself, and a comment
          says what changed.
        </span>
      </div>
    </div>
  );
}

function NewPrHead({ ctx }: { ctx: PrContext }) {
  const { cj, form } = ctx;
  const { job, busy } = cj;
  return (
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
          onClick={() => draftPr(ctx)}
        >
          <BusyLabel busy={busy === 'draft'} busyText="Writing…">
            <Ico svg={I.sparkle} />
            {form.prBody ? 'Rewrite with AI' : 'Write title & description with AI'}
          </BusyLabel>
        </button>
      )}
    </div>
  );
}

/** How the pull request is opened: by the job on GitHub, or from here with your own git setup. */
function HowItOpens({ job }: { job: Any }) {
  if (job.remote) return <>Opens the pull request for the branch the job pushed to GitHub.</>;
  return (
    <>
      Commits with your git name and email, pushes <code>{job.branch}</code> to the repository’s{' '}
      <code>origin</code> with your own git setup (SSH key or credential helper; the project’s token
      only if that’s refused), then opens the {prNoun(job.provider)}.
    </>
  );
}

export function NewPrBox({ ctx }: { ctx: PrContext }) {
  const { cj, form } = ctx;
  const { job, busy } = cj;
  const blocked = !!busy || !form.title.trim();
  return (
    <div className="code-pr pr-compose">
      <NewPrHead ctx={ctx} />
      <label className="field" style={{ margin: 0 }}>
        <span>Title</span>
        <TF value={form.title} onChange={(e) => form.setTitle(e.target.value)} />
      </label>
      <label className="field" style={{ margin: 0 }}>
        <span>Description (Markdown)</span>
        <TA
          rows={form.prBody ? 10 : 3}
          value={form.prBody}
          placeholder="Leave empty for the standard description (story, acceptance criteria, the agent’s summary), or write it with AI: Summary, Changes, How to test, Acceptance criteria."
          onChange={(e) => form.setPrBody(e.target.value)}
        />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <CB
          label="Draft"
          checked={form.draft}
          onChange={(e: Any) => form.setDraft(e.target.checked)}
        />
        <span className="spacer" />
        {!job.remote && (
          <button
            className="btn subtle"
            disabled={blocked}
            onClick={() => commitLocal(ctx)}
            title="Commit on the local branch without pushing"
          >
            {busy === 'commit' ? <Spinner /> : 'Commit locally only'}
          </button>
        )}
        <button className="btn primary" disabled={blocked} onClick={() => openPr(ctx)}>
          <BusyLabel busy={busy === 'pr'} busyText="Opening…">
            <Ico svg={I.pr} />
            {job.remote ? (
              'Open pull request'
            ) : (
              <>Commit, push and open {job.provider === 'GitLab' ? 'MR' : 'PR'}</>
            )}
          </BusyLabel>
        </button>
      </div>
      <div className="muted small">
        <HowItOpens job={job} />
      </div>
    </div>
  );
}

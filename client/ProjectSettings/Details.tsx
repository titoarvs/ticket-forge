'use client';
import Link from 'next/link';
import { P, type Any, mutate, hashColor, COLORS, S, ago } from '../core';
import { SetCard, Ico, I } from '../ui';
import { TF, TA } from '../fields';
import { CommitInput } from '../views';
import { ListEditor } from '../ListEditor';
import { allSources } from '../Sources';

export const SECTIONS: [string, string, string, string][] = [
  ['details', 'Details', 'settings', 'Name, key and what the project is about'],
  ['people', 'People', 'people', 'Who can be assigned issues'],
  ['workflow', 'Workflow', 'board', 'Statuses, board columns and transitions'],
  [
    'templates',
    'Templates',
    'doc',
    'Problem Statement, Feature Brief and Architecture Record Design',
  ],
  ['context', 'App context', 'sparkle', 'What the AI knows about this app, reused in every prompt'],
  ['code', 'Code & GitHub', 'pr', 'Repository, coding agent and pull requests'],
  ['database', 'Database', 'database', 'The databases of the app this project builds'],
  ['danger', 'Danger zone', 'trash', 'Delete the project'],
];
export function Details({ ed }: { ed: boolean }) {
  const p = P();
  const set = (k: string, v: Any) =>
    mutate(
      (pp) => {
        pp[k] = v;
      },
      { tag: `p.${k}` },
    );
  const rekey = (key: string) =>
    mutate((pp) => {
      const old = pp.key;
      pp.key = key;
      for (const x of [...pp.tickets, ...pp.epics])
        if (x.key?.startsWith(`${old}-`)) x.key = `${key}-${x.key.slice(old.length + 1)}`;
    });
  const issues = p.tickets.length,
    tests = p.tickets.reduce((n: number, t: Any) => n + t.testCases.length, 0);
  const docs = allSources(p).length;
  const stat = (n: number, label: string, href?: string) => {
    const body = (
      <>
        <b>{n.toLocaleString()}</b>
        <span>{label}</span>
      </>
    );
    return href ? (
      <Link className="set-stat" href={`/p/${p.id}/${href}`}>
        {body}
      </Link>
    ) : (
      <div className="set-stat">{body}</div>
    );
  };
  return (
    <>
      <SetCard
        id="project"
        title="Project"
        desc="How the project appears in the project list and in issue keys."
      >
        <div className="set-identity">
          <span
            className="proj-avatar lg"
            style={{ background: hashColor(p.key, COLORS) }}
            aria-hidden
          >
            {p.key.slice(0, 2)}
          </span>
          <div className="set-fields">
            <label className="field">
              <span>Name</span>
              <TF disabled={!ed} value={p.name} onChange={(e) => set('name', e.target.value)} />
            </label>
            <label className="field">
              <span>Key</span>
              <CommitInput
                disabled={!ed}
                value={p.key}
                aria-describedby="key-help"
                onCommit={(v) => {
                  const k = v.replace(/[^a-z0-9]/gi, '').toUpperCase();
                  if (k) rekey(k);
                }}
              />
              <small id="key-help" className="muted">
                Issues are numbered like <b>{p.key}-12</b>. Changing the key renames every issue and
                epic key.
              </small>
            </label>
          </div>
        </div>
      </SetCard>

      <SetCard
        id="description"
        title="Project description"
        desc="What this project is, in your own words. Shown on the Summary page and given to the AI as context."
      >
        <TA
          disabled={!ed}
          value={p.description || ''}
          rows={4}
          placeholder="e.g. Tito Payroll: automated payroll for Tito Solutions PH, built on T201 and Tito Clock."
          onChange={(e) => set('description', e.target.value)}
        />
        {!p.description && p.summary && ed && (
          <p className="muted small set-note">
            No description yet.{' '}
            <button className="link-btn" onClick={() => set('description', p.summary)}>
              Start from the initial feature’s summary
            </button>{' '}
            and edit it.
          </p>
        )}
      </SetCard>

      <SetCard
        id="initial"
        title={
          p.sourceName ? (
            <>
              Initial feature <span className="muted set-doc-name">· {p.sourceName}</span>
            </>
          ) : (
            'Assumptions and open questions'
          )
        }
        desc={
          p.sourceName
            ? 'What the AI read from the document this project was created from. Other documents keep their own on the Source documents page.'
            : 'Things the team assumes, and questions to raise with stakeholders.'
        }
        right={
          p.sourceText ? (
            <Link
              className="btn sm"
              href={`/p/${p.id}/source`}
              onClick={() => {
                S.sourceDoc = 'original';
              }}
            >
              <Ico svg={I.doc} />
              Open document
            </Link>
          ) : null
        }
      >
        {p.sourceName && (
          <label className="field">
            <span>Summary of the document</span>
            <TA
              disabled={!ed}
              value={p.summary || ''}
              rows={4}
              onChange={(e) => set('summary', e.target.value)}
            />
          </label>
        )}
        <div className="set-lists">
          <div>
            <h4 className="set-sub">
              Assumptions <span className="count">{(p.assumptions || []).length}</span>
            </h4>
            <ListEditor
              items={p.assumptions || []}
              disabled={!ed}
              noun="assumption"
              empty="No assumptions."
              onChange={(v) => set('assumptions', v)}
            />
          </div>
          <div>
            <h4 className="set-sub">
              Open questions <span className="count">{(p.openQuestions || []).length}</span>
            </h4>
            <ListEditor
              items={p.openQuestions || []}
              disabled={!ed}
              noun="question"
              empty="No open questions."
              onChange={(v) => set('openQuestions', v)}
            />
          </div>
        </div>
      </SetCard>

      {(p.sources || []).length > 0 && (
        <SetCard
          id="more-docs"
          title="Other documents"
          desc="Features and documents added later. Each keeps its own summary and open questions."
          right={
            <Link className="btn sm" href={`/p/${p.id}/source`}>
              Source documents
            </Link>
          }
        >
          <ul className="set-docs">
            {p.sources.map((d: Any) => (
              <li key={d.id}>
                <Link
                  href={`/p/${p.id}/source`}
                  onClick={() => {
                    S.sourceDoc = d.id;
                  }}
                >
                  <Ico svg={I.doc} />
                  <b>{d.name}</b>
                </Link>
                <span className="muted small">
                  {(d.issueIds || []).length} issues · {(d.openQuestions || []).length} open
                  questions
                  {d.addedAt ? ` · added ${ago(d.addedAt)}` : ''}
                </span>
                {d.summary && <p className="small">{d.summary}</p>}
              </li>
            ))}
          </ul>
        </SetCard>
      )}

      <SetCard
        id="glance"
        title="At a glance"
        desc={
          p.createdAt ? (
            <>
              Created {ago(p.createdAt)}
              {p.updatedAt ? <> · last changed {ago(p.updatedAt)}</> : null}
            </>
          ) : undefined
        }
      >
        <div className="set-stats">
          {stat(issues, issues === 1 ? 'issue' : 'issues', 'backlog')}
          {stat(p.epics.length, p.epics.length === 1 ? 'epic' : 'epics', 'epics')}
          {stat(p.sprints.length, p.sprints.length === 1 ? 'sprint' : 'sprints', 'backlog')}
          {stat(tests, tests === 1 ? 'test case' : 'test cases', 'tests')}
          {stat(docs, docs === 1 ? 'source document' : 'source documents', 'source')}
          {stat(p.workflow.length, 'statuses')}
        </div>
      </SetCard>
    </>
  );
}

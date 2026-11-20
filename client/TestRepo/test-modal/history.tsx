'use client';
// A saved test's history: the executions it ran in, and its reviews and earlier versions.
import { useState } from 'react';
import { type Any, P, uid, toast, ago } from '../../core';
import { repo } from '../run-status';
import { WF_CLS, RunLoz } from '../TestManagement';
import type { Draft } from './draft';

const REVIEW_DID: Record<string, string> = {
  submit: 'submitted it for review',
  approve: 'approved',
  changes: 'requested changes',
  deprecate: 'deprecated it',
  restore: 'restored it',
};
const newestFirst = (a: Any, b: Any) => String(b.at).localeCompare(String(a.at));

function RunEntry({ e, testId }: { e: Any; testId: string }) {
  const run = e.runs[testId];
  return (
    <li>
      <RunLoz s={run.status} /> <b>{e.key}</b> {e.title}
      <span className="muted">
        {' '}
        · {run.by || '—'}
        {run.at ? ` · ${new Date(run.at).toLocaleString()}` : ''}
      </span>
      {run.comment && <div className="muted">“{run.comment}”</div>}
    </li>
  );
}

/** The executions this test is in, newest first, with its result in each. */
export function ExecutionHistory({ test }: { test: Any }) {
  const runs = repo(P())
    .executions.filter((e: Any) => e.runs?.[test.id])
    .sort((a: Any, b: Any) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return (
    <>
      <h4 className="sync-h">Execution history</h4>
      {runs.length ? (
        <ul className="xr-history small">
          {runs.map((e: Any) => (
            <RunEntry key={e.id} e={e} testId={test.id} />
          ))}
        </ul>
      ) : (
        <p className="muted small">Not in any execution yet.</p>
      )}
    </>
  );
}

function ReviewEntry({ x }: { x: Any }) {
  return (
    <li>
      <span className={`wf-loz ${WF_CLS[x.to]}`}>{x.to}</span> <b>{x.by}</b> {REVIEW_DID[x.action]}{' '}
      (v{x.version}) <span className="muted">· {ago(x.at)}</span>
      {x.comment && <div className="muted">“{x.comment}”</div>}
    </li>
  );
}

/** An earlier version's content, and loading it back into the editor. */
function VersionContent({ x, draft, ed }: { x: Any; draft: Draft; ed: boolean }) {
  const restore = () => {
    draft.setD({
      ...draft.d,
      title: x.title,
      type: x.type,
      preconditions: x.preconditions,
      steps: (x.steps || []).map((s: Any) => ({ ...s, id: uid() })),
      gherkin: x.gherkin,
    });
    toast(`Version ${x.version} loaded into the editor: save to make it the current version.`);
  };
  return (
    <div className="wf-version">
      <b>{x.title}</b>
      {x.preconditions && <div className="muted">Preconditions: {x.preconditions}</div>}
      {x.gherkin ? (
        <pre>{x.gherkin}</pre>
      ) : (
        <ol>
          {(x.steps || []).map((s: Any, k: number) => (
            <li key={k}>
              {s.action}
              {s.data ? ` [${s.data}]` : ''}
              {s.expected ? <span className="muted"> → {s.expected}</span> : ''}
            </li>
          ))}
        </ol>
      )}
      {ed && (
        <button className="btn sm subtle" onClick={restore}>
          Restore this version
        </button>
      )}
    </div>
  );
}

type VersionProps = { x: Any; draft: Draft; ed: boolean; open: boolean; toggle: () => void };

function VersionEntry({ x, draft, ed, open, toggle }: VersionProps) {
  return (
    <li>
      <b>Version {x.version}</b>{' '}
      <span className="muted">
        · {x.status} · {x.by || '—'} · {ago(x.at)}
      </span>{' '}
      <button className="link-btn small" onClick={toggle}>
        {open ? 'Hide' : 'View'}
      </button>
      {open && <VersionContent x={x} draft={draft} ed={ed} />}
    </li>
  );
}

/** Reviews and earlier versions, newest first; one version's content can be shown at a time. */
export function ReviewHistory({ live, draft, ed }: { live: Any; draft: Draft; ed: boolean }) {
  const [shown, setShown] = useState<number | null>(null);
  const reviews = live.reviews || [];
  const versions = live.versions || [];
  if (!reviews.length && !versions.length) return null;
  const entries = [
    ...reviews.map((x: Any) => ({ ...x, kind: 'review' })),
    ...versions.map((x: Any) => ({ ...x, kind: 'version' })),
  ].sort(newestFirst);
  return (
    <>
      <h4 className="sync-h">Review and version history</h4>
      <ul className="xr-history small">
        {entries.map((x: Any, i: number) =>
          x.kind === 'review' ? (
            <ReviewEntry key={`r${i}`} x={x} />
          ) : (
            <VersionEntry
              key={`v${i}`}
              x={x}
              draft={draft}
              ed={ed}
              open={shown === x.version}
              toggle={() => setShown(shown === x.version ? null : x.version)}
            />
          ),
        )}
      </ul>
    </>
  );
}

'use client';
import { useState } from 'react';
import { type Any, P, toast, ago } from '../core';
import { approveSpecChange, acceptSpecChange, linkSpecChange } from '../api/specs';
import { Ico, I } from '../ui';
import { TF } from '../fields';
import { OverlapLine } from './open-specs';

/**
 * One ticket's spec: acceptance criteria, files and modules, the prompt, and the AI-produced
 * changes linked to it.
 */
export function SpecRow({
  s,
  canEdit,
  isReviewer,
  busy,
  onReady,
  reload,
}: {
  s: Any;
  canEdit: boolean;
  isReviewer: boolean;
  busy: boolean;
  onReady: () => void;
  reload: () => Promise<void>;
}) {
  const pid = P()?.id;
  const [ref, setRef] = useState('');
  const [summary, setSummary] = useState('');
  const act = async (fn: () => Promise<Any>, okMsg: string) => {
    try {
      await fn();
      toast(okMsg);
    } catch (e: Any) {
      toast(e.message, 'err');
    }
    await reload();
  };
  return (
    <li className="ver-row" style={{ display: 'block' }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <div>
          <span className="key">{s.key}</span> <b style={{ fontWeight: 500 }}>{s.title}</b>{' '}
          <span className="label-chip">{s.status === 'ready' ? 'Ready for coding' : 'Draft'}</span>
          {s.overlaps.length > 0 && (
            <span className="label-chip" style={{ color: 'var(--danger)' }}>
              {s.overlaps.length} overlap{s.overlaps.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {canEdit && s.status !== 'ready' && (
          <button className="btn sm" disabled={busy} onClick={onReady}>
            Mark ready
          </button>
        )}
      </div>
      {s.status === 'ready' && s.readyAt && (
        <div className="muted small">
          Marked ready by {s.readyBy || 'Unknown'} {ago(s.readyAt)}
        </div>
      )}
      <details>
        <summary className="small">Open the spec</summary>
        <h4>Acceptance criteria</h4>
        {s.criteria.length ? (
          <ol>
            {s.criteria.map((c: string, i: number) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        ) : (
          <p className="muted small">None written yet.</p>
        )}
        <h4>Files and modules it is expected to touch</h4>
        {s.files.length || s.modules.length ? (
          <ul>
            {s.files.map((f: Any) => (
              <li key={f.path}>
                <code>{f.path}</code>{' '}
                <span className="muted small">
                  ({f.action === 'create' ? 'new' : 'change'}){f.why ? ` · ${f.why}` : ''}
                </span>
              </li>
            ))}
            {s.modules.map((m: string) => (
              <li key={`m:${m}`}>
                Module <code>{m}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No files were predicted.</p>
        )}
        {s.overlaps.length > 0 && (
          <div className="warn-banner danger">
            <Ico svg={I.warn} />
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {s.overlaps.map((o: Any) => (
                <OverlapLine key={`${o.kind}:${o.target}`} o={o} />
              ))}
            </ul>
          </div>
        )}
        <h4>Coding prompt</h4>
        <pre className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }}>
          {s.prompt}
        </pre>
        <button
          className="btn sm subtle"
          onClick={() =>
            navigator.clipboard?.writeText(s.prompt).then(
              () => toast('Prompt copied.'),
              () => toast('Couldn’t copy the prompt.', 'err'),
            )
          }
        >
          Copy prompt
        </button>
        <h4>AI-produced changes</h4>
        {s.changes.map((c: Any) => {
          const approved = c.approvals.length > 0;
          return (
            <div key={c.id} className="row" style={{ gap: 8 }}>
              <code>{c.ref}</code>
              {c.summary && <span className="muted small">{c.summary}</span>}
              <span className="label-chip">
                {c.status === 'accepted'
                  ? 'Accepted'
                  : approved
                    ? `Approved by ${c.approvals.map((a: Any) => a.name).join(', ')}`
                    : 'Waiting for a required reviewer'}
              </span>
              {c.status !== 'accepted' && isReviewer && (
                <button
                  className="btn sm subtle"
                  onClick={() => act(() => approveSpecChange(pid, c.id), 'Approved.')}
                >
                  Approve as reviewer
                </button>
              )}
              {c.status !== 'accepted' && canEdit && (
                <button
                  className="btn sm"
                  onClick={() => act(() => acceptSpecChange(pid, c.id), 'Changes accepted.')}
                >
                  Accept changes
                </button>
              )}
            </div>
          );
        })}
        {!s.changes.length && <p className="muted small">None linked yet.</p>}
        {canEdit && s.status === 'ready' && (
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <TF
              size="small"
              label="Branch, pull request or commit"
              value={ref}
              onChange={(e: Any) => setRef(e.target.value)}
            />
            <TF
              size="small"
              label="Summary (optional)"
              value={summary}
              onChange={(e: Any) => setSummary(e.target.value)}
            />
            <button
              className="btn sm"
              disabled={!ref.trim()}
              onClick={() =>
                act(async () => {
                  await linkSpecChange(pid, s.ticketId, ref, summary);
                  setRef('');
                  setSummary('');
                }, 'Changes linked.')
              }
            >
              Link changes
            </button>
          </div>
        )}
      </details>
    </li>
  );
}

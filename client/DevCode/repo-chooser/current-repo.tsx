'use client';
// The repository in use: its name and kind, Update (a clone) or Check (a folder), Change, and where
// it is with its branches.
import { ago } from '../../core';
import { Ico, I, Spinner } from '../../ui';
import { changeMode } from './repo-facts';
import type { Repo } from './use-repo';

const kindLabel = (isGh: boolean, isClone: boolean) =>
  isGh ? 'On GitHub' : isClone ? 'Cloned by TicketForge' : 'Local folder';

/** A clone is updated from where it came from; a folder is checked again. GitHub needs neither. */
function RefreshButton({ r }: { r: Repo }) {
  const { f, busy } = r;
  if (f.isGh) return null;
  const off = !f.local || !!busy;
  if (f.isClone)
    return (
      <button
        className="btn sm"
        disabled={off}
        onClick={() => r.clone(f.src.url, f.src.branch || '')}
      >
        {r.working ? <Spinner /> : <Ico svg={I.refresh} />}Update
      </button>
    );
  return (
    <button className="btn sm" disabled={off} onClick={() => r.inspect(f.lpath)}>
      {busy === 'check' ? <Spinner /> : null}Check
    </button>
  );
}

/** Branches and uncommitted changes, from the last check. */
function BranchInfo({
  status,
}: {
  status: { defaultBranch: string; currentBranch: string; uncommitted: number };
}) {
  const n = status.uncommitted;
  return (
    <span>
      default branch <code>{status.defaultBranch}</code> · on <code>{status.currentBranch}</code>
      {n ? ` · ${n} uncommitted change${n === 1 ? '' : 's'} (never touched)` : ''}
    </span>
  );
}

function Where({ r }: { r: Repo }) {
  const { f } = r;
  if (!f.isGh) return <code title={f.lpath}>{f.lpath}</code>;
  return (
    <span>
      Used through GitHub: code jobs use your AI provider and GitHub
      {f.d.baseBranch ? (
        <>
          {' '}
          · base branch <code>{f.d.baseBranch}</code>
        </>
      ) : null}
    </span>
  );
}

export function CurrentRepo({ r }: { r: Repo }) {
  const { f, status } = r;
  const change = () => {
    r.setErr('');
    r.setMode(changeMode(f));
  };
  return (
    <div className="rc-current">
      <div className="rc-top">
        <span className="rc-icon">
          <Ico svg={f.isClone || f.isGh ? I.pr : I.folder} />
        </span>
        <div className="rc-name">
          <b>{f.name}</b>
          <span className="rc-badges">
            <span className="ag-chip tiny">{kindLabel(f.isGh, f.isClone)}</span>
            {f.d.provider && <span className="ag-chip tiny">{f.d.provider}</span>}
          </span>
        </div>
        <span className="spacer" />
        {r.allowed && (
          <>
            <RefreshButton r={r} />
            <button className="btn sm subtle" disabled={!!r.busy} onClick={change}>
              Change
            </button>
          </>
        )}
      </div>
      <div className="rc-meta small muted">
        <Where r={r} />
        {status?.ok && <BranchInfo status={status} />}
        {f.isClone && f.src?.clonedAt && <span>updated {ago(f.src.clonedAt)}</span>}
      </div>
      {status && !status.ok && (
        <div className="warn-banner danger" style={{ marginTop: 8 }}>
          <Ico svg={I.warn} />
          <span>{status.error}</span>
        </div>
      )}
    </div>
  );
}

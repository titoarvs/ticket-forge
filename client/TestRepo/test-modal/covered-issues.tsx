'use client';
// The issues the test covers, and linking or unlinking one.
import { useState } from 'react';
import { type Any, P, isSub } from '../../core';
import { Ico, I, TypeIcon } from '../../ui';
import { SF, MenuItem } from '../../fields';
import { openDrawer } from '../../actions';
import type { Draft } from './draft';

function IssueChip({ x, ed, onUnlink }: { x: Any; ed: boolean; onUnlink: () => void }) {
  return (
    <span className="xr-issue">
      <TypeIcon type={x.type} />
      <button className="link-btn" onClick={() => openDrawer('issue', x.id)}>
        {x.key}
      </button>{' '}
      {x.title.slice(0, 40)}
      {ed && (
        <button className="icon-btn" aria-label={`Unlink ${x.key}`} onClick={onUnlink}>
          <Ico svg={I.close} />
        </button>
      )}
    </span>
  );
}

/** Issues (not sub-tasks) that aren't linked yet. */
function LinkIssue({ draft }: { draft: Draft }) {
  const { d, set } = draft;
  const [value, setValue] = useState('');
  const pick = (id: string) => {
    if (id) set('issueIds', [...new Set([...(d.issueIds || []), id])]);
    setValue('');
  };
  return (
    <SF filter value={value} onChange={(e) => pick(e.target.value)} aria-label="Link an issue">
      <MenuItem value="">+ Link an issue</MenuItem>
      {P()
        .tickets.filter((x: Any) => !isSub(x) && !d.issueIds?.includes(x.id))
        .map((x: Any) => (
          <MenuItem key={x.id} value={x.id}>
            {x.key} {x.title.slice(0, 60)}
          </MenuItem>
        ))}
    </SF>
  );
}

export function CoveredIssues({ draft, ed }: { draft: Draft; ed: boolean }) {
  const { d, set } = draft;
  const tickets = P().tickets;
  const issues = (d.issueIds || [])
    .map((id: string) => tickets.find((x: Any) => x.id === id))
    .filter(Boolean);
  const unlink = (id: string) =>
    set(
      'issueIds',
      d.issueIds.filter((x: string) => x !== id),
    );
  return (
    <>
      <h4 className="sync-h">Covers these issues</h4>
      <div className="row" style={{ gap: 6 }}>
        {issues.map((x: Any) => (
          <IssueChip key={x.id} x={x} ed={ed} onUnlink={() => unlink(x.id)} />
        ))}
        {!issues.length && <span className="muted small">Not linked to any issue yet.</span>}
        {ed && <LinkIssue draft={draft} />}
      </div>
    </>
  );
}

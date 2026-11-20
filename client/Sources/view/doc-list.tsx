'use client';
// The list of source documents on the left.
import { type Any, ago } from '../../core';
import { Ico, I } from '../../ui';
import { words, KIND } from '../all-sources';

/** "Created 3 days ago by Ana" (the original document) or "Added …". */
export function AddedLine({ d }: { d: Any }) {
  if (!d.addedAt) return null;
  return (
    <>
      {d.kind === 'original' ? 'Created' : 'Added'} {ago(d.addedAt)}
      {d.addedBy ? ` by ${d.addedBy}` : ''}
    </>
  );
}

function DocItem({ d, on, onSelect }: { d: Any; on: boolean; onSelect: () => void }) {
  const issues = (d.issueIds || []).length;
  return (
    <button className={`src-item ${on ? 'on' : ''}`} aria-current={on} onClick={onSelect}>
      <Ico svg={I.doc} />
      <span className="src-item-t">
        <b title={d.name}>{d.name}</b>
        <span className="muted small">
          {KIND[d.kind]?.[0]} · {words(d.text).toLocaleString()} words
          {issues ? ` · ${issues} issues` : ''}
        </span>
        {d.addedAt && (
          <span className="muted small">
            <AddedLine d={d} />
          </span>
        )}
      </span>
    </button>
  );
}

type ListProps = { docs: Any[]; selId: string; onSelect: (id: string) => void };

export function DocList({ docs, selId, onSelect }: ListProps) {
  return (
    <nav className="src-list" aria-label="Documents">
      <div className="muted small src-list-h">
        {docs.length} document{docs.length === 1 ? '' : 's'}
      </div>
      {docs.map((d) => (
        <DocItem key={d.id} d={d} on={d.id === selId} onSelect={() => onSelect(d.id)} />
      ))}
    </nav>
  );
}

'use client';
// The "Pages" tab: new pages to add to App setup, pages no longer in the code, and what changed.
import type { Any } from '../../core';
import { KEY } from './keys';
import { Item, type Picks } from './parts';

/** Up to n items, then "…". */
const some = (list: string[], n: number) =>
  list.slice(0, n).join(', ') + (list.length > n ? '…' : '');

function PageLine({ pg }: { pg: Any }) {
  return (
    <div>
      <b>{pg.name}</b> <code className="small">{pg.path}</code>
    </div>
  );
}

function Changed({ r, changedPages }: { r: Any; changedPages: Any[] }) {
  const n = changedPages.length;
  return (
    <>
      <h4 className="sync-h">
        Changed since {r.repo.baseNote.replace(/^since /, '')}: {n} page{n === 1 ? '' : 's'}
      </h4>
      <ul className="sync-changed small">
        {changedPages.map((pg: Any) => (
          <li key={pg.path}>
            <code>{pg.path}</code>{' '}
            <span className="muted">
              {pg.changedFiles.length} file{pg.changedFiles.length > 1 ? 's' : ''}:{' '}
              {some(pg.changedFiles, 4)}
            </span>
          </li>
        ))}
        {!n && <li className="muted">None.</li>}
      </ul>
      {r.repo.sharedChanged?.length > 0 && (
        <p className="muted small">
          Shared files changed too (used by most pages, so not pinned on one):{' '}
          {some(r.repo.sharedChanged, 6)}
        </p>
      )}
    </>
  );
}

type PaneProps = { r: Any; ps: Picks; newPages: Any[]; gone: Any[]; changedPages: Any[] };

export function PagesPane({ r, ps, newPages, gone, changedPages }: PaneProps) {
  return (
    <div className="sync-pane">
      {newPages.length > 0 && (
        <h4 className="sync-h">
          Add {ps.n('page:')} new page{newPages.length > 1 ? 's' : ''} to App setup
        </h4>
      )}
      {newPages.map((pg: Any) => (
        <Item key={pg.path} ps={ps} k={KEY.page(pg)}>
          <PageLine pg={pg} />
          <div className="muted small">{pg.file}</div>
        </Item>
      ))}
      {gone.length > 0 && <h4 className="sync-h">No longer in the code (tick to remove)</h4>}
      {gone.map((pg: Any) => (
        <Item key={pg.id} ps={ps} k={KEY.gone(pg)}>
          <PageLine pg={pg} />
        </Item>
      ))}
      <Changed r={r} changedPages={changedPages} />
    </div>
  );
}

'use client';
// One backlog group: its header and, unless folded, its rows (the first ROW_CAP, then "Show more")
// and the inline "create issue" row. Issues can be dragged into the group.
import { type Any, S, can, emit, saveUi } from '../../core';
import { zoneDnd } from '../row-dnd';
import { InlineCreate } from '../BulkBar';
import type { Group } from './groups';
import { rowData } from './row-data';
import { GroupRows } from './row';
import { GroupHeader } from './group-header';

/** Rows drawn per group at first; "Show more" draws the next ones (a backlog of thousands opens at once). */
const ROW_CAP = 200;
const MORE = 500;

/** How many rows of a group are drawn. */
export const capOf = (g: Group) => (S.rowCap ??= {})[g.id] || ROW_CAP;

function toggleGroup(id: string) {
  if (S.collapsed.has(id)) S.collapsed.delete(id);
  else S.collapsed.add(id);
  saveUi();
  emit();
}

function ShowMore({ g }: { g: Group }) {
  const hidden = g.items.length - capOf(g);
  return (
    <button
      className="show-more"
      onClick={() => {
        S.rowCap[g.id] = capOf(g) + MORE;
        emit();
      }}
    >
      Show {Math.min(MORE, hidden)} more <span className="muted">· {hidden} not shown</span>
    </button>
  );
}

function Rows({ g, page }: { g: Group; page: string }) {
  const rows = g.items
    .slice(0, capOf(g))
    .map((t: Any) => rowData(t, g.kind !== 'epic', false, page));
  return (
    <div className="rows">
      <GroupRows
        rows={rows}
        zoneKey={JSON.stringify({ group: g.id })}
        sig={`${page}\n${rows.map((r) => r.sig).join('\n')}`}
      />
      {g.items.length > capOf(g) && <ShowMore g={g} />}
    </div>
  );
}

function GroupBody({ g, page }: { g: Group; page: string }) {
  return (
    <>
      {g.items.length ? (
        <Rows g={g} page={page} />
      ) : (
        <div className="drop-hint">
          {g.sprint
            ? 'Plan this sprint by dragging issues here from the backlog.'
            : 'No issues. Drag issues here or create one.'}
        </div>
      )}
      {can('issue.create') && <InlineCreate group={g.id} />}
    </>
  );
}

/** page: pageSig() of this render (what every row depends on). */
export function GroupSection({ g, page }: { g: Group; page: string }) {
  const closed = S.collapsed.has(g.id);
  return (
    <div
      className={`section ${g.kind === 'sprint' && !g.sprint ? 'backlog-sec' : ''}`}
      data-drop-status={g.kind === 'status' ? g.title : undefined}
      {...zoneDnd({ group: g.id })}
    >
      <GroupHeader g={g} closed={closed} onToggle={() => toggleGroup(g.id)} />
      {g.sprint?.goal && !closed && <div className="sprint-goal">{g.sprint.goal}</div>}
      {!closed && <GroupBody g={g} page={page} />}
    </div>
  );
}

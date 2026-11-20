'use client';
// The quick views (Open, Assigned to me, Bugs…) with their counts, and the views saved in this
// browser.
import { type Any, isSub } from '../../core';
import { Ico, I } from '../../ui';
import { EMPTY, QUICK } from '../columns';
import type { IssuesNav } from './use-issues';

function SavedViews({ g }: { g: IssuesNav }) {
  if (!g.views.length) return null;
  return (
    <>
      <div className="iss-views-h">Saved views</div>
      {g.views.map((v) => (
        <div key={v.name} className="iss-saved">
          <button type="button" onClick={() => g.openView(v)}>
            {v.name}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Delete view ${v.name}`}
            title="Delete view"
            onClick={() => g.dropView(v.name)}
          >
            <Ico svg={I.close} />
          </button>
        </div>
      ))}
    </>
  );
}

export function ViewsSide({ g }: { g: IssuesNav }) {
  const { f, extra, p } = g;
  /** 'part': the view is chosen but more filters are on. */
  const cls = (key: string) => (f.quick !== key ? '' : extra ? 'on part' : 'on');
  return (
    <aside className="iss-views" aria-label="Views">
      {QUICK.map((v) => (
        <button
          key={v.key}
          type="button"
          className={cls(v.key)}
          onClick={() => g.set({ ...EMPTY, quick: v.key, subtasks: f.subtasks })}
        >
          <span>{v.label}</span>
          <span className="n">{p.tickets.filter((t: Any) => !isSub(t) && v.test(t)).length}</span>
        </button>
      ))}
      <SavedViews g={g} />
    </aside>
  );
}

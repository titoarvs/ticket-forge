'use client';
// The Epics view of the tree: each epic with tests (then "No epic"), opening to the issues those
// tests cover.
import type { Any } from '../../core';
import { Ico, I, TypeIcon } from '../../ui';
import { epicsOf, type Repo } from './use-repository';

function IssueRow({ g, x }: { g: Repo; x: Any }) {
  const n = g.r.tests.filter((t: Any) => t.issueIds?.includes(x.id)).length;
  return (
    <button
      className={`xr-folder xr-issuerow ${g.folder === `issue:${x.id}` ? 'on' : ''}`}
      title={`${x.key} ${x.title}`}
      onClick={() => g.setFolder(`issue:${x.id}`)}
    >
      <TypeIcon type={x.type} />
      <span>
        <b className="key">{x.key}</b> {x.title}
      </span>
      <span className="count">{n}</span>
    </button>
  );
}

function EpicRow({ g, e }: { g: Repo; e: Any }) {
  const { p, r, folder, open, setOpen } = g;
  const issues = p.tickets.filter(
    (x: Any) =>
      (e.id === 'none' ? !x.epicId : x.epicId === e.id) &&
      r.tests.some((t: Any) => t.issueIds?.includes(x.id)),
  );
  const isOpen = open[e.id] ?? folder === `epic:${e.id}`;
  return (
    <div>
      <div className="xr-epicrow">
        <button
          className="xr-caret"
          aria-label={isOpen ? 'Collapse' : 'Expand'}
          aria-expanded={isOpen}
          onClick={() => setOpen({ ...open, [e.id]: !isOpen })}
        >
          <Ico svg={I.chevron} className={isOpen ? '' : 'closed'} />
        </button>
        <button
          className={`xr-folder ${folder === `epic:${e.id}` ? 'on' : ''}`}
          title={e.label}
          onClick={() => {
            g.setFolder(`epic:${e.id}`);
            setOpen({ ...open, [e.id]: true });
          }}
        >
          {e.color ? (
            <span className="xr-swatch" style={{ background: e.color }} />
          ) : (
            <Ico svg={I.epic} />
          )}
          <span>{e.label}</span>
          <span className="count">{e.tests.length}</span>
        </button>
      </div>
      {isOpen && issues.map((x: Any) => <IssueRow key={x.id} g={g} x={x} />)}
    </div>
  );
}

export function EpicTree({ g }: { g: Repo }) {
  const { p, r } = g;
  const rows = [
    ...p.epics.map((e: Any) => ({ id: e.id, label: `${e.key} ${e.title}`, color: e.color })),
    { id: 'none', label: 'No epic', color: '' },
  ]
    .map((e: Any) => ({
      ...e,
      tests: r.tests.filter((t: Any) => (t.issueIds || []).length && epicsOf(p, t).has(e.id)),
    }))
    .filter((e: Any) => e.tests.length);
  return (
    <>
      {rows.map((e: Any) => (
        <EpicRow key={e.id} g={g} e={e} />
      ))}
    </>
  );
}

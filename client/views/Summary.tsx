'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  type Any,
  P,
  isSub,
  catOf,
  activeSprint,
  PRIORITIES,
  spSum,
  isDone,
  can,
  historyText,
  ago,
  S,
} from '../core';
import { Ico, I, EmptyState, PriorityIcon, Avatar, ELoz } from '../ui';
import { openCreateIssue, openDrawer } from '../actions';
import { ItemText } from '../ListEditor';
import { Header, epicProgress, ProgBar } from './row-dnd';
import { Overview } from './Overview';

export const daysLeft = (s: Any) => {
  if (!s?.endDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${s.endDate}T00:00:00`).getTime() - today.getTime()) / 86400000);
};
/** Assumptions / open questions, readable: codes as tags, the first few with "Show all". */
function ReadList({ l }: { l: string[] }) {
  const [all, setAll] = useState(false);
  if (!l?.length) return <p className="muted">None.</p>;
  const shown = all ? l : l.slice(0, 6);
  return (
    <>
      <ol className="li-list read">
        {shown.map((x, i) => (
          <li key={i}>
            <span className="li-n">{i + 1}</span>
            <div className="li-body">
              <ItemText s={x} />
            </div>
          </li>
        ))}
      </ol>
      {l.length > 6 && (
        <button className="btn sm subtle" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${l.length}`}
        </button>
      )}
    </>
  );
}
// ---------------------------------------------------------------- summary
function Stack({ parts, total }: { parts: [string, number, string][]; total: number }) {
  return (
    <>
      <div className="stack" role="img" aria-label={parts.map(([l, v]) => `${l}: ${v}`).join(', ')}>
        {parts
          .filter(([, v]) => v)
          .map(([l, v, c]) => (
            <i
              key={l}
              className={c}
              style={{ width: `${(v / total) * 100}%` }}
              title={`${l}: ${v} (${Math.round((v / total) * 100)}%)`}
            />
          ))}
      </div>
      <div className="legend">
        {parts.map(([l, v, c]) => (
          <span key={l}>
            <i className={c} />
            {l} <b>{v}</b>
          </span>
        ))}
      </div>
    </>
  );
}
export const Tile = ({
  icon,
  value,
  label,
  color,
}: {
  icon: string;
  value: ReactNode;
  label: ReactNode;
  color?: string;
}) => (
  <div className="tile">
    <span className="ic" style={{ color }}>
      <Ico svg={icon} />
    </span>
    <div>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  </div>
);
export function Summary() {
  const p = P();
  const ts = p.tickets.filter((t: Any) => !isSub(t));
  const n = ts.length || 1;
  const by = (k: string, v: string) => ts.filter((t: Any) => t[k] === v).length;
  const cat = (c: string) => ts.filter((t: Any) => catOf(t.status) === c).length;
  const done = cat('done');
  const tcs = p.tickets.flatMap((t: Any) => t.testCases);
  const tcBy = (s: string) => tcs.filter((x: Any) => x.status === s).length;
  const act = activeSprint();
  const maxP = Math.max(1, ...PRIORITIES.map((x) => by('priority', x)));
  const recent = p.tickets
    .flatMap((t: Any) => t.history.map((h: Any) => ({ ...h, t })))
    .sort((a: Any, b: Any) => b.at.localeCompare(a.at))
    .slice(0, 8);
  return (
    <>
      <Header title={p.name} sub={<span className="label-chip">{p.key}</span>} />
      <Overview />
      <div className="tiles">
        <Tile icon={I.backlog} value={ts.length} label={`issues in ${p.epics.length} epics`} />
        <Tile
          icon={I.check}
          value={
            <>
              {done} <span className="muted small">({Math.round((done / n) * 100)}%)</span>
            </>
          }
          label="issues done"
        />
        <Tile
          icon={I.calendar}
          value={act ? act.name : 'No active sprint'}
          label={
            act
              ? `${Math.max(0, daysLeft(act) ?? 0)} days left · ${act.goal || 'no goal'}`
              : `${p.sprints.length} sprints planned`
          }
        />
        <Tile
          icon={I.test}
          value={`${tcBy('Pass')} / ${tcs.length}`}
          label={`tests passing · ${tcs.filter((x: Any) => x.script).length} automated`}
        />
      </div>
      <div className="cards">
        <div className="card">
          <h3>Status overview</h3>
          <p className="sub">
            Issues by workflow category · {spSum(ts.filter(isDone))} of {spSum(ts)} story points
            done.
          </p>
          {ts.length ? (
            <Stack
              total={ts.length}
              parts={[
                ['To do', cat('todo'), 'c-todo'],
                ['In progress', cat('inprogress'), 'c-prog'],
                ['Done', done, 'c-done'],
              ]}
            />
          ) : (
            <EmptyState
              compact
              icon={I.backlog}
              tone="neutral"
              title="No issues yet"
              actions={
                can('issue.create') && (
                  <button className="btn" onClick={() => openCreateIssue()}>
                    <Ico svg={I.plus} />
                    Create issue
                  </button>
                )
              }
            />
          )}
        </div>
        <div className="card">
          <h3>Test results</h3>
          <p className="sub">Latest result of every test case (manual or automated).</p>
          {tcs.length ? (
            <Stack
              total={tcs.length}
              parts={[
                ['Not run', tcBy('Not run'), 'c-todo'],
                ['Pass', tcBy('Pass'), 'c-done'],
                ['Fail', tcBy('Fail'), 'c-fail'],
                ['Blocked', tcBy('Blocked'), 'c-blocked'],
              ]}
            />
          ) : (
            <p className="muted">No test cases yet.</p>
          )}
        </div>
        <div className="card">
          <h3>Priority breakdown</h3>
          <p className="sub">How many issues sit at each priority.</p>
          {PRIORITIES.map((x) => (
            <div key={x} className="barrow" title={`${x}: ${by('priority', x)}`}>
              <span className="lbl">
                <PriorityIcon p={x} />
                {x}
              </span>
              <div className="bar">
                <i style={{ width: `${(by('priority', x) / maxP) * 100}%` }} />
              </div>
              <span className="num">{by('priority', x)}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Recent activity</h3>
          <p className="sub">Latest changes across the project.</p>
          {recent.length ? (
            recent.map((h: Any) => (
              <div
                key={`${h.t.id}-${h.id}`}
                className="act-mini"
                onClick={() => openDrawer('issue', h.t.id)}
              >
                <Avatar name={h.author} size={20} />
                <span>
                  <b>{h.author}</b> {historyText(h)} <span className="key">{h.t.key}</span>{' '}
                  <span className="muted small">{ago(h.at)}</span>
                </span>
              </div>
            ))
          ) : (
            <EmptyState compact icon={I.history} tone="neutral" title="No activity yet">
              <p>Changes to issues show up here.</p>
            </EmptyState>
          )}
        </div>
        <div className="card wide">
          <h3>Epic progress</h3>
          <p className="sub">Done and in-progress issues per epic.</p>
          {p.epics.length ? (
            <table className="tbl">
              <tbody>
                {p.epics.map((e: Any) => {
                  const pr = epicProgress(e);
                  return (
                    <tr key={e.id} className="click" onClick={() => openDrawer('epic', e.id)}>
                      <td style={{ width: '40%' }}>
                        <ELoz e={e} />
                      </td>
                      <td>
                        <ProgBar {...pr} />
                      </td>
                      <td className="num muted" style={{ width: 110 }}>
                        {pr.done} of {pr.total} done
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="muted">No epics yet.</p>
          )}
        </div>
        <div className="card wide">
          <h3>About this project</h3>
          {p.description ? (
            <p
              className="sub"
              style={{ whiteSpace: 'pre-wrap', color: 'var(--text)', fontSize: 14 }}
            >
              {p.description}
            </p>
          ) : (
            <p className="sub">
              No project description yet.{' '}
              {can('project.settings') && (
                <Link
                  href={`/p/${p.id}/settings`}
                  onClick={() => {
                    S.setTab = 'details';
                  }}
                >
                  Write one
                </Link>
              )}
            </p>
          )}
        </div>
        {(p.summary || p.assumptions?.length > 0 || p.openQuestions?.length > 0) && (
          <div className="card wide">
            <h3>
              {p.sourceName ? (
                <>
                  Initial feature{' '}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    · {p.sourceName}
                  </span>
                </>
              ) : (
                'Assumptions and open questions'
              )}
            </h3>
            <p className="sub">
              {p.sourceName
                ? 'From the document this project was created from'
                : 'Recorded for this project'}{' '}
              ·{' '}
              <Link
                href={`/p/${p.id}/settings`}
                onClick={() => {
                  S.setTab = 'details';
                }}
              >
                Edit
              </Link>
              {(p.sources || []).length > 0 && (
                <>
                  {' '}
                  ·{' '}
                  <Link href={`/p/${p.id}/source`}>
                    {p.sources.length} more document{p.sources.length === 1 ? '' : 's'}
                  </Link>
                </>
              )}
            </p>
            {p.summary && <p style={{ margin: '0 0 16px', whiteSpace: 'pre-wrap' }}>{p.summary}</p>}
            <div className="grid2">
              <div>
                <h3 style={{ fontSize: 14 }}>
                  Assumptions <span className="count">{(p.assumptions || []).length}</span>
                </h3>
                <ReadList l={p.assumptions} />
              </div>
              <div>
                <h3 style={{ fontSize: 14 }}>
                  Open questions <span className="count">{(p.openQuestions || []).length}</span>
                </h3>
                <ReadList l={p.openQuestions} />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

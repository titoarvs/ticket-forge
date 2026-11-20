'use client';
import Link from 'next/link';
import { type Any, P, isSub, spSum, isDone, catOf, fmtDate, activeSprint } from '../core';
import { EmptyState, I } from '../ui';
import { CodeReviewReport } from '../CodeRabbit';
import { Header } from './row-dnd';

// ---------------------------------------------------------------- reports
function VelocityChart({ sprints }: { sprints: Any[] }) {
  if (!sprints.length) return <p className="muted">Complete a sprint to see velocity.</p>;
  const W = 640,
    H = 240,
    L = 40,
    B = 36,
    T = 12;
  const max = Math.max(
    1,
    ...sprints.flatMap((s) => [s.committedPoints || 0, s.completedPoints || 0]),
  );
  const step = Math.ceil(max / 4),
    top = step * 4;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const gw = (W - L - 8) / sprints.length;
  const bw = Math.min(28, gw / 3);
  const bar = (v: number, x: number, cls: string, label: string, name: string) => (
    <path
      key={cls}
      d={`M${x},${y(0)} V${y(v) + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${y(0)} Z`}
      className={cls}
    >
      <title>{`${name} · ${label}: ${v} points`}</title>
    </path>
  );
  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart"
        role="img"
        aria-label="Velocity: commitment versus completed story points per sprint"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={L} x2={W - 4} y1={y(i * step)} y2={y(i * step)} className="gridline" />
            <text x={L - 6} y={y(i * step) + 4} textAnchor="end" className="axis">
              {i * step}
            </text>
          </g>
        ))}
        {sprints.map((s, i) => {
          const cx = L + gw * i + gw / 2;
          return (
            <g key={s.id}>
              {bar(s.committedPoints || 0, cx - bw - 1, 'series-1', 'Commitment', s.name)}
              {bar(s.completedPoints || 0, cx + 1, 'series-2', 'Completed', s.name)}
              <text x={cx} y={H - B + 18} textAnchor="middle" className="axis">
                {s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span>
          <i className="series-1-bg" />
          Commitment
        </span>
        <span>
          <i className="series-2-bg" />
          Completed
        </span>
      </div>
    </>
  );
}
function Burndown({ s }: { s: Any }) {
  if (!s?.startDate || !s?.endDate)
    return <p className="muted">Start a sprint with start and end dates to see its burndown.</p>;
  const issues = P().tickets.filter((t: Any) => t.sprintId === s.id && !isSub(t));
  const total = s.committedPoints ?? spSum(issues);
  const doneAt = (t: Any) => {
    if (!isDone(t)) return null;
    const h = [...t.history]
      .reverse()
      .find((x: Any) => x.field === 'status' && catOf(x.to) === 'done');
    return Date.parse(h?.at || t.updatedAt);
  };
  const start = new Date(`${s.startDate}T00:00:00`),
    end = new Date(`${s.endDate}T00:00:00`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
  const stopAt = Math.min(Date.now(), s.completedAt ? Date.parse(s.completedAt) : Infinity);
  const pts: { d: number; v: number }[] = [];
  for (let d = 0; d <= days; d++) {
    if (start.getTime() + d * 86400000 > stopAt) break;
    const dayEnd = start.getTime() + (d + 1) * 86400000 - 1;
    pts.push({
      d,
      v:
        total -
        spSum(
          issues.filter((t: Any) => {
            const a = doneAt(t);
            return a && a <= dayEnd;
          }),
        ),
    });
  }
  const W = 640,
    H = 240,
    L = 40,
    B = 36,
    T = 12;
  const top = Math.max(4, Math.ceil(total / 4) * 4);
  const x = (d: number) => L + (W - L - 12) * (d / days);
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const ticks = Array.from({ length: days + 1 }, (_, d) => d).filter(
    (d) => d === 0 || d === days || d % Math.ceil(days / 6) === 0,
  );
  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart"
        role="img"
        aria-label={`Burndown for ${s.name}`}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line
              x1={L}
              x2={W - 4}
              y1={y((top / 4) * i)}
              y2={y((top / 4) * i)}
              className="gridline"
            />
            <text x={L - 6} y={y((top / 4) * i) + 4} textAnchor="end" className="axis">
              {(top / 4) * i}
            </text>
          </g>
        ))}
        {ticks.map((d) => (
          <text key={d} x={x(d)} y={H - B + 18} textAnchor="middle" className="axis">
            {fmtDate(start.getTime() + d * 86400000)}
          </text>
        ))}
        <line x1={x(0)} y1={y(total)} x2={x(days)} y2={y(0)} className="guide" />
        <path
          d={pts.map((p2, i) => `${i ? 'L' : 'M'}${x(p2.d)},${y(p2.v)}`).join(' ')}
          className="series-1-line"
        />
        {pts.map((p2) => (
          <circle key={p2.d} cx={x(p2.d)} cy={y(p2.v)} r={4} className="series-1 ring">
            <title>{`${fmtDate(start.getTime() + p2.d * 86400000)}: ${p2.v} points remaining`}</title>
          </circle>
        ))}
      </svg>
      <div className="legend">
        <span>
          <i className="series-1-bg" />
          Remaining story points
        </span>
        <span>
          <i className="guide-key" />
          Guideline
        </span>
      </div>
    </>
  );
}
export function Reports() {
  const p = P();
  const closed = p.sprints.filter((s: Any) => s.state === 'closed').slice(-7);
  const target = activeSprint() || closed[closed.length - 1];
  const avg = closed.length
    ? Math.round(
        closed.reduce((s: number, x: Any) => s + (x.completedPoints || 0), 0) / closed.length,
      )
    : 0;
  return (
    <>
      <Header title="Reports" />
      <div className="cards">
        <div className="card wide">
          <h3>Velocity</h3>
          <p className="sub">
            Story points committed at sprint start versus completed, for the last {closed.length}{' '}
            completed sprints
            {closed.length ? ` · average ${avg} points` : ''}.
          </p>
          <VelocityChart sprints={closed} />
        </div>
        <div className="card wide">
          <h3>Burndown{target ? ` · ${target.name}` : ''}</h3>
          <p className="sub">
            Story points remaining each day of the sprint against an even guideline.
          </p>
          <Burndown s={target} />
        </div>
        <div className="card wide">
          <h3>Sprint report</h3>
          <p className="sub">Every sprint in this project.</p>
          {p.sprints.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Sprint</th>
                  <th>State</th>
                  <th>Dates</th>
                  <th className="num">Issues</th>
                  <th className="num">Committed</th>
                  <th className="num">Completed</th>
                </tr>
              </thead>
              <tbody>
                {p.sprints.map((s: Any) => (
                  <tr key={s.id}>
                    <td>
                      <b style={{ fontWeight: 500 }}>{s.name}</b>
                      {s.goal && <div className="muted small">{s.goal}</div>}
                    </td>
                    <td>
                      <span
                        className={`loz ${s.state === 'active' ? 's-inprogress' : s.state === 'closed' ? 's-done' : 's-todo'}`}
                      >
                        {s.state === 'future' ? 'Planned' : s.state}
                      </span>
                    </td>
                    <td className="muted">
                      {s.startDate ? `${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}` : '–'}
                    </td>
                    <td className="num">
                      {p.tickets.filter((t: Any) => t.sprintId === s.id && !isSub(t)).length}
                    </td>
                    <td className="num">{s.committedPoints ?? '–'}</td>
                    <td className="num">{s.completedPoints ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              compact
              icon={I.chart}
              tone="neutral"
              title="No sprints yet"
              actions={
                <Link className="btn" href={`/p/${p.id}/backlog`}>
                  Go to backlog
                </Link>
              }
            >
              <p>Create and complete sprints in the backlog to see velocity here.</p>
            </EmptyState>
          )}
        </div>
        <CodeReviewReport />
      </div>
    </>
  );
}

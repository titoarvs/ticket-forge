'use client';
// The time scale across the top, the sprints row, and the grid lines with today's line.
import { type Any, P } from '../../core';
import { I, Ico } from '../../ui';
import { MONTHS, toMs, addDays, fmtY } from '../epic-range';
import { type Geometry, scaleRows } from './geometry';

/** In the weeks zoom the top row names the month and year ("Mar 2026"). */
const monthYear = (g: Geometry, day: number) => {
  const d = new Date(toMs(addDays(g.from, day)));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export function ScaleHead({ g }: { g: Geometry }) {
  const { top, bottom } = scaleRows(g);
  const showToday = g.today >= g.from && g.today < g.to;
  return (
    <div className="tl-head">
      <div className="tl-corner">
        <span>Epics</span>
      </div>
      <div className="tl-scale" style={{ width: g.width }}>
        <div className="tl-scale-row">
          {top.map(([l, d, n]) => (
            <span key={`${l}${d}`} style={{ left: d * g.ppd, width: n * g.ppd }}>
              {g.zoom[0] === 'weeks' ? monthYear(g, d) : l}
            </span>
          ))}
        </div>
        <div className="tl-scale-row sub">
          {bottom.map(([l, d, n]) => (
            <span key={`${l}${d}`} style={{ left: d * g.ppd, width: n * g.ppd }}>
              {l}
            </span>
          ))}
        </div>
        {showToday && (
          <span className="tl-today-flag" style={{ left: g.x(g.today) }}>
            Today
          </span>
        )}
      </div>
    </div>
  );
}

const sprintState = (s: Any) =>
  s.state === 'active' ? ' (active)' : s.state === 'closed' ? ' (closed)' : '';

/** Sprints with dates, as bars (only when there are any). */
export function SprintRow({ g }: { g: Geometry }) {
  const sprints = P().sprints.filter((s: Any) => s.startDate && s.endDate);
  if (!sprints.length) return null;
  return (
    <div className="tl-row tl-sprints">
      <div className="tl-left">
        <Ico svg={I.board} />
        <span className="muted small">Sprints</span>
      </div>
      <div className="tl-track" style={{ width: g.width }}>
        {sprints.map((s: Any) => (
          <span
            key={s.id}
            className={`tl-sprint ${s.state}`}
            style={{ left: g.x(s.startDate), width: g.barWidth(s.startDate, s.endDate) }}
            title={`${s.name}: ${fmtY(s.startDate)} – ${fmtY(s.endDate)}${sprintState(s)}`}
          >
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function GridLines({ g, left }: { g: Geometry; left: number }) {
  const { bottom } = scaleRows(g);
  const showToday = g.today >= g.from && g.today < g.to;
  return (
    <div className="tl-grid" style={{ left, width: g.width }} aria-hidden>
      {bottom.map(([, d]) => (
        <i key={d * g.ppd} style={{ left: d * g.ppd }} />
      ))}
      {showToday && <b className="tl-today" style={{ left: g.x(g.today) }} />}
    </div>
  );
}

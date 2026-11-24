'use client';
// The top of the Summary page: what the project is, where it stands, who works on it and when, all
// read from its issues, epics and sprints.
import type { ReactNode } from 'react';
import {
  type Any,
  P,
  activeSprint,
  catOf,
  epicTickets,
  fmtDate,
  isSub,
  peopleNames,
} from '../core';
import { Avatar, I, Ico } from '../ui';

function Row({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className="ov-row">
      <dt>
        <Ico svg={icon} />
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Not started, in progress or done, from the project's issues. */
function projectStatus(p: Any): [string, string] {
  const ts = p.tickets.filter((t: Any) => !isSub(t));
  if (!ts.length) return ['Not started', 's-todo'];
  if (ts.every((t: Any) => catOf(t.status) === 'done')) return ['Completed', 's-done'];
  if (activeSprint() || ts.some((t: Any) => catOf(t.status) !== 'todo'))
    return ['In progress', 's-inprogress'];
  return ['Not started', 's-todo'];
}
/** The earliest start and latest end across epics and sprints. */
function projectDates(p: Any) {
  const all = [...p.epics, ...p.sprints];
  const starts = all.map((x: Any) => x.startDate).filter(Boolean);
  const ends = all.map((x: Any) => x.dueDate || x.endDate).filter(Boolean);
  if (!starts.length || !ends.length) return '';
  return `${fmtDate(starts.sort()[0])} – ${fmtDate(ends.sort()[ends.length - 1])}`;
}
const epicDone = (e: Any) => {
  const ts = epicTickets(e.id);
  return ts.length > 0 && ts.every((t: Any) => catOf(t.status) === 'done');
};
const MAX_SEGMENTS = 16;

/** One segment per epic, filled when all its issues are done (one bar when there are many). */
function Milestones({ epics }: { epics: Any[] }) {
  const done = epics.filter(epicDone).length;
  const many = epics.length > MAX_SEGMENTS;
  return (
    <div className="ov-ms">
      <div className={`ov-segs ${many ? 'one' : ''}`} aria-hidden>
        {many ? (
          <i className="on" style={{ width: `${(done / epics.length) * 100}%` }} />
        ) : (
          epics.map((e, i) => <i key={e.id} className={i < done ? 'on' : ''} />)
        )}
      </div>
      <span>
        <b>{done}</b>/{epics.length} completed
      </span>
    </div>
  );
}

export function Overview() {
  const p = P();
  const [label, cls] = projectStatus(p);
  const about = String(p.description || p.summary || '').trim();
  const people = peopleNames();
  const dates = projectDates(p);
  return (
    <dl className="ov">
      <Row icon={I.tag} label="Status">
        <span className={`loz ov-status ${cls}`}>
          <i className={`dot-cat ${cls}`} />
          {label}
        </span>
      </Row>
      {about && (
        <Row icon={I.info} label="Description">
          <span className="ov-text">{about}</span>
        </Row>
      )}
      {people.length > 0 && (
        <Row icon={I.user} label="People">
          <span className="ov-people">
            {people.slice(0, 6).map((n) => (
              <span key={n} className="ov-person">
                <Avatar name={n} size={22} />
                {n}
              </span>
            ))}
            {people.length > 6 && <span className="ov-person">+{people.length - 6}</span>}
          </span>
        </Row>
      )}
      {dates && (
        <Row icon={I.calendar} label="Timeline">
          {dates}
        </Row>
      )}
      {p.epics.length > 0 && (
        <Row icon={I.flag} label="Epics">
          <Milestones epics={p.epics} />
        </Row>
      )}
    </dl>
  );
}

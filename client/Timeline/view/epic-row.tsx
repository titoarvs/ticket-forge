'use client';
// One epic on the timeline: its name and progress on the left, its bar on the right, and (expanded)
// its issues placed by their sprints.
import { type Any, S, saveUi, emit, can, epicTickets, sprint, catOf } from '../../core';
import { I, Ico, TypeIcon, StatusLoz } from '../../ui';
import { openDrawer } from '../../actions';
import { epicProgress } from '../../views';
import { epicRange, addDays, span, fmt, fmtY, ROW, SUBROW } from '../epic-range';
import type { Geometry } from './geometry';
import type { BarDrag } from './use-bar-drag';

type Range = { start: string; end: string; derived: boolean };
type BarFacts = { r: Range; pct: number; late: boolean; done: number; total: number };

/** Default length of a new bar, in days, for each zoom. */
const NEW_BAR_DAYS: Record<string, number> = { weeks: 13, months: 41, quarters: 90 };

function toggleOpen(id: string) {
  const open: Set<string> = S.tlOpen;
  if (open.has(id)) open.delete(id);
  else open.add(id);
  saveUi();
  emit();
}

const openLink = (kind: 'epic' | 'issue', id: string) => (ev: React.MouseEvent) => {
  ev.preventDefault();
  openDrawer(kind, id);
};

function barTitle(e: Any, { r, done, total, late }: BarFacts) {
  const days = span(r.start, r.end) + 1;
  return [
    e.title,
    `${fmtY(r.start)} – ${fmtY(r.end)} (${days} days)`,
    r.derived ? 'Estimated from its issues’ sprints. Drag to set dates.' : '',
    `${done} of ${total} issues done`,
    late ? 'Overdue' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function barLabel(e: Any, { r, pct, late }: BarFacts) {
  const est = r.derived ? ', estimated from sprints' : '';
  return `${e.key} ${e.title}: ${fmtY(r.start)} to ${fmtY(r.end)}${est}, ${pct}% done${late ? ', overdue' : ''}`;
}

/** The bar: drag it to move, drag its ends (planned dates only) to change them. */
function EpicBar({ e, f, g, drag }: { e: Any; f: BarFacts; g: Geometry; drag: BarDrag }) {
  const { r, pct, late } = f;
  const handles = can('epic.manage') && !r.derived;
  const handle = (side: 'l' | 'r', mode: 'start' | 'end') => (
    <span
      className={`tl-handle ${side}`}
      onPointerDown={(ev) => drag.begin(ev, e, mode, r.start, r.end)}
      onPointerMove={drag.move}
      onPointerUp={() => drag.end(e)}
    />
  );
  const dragging = drag.preview?.id === e.id;
  return (
    <div
      className={`tl-epic ${r.derived ? 'derived' : ''} ${late ? 'late' : ''} ${dragging ? 'dragging' : ''}`}
      role="button"
      tabIndex={0}
      style={{ left: g.x(r.start), width: g.barWidth(r.start, r.end), ['--c' as string]: e.color }}
      aria-label={barLabel(e, f)}
      title={barTitle(e, f)}
      onPointerDown={(ev) => drag.begin(ev, e, 'move', r.start, r.end)}
      onPointerMove={drag.move}
      onPointerUp={() => drag.end(e)}
      onPointerCancel={drag.cancel}
      onKeyDown={(ev) => drag.barKey(ev, e, r)}
    >
      <i className="tl-fill" style={{ width: `${pct}%` }} />
      {handles && handle('l', 'start')}
      <span className="tl-label">{e.title}</span>
      {handles && handle('r', 'end')}
    </div>
  );
}

/** The epic's row track: its bar, or (no dates yet) a place to click or drag one into being. */
function EpicTrack({ e, f, g, drag }: { e: Any; f: BarFacts | null; g: Geometry; drag: BarDrag }) {
  const ed = can('epic.manage');
  const preview = drag.preview?.id === e.id ? drag.preview : null;
  const create = (ev: React.PointerEvent<HTMLElement>) => {
    if (f) return;
    const at = drag.dayAt(ev.clientX);
    drag.begin(ev, e, 'create', at, addDays(at, NEW_BAR_DAYS[g.zoom[0]] ?? 41));
  };
  return (
    <div
      className={`tl-track ${ed && !f ? 'can-add' : ''}`}
      style={{ width: g.width }}
      onPointerDown={create}
      onPointerMove={drag.move}
      onPointerUp={() => {
        if (drag.isCreating()) drag.end(e);
      }}
      onPointerCancel={drag.cancel}
    >
      {f ? (
        <EpicBar e={e} f={f} g={g} drag={drag} />
      ) : (
        <span className="tl-empty muted small">
          {ed ? 'Click or drag to schedule' : 'No dates'}
        </span>
      )}
      {preview && (
        <span className="tl-dates" style={{ left: g.x(preview.end) + g.ppd + 8 }}>
          {fmt(preview.start)} – {fmt(preview.end)}
        </span>
      )}
    </div>
  );
}

/** An issue under its epic, as the bar of the sprint it is in. */
function IssueLine({ t, g }: { t: Any; g: Geometry }) {
  const s = sprint(t.sprintId);
  const dated = s?.startDate && s?.endDate;
  return (
    <div className="tl-row sub" style={{ height: SUBROW }}>
      <div className="tl-left">
        <TypeIcon type={t.type} />
        <a href="#" className="tl-title" title={t.title} onClick={openLink('issue', t.id)}>
          <span className="key">{t.key}</span> {t.title}
        </a>
        <StatusLoz s={t.status} />
      </div>
      <div className="tl-track" style={{ width: g.width }}>
        {dated ? (
          <button
            className={`tl-issue c-${catOf(t.status)}`}
            style={{ left: g.x(s.startDate), width: g.barWidth(s.startDate, s.endDate) }}
            title={`${t.key} ${t.title}\n${s.name}: ${fmtY(s.startDate)} – ${fmtY(s.endDate)}\n${t.status}`}
            onClick={() => openDrawer('issue', t.id)}
          >
            <span>{t.key}</span>
          </button>
        ) : (
          <span className="tl-empty muted small">
            {s ? `${s.name} has no dates yet` : 'Not in a sprint'}
          </span>
        )}
      </div>
    </div>
  );
}

function EpicName({
  e,
  pct,
  late,
  done,
  total,
}: {
  e: Any;
  pct: number;
  late: boolean;
  done: number;
  total: number;
}) {
  const isOpen = S.tlOpen.has(e.id);
  return (
    <div className="tl-left">
      <button
        className="icon-btn tl-caret"
        aria-expanded={isOpen}
        aria-label={`${isOpen ? 'Hide' : 'Show'} issues in ${e.title}`}
        onClick={() => toggleOpen(e.id)}
        disabled={!total}
        style={{ visibility: total ? 'visible' : 'hidden' }}
      >
        <Ico svg={I.chevron} className={isOpen ? '' : 'closed'} />
      </button>
      <TypeIcon type="Epic" />
      <a href="#" className="tl-title" title={e.title} onClick={openLink('epic', e.id)}>
        <span className="key">{e.key}</span> {e.title}
      </a>
      {late && <span className="tl-late-dot" title="Past its due date and not done" />}
      <span className="muted small tl-pct" title={`${done} of ${total} issues done`}>
        {pct}%
      </span>
    </div>
  );
}

/** While a bar is dragged its row shows the dragged dates. Overdue: planned, past due, not done. */
export function EpicRow({ e, g, drag }: { e: Any; g: Geometry; drag: BarDrag }) {
  const { done, total } = epicProgress(e);
  const p = drag.preview;
  const r: Range | null =
    p?.id === e.id ? { start: p.start, end: p.end, derived: false } : epicRange(e);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const late = !!r && !r.derived && r.end < g.today && done < Math.max(1, total);
  const issues = S.tlOpen.has(e.id) ? epicTickets(e.id) : [];
  return (
    <div className="tl-group">
      <div className="tl-row" style={{ height: ROW }}>
        <EpicName e={e} pct={pct} late={late} done={done} total={total} />
        <EpicTrack e={e} f={r ? { r, pct, late, done, total } : null} g={g} drag={drag} />
      </div>
      {issues.map((t: Any) => (
        <IssueLine key={t.id} t={t} g={g} />
      ))}
    </div>
  );
}

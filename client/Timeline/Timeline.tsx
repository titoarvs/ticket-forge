'use client';
import {
  useState,
  useRef,
  useMemo,
  useLayoutEffect,
  useEffect,
  type PointerEvent as RPointerEvent,
  type KeyboardEvent as RKeyboardEvent,
} from 'react';
import { P, can, S, saveUi, emit, type Any, openModal, epicTickets, sprint, catOf } from '../core';
import { EmptyState, I, Ico, TypeIcon, StatusLoz } from '../ui';
import { openDrawer, addEpic } from '../actions';
import { Header, epicProgress } from '../views';
import { FeatureModal } from '../FeatureModal';
import {
  useNarrow,
  ZOOMS,
  todayStr,
  type Drag,
  epicRange,
  toMs,
  toStr,
  addDays,
  span,
  scale,
  setEpicDates,
  MONTHS,
  fmtY,
  ROW,
  SUBROW,
  fmt,
} from './epic-range';

export function Timeline() {
  const p = P();
  const narrow = useNarrow();
  const LEFT = narrow ? 150 : 300;
  const ed = can('epic.manage');
  const zoom = ZOOMS.find(([k]) => k === S.tlZoom) || ZOOMS[1];
  const ppd = zoom[2];
  const today = todayStr();
  const [preview, setPreview] = useState<{ id: string; start: string; end: string } | null>(null);
  const drag = useRef<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const open: Set<string> = S.tlOpen;

  // The visible range: whole quarters around every date in the project, today, and some room to
  // plan ahead.
  const { from, to } = useMemo(() => {
    const ds = [today];
    for (const e of p.epics) {
      const r = epicRange(e);
      if (r) ds.push(r.start, r.end);
    }
    for (const s of p.sprints) if (s.startDate && s.endDate) ds.push(s.startDate, s.endDate);
    ds.sort();
    const q = (d: string, add: number) => {
      const x = new Date(toMs(d));
      const m = x.getUTCMonth();
      return toStr(Date.UTC(x.getUTCFullYear(), m - (m % 3) + add, 1));
    };
    const lo = q(addDays(ds[0], -30), 0);
    let hi = q(addDays(ds.at(-1)!, 60), 3);
    if (span(lo, hi) < 365) hi = q(addDays(lo, 365), 0);
    return { from: lo, to: hi };
  }, [p.epics, p.sprints, today]);
  const days = span(from, to);
  const width = days * ppd;
  const x = (d: string) => span(from, d) * ppd;
  const top = scale(from, to, zoom[0] === 'weeks' ? 'month' : 'year');
  const bottom = scale(
    from,
    to,
    zoom[0] === 'weeks' ? 'week' : zoom[0] === 'months' ? 'month' : 'quarter',
  );

  // Open on today.
  const scrollToToday = (smooth = false) => {
    const el = scroller.current;
    if (el)
      el.scrollTo({
        left: Math.max(0, x(today) - (el.clientWidth - LEFT) / 3),
        behavior: smooth ? 'smooth' : 'auto',
      });
  };
  useLayoutEffect(() => {
    scrollToToday();
  }, [zoom[0], LEFT]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      document.body.classList.remove('resizing-x');
    },
    [],
  );

  const setZoom = (k: string) => {
    S.tlZoom = k;
    saveUi();
    emit();
  };
  const toggle = (id: string) => {
    if (open.has(id)) open.delete(id);
    else open.add(id);
    saveUi();
    emit();
  };
  const allOpen = p.epics.length > 0 && p.epics.every((e: Any) => open.has(e.id));
  const toggleAll = () => {
    if (allOpen) open.clear();
    else p.epics.forEach((e: Any) => open.add(e.id));
    saveUi();
    emit();
  };

  // ---- dragging bars
  const dayAtPointer = (clientX: number) => {
    const el = scroller.current!;
    const left = el.getBoundingClientRect().left + LEFT - el.scrollLeft;
    return addDays(from, Math.floor((clientX - left) / ppd));
  };
  const begin = (
    ev: RPointerEvent<HTMLElement>,
    e: Any,
    mode: Drag['mode'],
    s0: string,
    e0: string,
  ) => {
    if (!ed || ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    drag.current = {
      id: e.id,
      mode,
      x: ev.clientX,
      s0,
      e0,
      moved: mode === 'create',
      start: s0,
      end: e0,
    };
    if (mode === 'create') setPreview({ id: e.id, start: s0, end: e0 });
    document.body.classList.add('resizing-x');
  };
  const move = (ev: RPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = ev.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 4) return;
    d.moved = true;
    const n = Math.round(dx / ppd);
    let { s0: start, e0: end } = d;
    if (d.mode === 'move') {
      start = addDays(d.s0, n);
      end = addDays(d.e0, n);
    } else if (d.mode === 'start') {
      start = addDays(d.s0, n);
      if (start > end) start = end;
    } else if (d.mode === 'end') {
      end = addDays(d.e0, n);
      if (end < start) end = start;
    } else {
      const at = dayAtPointer(ev.clientX);
      if (at < d.s0) {
        start = at;
        end = d.s0;
      } else {
        start = d.s0;
        end = at > d.e0 ? at : d.e0;
      }
    }
    d.start = start;
    d.end = end;
    setPreview({ id: d.id, start, end });
  };
  const end = (ev: RPointerEvent<HTMLElement>, e: Any) => {
    const d = drag.current;
    drag.current = null;
    document.body.classList.remove('resizing-x');
    if (!d) return;
    if (!d.moved) {
      setPreview(null);
      openDrawer('epic', e.id);
      return;
    }
    setPreview(null);
    setEpicDates(e, d.start, d.end);
    void ev;
  };
  const cancel = () => {
    drag.current = null;
    setPreview(null);
    document.body.classList.remove('resizing-x');
  };

  // Keyboard: ←/→ move the bar a day (a week with Shift); Alt+←/→ change the due date.
  const barKey = (ev: RKeyboardEvent<HTMLElement>, e: Any, r: { start: string; end: string }) => {
    if (ev.key === 'Enter') {
      openDrawer('epic', e.id);
      return;
    }
    if (!ed || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
    ev.preventDefault();
    const n = (ev.key === 'ArrowLeft' ? -1 : 1) * (ev.shiftKey ? 7 : 1);
    if (ev.altKey)
      setEpicDates(e, r.start, addDays(r.end, n) < r.start ? r.start : addDays(r.end, n));
    else setEpicDates(e, addDays(r.start, n), addDays(r.end, n));
  };

  const defaultLen = zoom[0] === 'weeks' ? 13 : zoom[0] === 'months' ? 41 : 90;
  const sprints = p.sprints.filter((s: Any) => s.startDate && s.endDate);
  const gridLines = bottom.map(([, d]) => d * ppd);
  const todayX = x(today);
  const showToday = today >= from && today < to;

  if (!p.epics.length) {
    return (
      <>
        <Header title="Timeline" />
        <EmptyState
          icon={I.calendar}
          tone="epic"
          title="Plan your features on a timeline"
          actions={
            <>
              {ed && (
                <button className="btn primary" onClick={addEpic}>
                  <Ico svg={I.plus} />
                  Create epic
                </button>
              )}
              {can('ai.use') && can('issue.create') && (
                <button className="btn ai" onClick={() => openModal(<FeatureModal />)}>
                  <Ico svg={I.plus} />
                  Add feature with AI
                </button>
              )}
            </>
          }
        >
          <p>
            Each epic gets a bar from its start to its due date, so you can see what’s planned when
            and what’s running late.
          </p>
        </EmptyState>
      </>
    );
  }

  const scheduled = p.epics.filter((e: Any) => epicRange(e)).length;
  return (
    <>
      <Header
        title="Timeline"
        sub={
          <span className="muted small">
            {scheduled} of {p.epics.length} epic{p.epics.length === 1 ? '' : 's'} scheduled
            {ed
              ? ' · drag a bar to move it, drag its ends to change dates, or click an empty row to schedule'
              : ''}
          </span>
        }
        right={
          <>
            {can('ai.use') && can('issue.create') && (
              <button className="btn ai" onClick={() => openModal(<FeatureModal />)}>
                <Ico svg={I.plus} />
                Add feature with AI
              </button>
            )}
            {ed && (
              <button className="btn primary" onClick={addEpic}>
                <Ico svg={I.plus} />
                Create epic
              </button>
            )}
          </>
        }
      />
      <div className="row tl-bar">
        <div className="seg" role="radiogroup" aria-label="Zoom">
          {ZOOMS.map(([k, l]) => (
            <button
              key={k}
              role="radio"
              aria-checked={zoom[0] === k}
              className={zoom[0] === k ? 'on' : ''}
              onClick={() => setZoom(k)}
            >
              {l}
            </button>
          ))}
        </div>
        <button className="btn subtle" onClick={() => scrollToToday(true)}>
          <Ico svg={I.calendar} />
          Today
        </button>
        <button className="btn subtle" onClick={toggleAll}>
          <Ico svg={allOpen ? I.collapse : I.expand} />
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
        <div className="spacer" />
        <span className="tl-legend muted small">
          <i className="tl-key planned" />
          Planned dates
          <i className="tl-key derived" />
          From sprints
          <i className="tl-key late" />
          Overdue
        </span>
      </div>

      <div
        className={`tl ${narrow ? 'narrow' : ''}`}
        ref={scroller}
        style={{ ['--tl-left' as string]: `${LEFT}px` }}
      >
        <div className="tl-inner" style={{ width: LEFT + width }}>
          {/* time scale */}
          <div className="tl-head">
            <div className="tl-corner">
              <span>Epics</span>
            </div>
            <div className="tl-scale" style={{ width }}>
              <div className="tl-scale-row">
                {top.map(([l, d, n]) => (
                  <span key={`${l}${d}`} style={{ left: d * ppd, width: n * ppd }}>
                    {zoom[0] === 'weeks'
                      ? `${MONTHS[new Date(toMs(addDays(from, d))).getUTCMonth()]} ${new Date(toMs(addDays(from, d))).getUTCFullYear()}`
                      : l}
                  </span>
                ))}
              </div>
              <div className="tl-scale-row sub">
                {bottom.map(([l, d, n]) => (
                  <span key={`${l}${d}`} style={{ left: d * ppd, width: n * ppd }}>
                    {l}
                  </span>
                ))}
              </div>
              {showToday && (
                <span className="tl-today-flag" style={{ left: todayX }}>
                  Today
                </span>
              )}
            </div>
          </div>

          {/* sprints */}
          {sprints.length > 0 && (
            <div className="tl-row tl-sprints">
              <div className="tl-left">
                <Ico svg={I.board} />
                <span className="muted small">Sprints</span>
              </div>
              <div className="tl-track" style={{ width }}>
                {sprints.map((s: Any) => (
                  <span
                    key={s.id}
                    className={`tl-sprint ${s.state}`}
                    style={{
                      left: x(s.startDate),
                      width: Math.max(ppd, (span(s.startDate, s.endDate) + 1) * ppd),
                    }}
                    title={`${s.name}: ${fmtY(s.startDate)} – ${fmtY(s.endDate)}${s.state === 'active' ? ' (active)' : s.state === 'closed' ? ' (closed)' : ''}`}
                  >
                    {s.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* grid lines and today */}
          <div className="tl-body">
            <div className="tl-grid" style={{ left: LEFT, width }} aria-hidden>
              {gridLines.map((gx) => (
                <i key={gx} style={{ left: gx }} />
              ))}
              {showToday && <b className="tl-today" style={{ left: todayX }} />}
            </div>

            {p.epics.map((e: Any) => {
              const pr = epicProgress(e);
              const base = epicRange(e);
              const r =
                preview?.id === e.id
                  ? { start: preview.start, end: preview.end, derived: false }
                  : base;
              const pct = pr.total ? Math.round((pr.done / pr.total) * 100) : 0;
              const late = !!r && !r.derived && r.end < today && pr.done < Math.max(1, pr.total);
              const isOpen = open.has(e.id);
              const issues = isOpen ? epicTickets(e.id) : [];
              return (
                <div key={e.id} className="tl-group">
                  <div className="tl-row" style={{ height: ROW }}>
                    <div className="tl-left">
                      <button
                        className="icon-btn tl-caret"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Hide' : 'Show'} issues in ${e.title}`}
                        onClick={() => toggle(e.id)}
                        disabled={!pr.total}
                        style={{ visibility: pr.total ? 'visible' : 'hidden' }}
                      >
                        <Ico svg={I.chevron} className={isOpen ? '' : 'closed'} />
                      </button>
                      <TypeIcon type="Epic" />
                      <a
                        href="#"
                        className="tl-title"
                        title={e.title}
                        onClick={(ev) => {
                          ev.preventDefault();
                          openDrawer('epic', e.id);
                        }}
                      >
                        <span className="key">{e.key}</span> {e.title}
                      </a>
                      {late && (
                        <span className="tl-late-dot" title="Past its due date and not done" />
                      )}
                      <span
                        className="muted small tl-pct"
                        title={`${pr.done} of ${pr.total} issues done`}
                      >
                        {pct}%
                      </span>
                    </div>
                    <div
                      className={`tl-track ${ed && !r ? 'can-add' : ''}`}
                      style={{ width }}
                      onPointerDown={(ev) => {
                        if (r) return;
                        const at = dayAtPointer(ev.clientX);
                        begin(ev, e, 'create', at, addDays(at, defaultLen));
                      }}
                      onPointerMove={move}
                      onPointerUp={(ev) => {
                        if (drag.current?.mode === 'create') end(ev, e);
                      }}
                      onPointerCancel={cancel}
                    >
                      {r ? (
                        <div
                          className={`tl-epic ${r.derived ? 'derived' : ''} ${late ? 'late' : ''} ${preview?.id === e.id ? 'dragging' : ''}`}
                          role="button"
                          tabIndex={0}
                          style={{
                            left: x(r.start),
                            width: Math.max(ppd, (span(r.start, r.end) + 1) * ppd),
                            ['--c' as string]: e.color,
                          }}
                          aria-label={`${e.key} ${e.title}: ${fmtY(r.start)} to ${fmtY(r.end)}${r.derived ? ', estimated from sprints' : ''}, ${pct}% done${late ? ', overdue' : ''}`}
                          title={`${e.title}\n${fmtY(r.start)} – ${fmtY(r.end)} (${span(r.start, r.end) + 1} days)${r.derived ? '\nEstimated from its issues’ sprints. Drag to set dates.' : ''}\n${pr.done} of ${pr.total} issues done${late ? '\nOverdue' : ''}`}
                          onPointerDown={(ev) => begin(ev, e, 'move', r.start, r.end)}
                          onPointerMove={move}
                          onPointerUp={(ev) => end(ev, e)}
                          onPointerCancel={cancel}
                          onKeyDown={(ev) => barKey(ev, e, r)}
                        >
                          <i className="tl-fill" style={{ width: `${pct}%` }} />
                          {ed && !r.derived && (
                            <span
                              className="tl-handle l"
                              onPointerDown={(ev) => begin(ev, e, 'start', r.start, r.end)}
                              onPointerMove={move}
                              onPointerUp={(ev) => end(ev, e)}
                            />
                          )}
                          <span className="tl-label">{e.title}</span>
                          {ed && !r.derived && (
                            <span
                              className="tl-handle r"
                              onPointerDown={(ev) => begin(ev, e, 'end', r.start, r.end)}
                              onPointerMove={move}
                              onPointerUp={(ev) => end(ev, e)}
                            />
                          )}
                        </div>
                      ) : (
                        <span className="tl-empty muted small">
                          {ed ? 'Click or drag to schedule' : 'No dates'}
                        </span>
                      )}
                      {preview?.id === e.id && (
                        <span className="tl-dates" style={{ left: x(preview.end) + ppd + 8 }}>
                          {fmt(preview.start)} – {fmt(preview.end)}
                        </span>
                      )}
                    </div>
                  </div>
                  {issues.map((t: Any) => {
                    const s = sprint(t.sprintId);
                    const has = s?.startDate && s?.endDate;
                    const cat = catOf(t.status);
                    return (
                      <div key={t.id} className="tl-row sub" style={{ height: SUBROW }}>
                        <div className="tl-left">
                          <TypeIcon type={t.type} />
                          <a
                            href="#"
                            className="tl-title"
                            title={t.title}
                            onClick={(ev) => {
                              ev.preventDefault();
                              openDrawer('issue', t.id);
                            }}
                          >
                            <span className="key">{t.key}</span> {t.title}
                          </a>
                          <StatusLoz s={t.status} />
                        </div>
                        <div className="tl-track" style={{ width }}>
                          {has ? (
                            <button
                              className={`tl-issue c-${cat}`}
                              style={{
                                left: x(s.startDate),
                                width: Math.max(ppd, (span(s.startDate, s.endDate) + 1) * ppd),
                              }}
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
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        Issues show the dates of the sprint they’re in. Keyboard: focus a bar, ←/→ moves it a day
        (Shift: a week), Alt+←/→ changes its due date, Enter opens it.
      </p>
    </>
  );
}

'use client';
// The Timeline view. This component only puts the parts in client/Timeline/view/ together.
import { useRef, useLayoutEffect } from 'react';
import { type Any, P, can, S } from '../core';
import { useNarrow, ZOOMS, todayStr } from './epic-range';
import { useGeometry } from './view/geometry';
import { useBarDrag } from './view/use-bar-drag';
import { EmptyTimeline, TimelineHeader, TimelineBar } from './view/toolbar';
import { ScaleHead, SprintRow, GridLines } from './view/scale';
import { EpicRow } from './view/epic-row';

export function Timeline() {
  const p = P();
  const narrow = useNarrow();
  const left = narrow ? 150 : 300;
  const zoom = ZOOMS.find(([k]) => k === S.tlZoom) || ZOOMS[1];
  const g = useGeometry(p, zoom, todayStr());
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useBarDrag({ g, canEdit: can('epic.manage'), left, scroller });

  /** Scrolls so today is a third of the way across. */
  const scrollToToday = (smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    const at = Math.max(0, g.x(g.today) - (el.clientWidth - left) / 3);
    el.scrollTo({ left: at, behavior: smooth ? 'smooth' : 'auto' });
  };
  // Opens on today (and again after changing the zoom).
  useLayoutEffect(() => {
    scrollToToday();
  }, [zoom[0], left]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p.epics.length) return <EmptyTimeline />;
  return (
    <>
      <TimelineHeader />
      <TimelineBar zoom={zoom[0]} onToday={() => scrollToToday(true)} />
      <div
        className={`tl ${narrow ? 'narrow' : ''}`}
        ref={scroller}
        style={{ ['--tl-left' as string]: `${left}px` }}
      >
        <div className="tl-inner" style={{ width: left + g.width }}>
          <ScaleHead g={g} />
          <SprintRow g={g} />
          <div className="tl-body">
            <GridLines g={g} left={left} />
            {p.epics.map((e: Any) => (
              <EpicRow key={e.id} e={e} g={g} drag={drag} />
            ))}
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

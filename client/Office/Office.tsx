'use client';
// Agent Office: a 2D office floor where every desk is a hover-bot (an agent on the Agents page, a
// code job on Code jobs). The floor is drawn by ./engine; this is the glass HUD round it: the
// header, the roster, the selected desk's card and the view controls.
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from '../core';
import { createOffice, type OfficeApi, type BotSnap } from './engine';
import { MAX_DESKS } from './layout';
import { Roster, DeskCard, type OfficeDesk } from './OfficeCard';
import { BoardPanel } from './OfficePanels';
import type { ItemHit } from './interact';

export type { OfficeDesk } from './OfficeCard';
export { MAX_DESKS } from './layout';

type Props = {
  /** The desks, at most MAX_DESKS (the caller says how many there were in all with `total`). */
  desks: OfficeDesk[];
  total: number;
  title: string;
  /** The header's second line. */
  sub: string;
  rosterTitle: string;
  note: string;
  /** The back-wall boards: the big one's title and summary, the small one's title, the groups in order. */
  boards: { big: string; bigSub: string; small: string; groups: string[] };
  /** Told when a desk is picked (or the pick is cleared). */
  onSelect?: (id: string | null) => void;
  /**
   * A panel of the page's own over the floor (a job's terminal…). As a function it gets the
   * maximize control, so the panel can fill the office (in full view).
   */
  overlay?: ReactNode | ((c: PanelCtl) => ReactNode);
  /** What clicking a desk's computer does: its tooltip, and the handler. */
  screenHint?: string;
  onScreen?: (id: string) => void;
  /** The desk whose computer is outlined (its terminal is open…). */
  activeScreen?: string | null;
};

const isDark = () =>
  typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';

function Logo() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <defs>
        <linearGradient id="of-lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3ee0ff" />
          <stop offset="1" stopColor="#5b8cff" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="36" height="36" rx="11" fill="url(#of-lg)" />
      <rect x="9" y="12" width="22" height="15" rx="7" fill="#0b0e13" />
      <circle cx="16" cy="19.5" r="2.4" fill="#3ee0ff" />
      <circle cx="24" cy="19.5" r="2.4" fill="#3ee0ff" />
      <rect x="19" y="6" width="2" height="6" rx="1" fill="#0b0e13" />
    </svg>
  );
}

type Ref<T> = { current: T | null };
/** A panel's maximize control: is it filling the office, and the button that flips that. */
export type PanelCtl = { max: boolean; toggleMax: () => void };
/** Day/night follows the app's theme (and can be flipped here); full screen is the office itself. */
function useOfficeChrome(
  root: Ref<HTMLDivElement>,
  api: Ref<OfficeApi>,
  escFirst: Ref<() => boolean>,
) {
  const [night, setNightState] = useState(isDark);
  const [full, setFull] = useState(false);
  const setNight = (v: boolean) => {
    setNightState(v);
    api.current?.setNight(v);
  };
  useEffect(() => {
    const mo = new MutationObserver(() => setNight(isDark()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const fs = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', fs);
    return () => {
      mo.disconnect();
      document.removeEventListener('fullscreenchange', fs);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else
      root.current
        ?.requestFullscreen?.()
        .catch(() => toast('Full screen isn’t available here', 'err'));
  };
  return { night, setNight, full, toggleFull, ...useFullView(root, escFirst) };
}

/**
 * Full view: the office as a modal over the whole app (a dim backdrop round it). Esc, the × or a
 * click on the backdrop closes it. Esc goes to an app dialog open over it first, then to escFirst
 * (a maximized panel shrinks back), and only then closes the full view.
 */
function useFullView(root: Ref<HTMLDivElement>, escFirst: Ref<() => boolean>) {
  const [modal, setModal] = useState(false);
  useEffect(() => {
    if (!modal) return undefined;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.fullscreenElement) return;
      if (document.querySelector('.modal-back')) return;
      if (escFirst.current?.()) return;
      setModal(false);
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', key);
    };
  }, [modal]); // eslint-disable-line react-hooks/exhaustive-deps
  return { modal, setModal };
}

/** The floor is rebuilt when its desks change; live desks only get new statuses. */
const floorKey = (desks: OfficeDesk[]) =>
  desks.map((d) => (d.live ? d.id : `${d.id}:${d.mode}`)).join(',');
const liveKey = (desks: OfficeDesk[]) =>
  JSON.stringify(desks.map((d) => [d.id, d.mode, d.group, d.badge, d.tasks, d.live]));

export function Office(p: Props) {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const api = useRef<OfficeApi | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [paused, setPaused] = useState(false);
  const [snap, setSnap] = useState<BotSnap[]>([]);
  const [maxed, setMaxedState] = useState<'' | 'overlay' | 'board'>('');
  const escFirst = useRef<() => boolean>(null);
  escFirst.current = () => {
    if (!maxed) return false;
    setMaxedState('');
    return true;
  };
  const ch = useOfficeChrome(root, api, escFirst);
  /** Maximizing a panel opens the full view; it fills the office there. */
  const toggleMax = (which: 'overlay' | 'board') => {
    setMaxedState(maxed === which ? '' : which);
    if (maxed !== which) ch.setModal(true);
  };
  useEffect(() => {
    if (!ch.modal) setMaxedState('');
  }, [ch.modal]);
  const [panel, setPanel] = useState<'' | 'board' | 'teams'>('');
  const onSelect = useRef(p.onSelect);
  onSelect.current = p.onSelect;
  const onItem = useRef<(h: ItemHit) => void>(null);
  onItem.current = (h: ItemHit) => {
    if (h.kind === 'screen' && h.desk) p.onScreen?.(h.desk);
    else if (h.kind === 'board' || h.kind === 'teams') setPanel(panel === h.kind ? '' : h.kind);
    else if (h.kind === 'full') toast(`${h.label} is full right now`);
  };
  const active = useRef(p.activeScreen);
  active.current = p.activeScreen;
  const pick = (id: string | null) => {
    setSel(id);
    onSelect.current?.(id);
  };
  const desks = p.desks.slice(0, MAX_DESKS);
  const boards = () => ({
    ...p.boards,
    font: getComputedStyle(root.current).fontFamily || 'sans-serif',
  });

  useEffect(() => {
    const o = createOffice(stage.current, labels.current, desks, {
      night: ch.night,
      boards: boards(),
      screenHint: p.screenHint || 'Open details',
      onItem: (h) => onItem.current?.(h),
      onSelect: pick,
      onFollow: setFollow,
    });
    o.setPaused(paused);
    o.setActiveScreen(active.current ?? null);
    api.current = o;
    pick(null);
    setSnap(o.snapshot());
    const t = setInterval(() => setSnap(o.snapshot()), 400);
    return () => {
      clearInterval(t);
      o.destroy();
      api.current = null;
    };
  }, [floorKey(desks)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.current?.update(desks, boards());
  }, [liveKey(desks), p.boards.bigSub]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.current?.setActiveScreen(p.activeScreen ?? null);
  }, [p.activeScreen]);

  const d = desks.find((x) => x.id === sel);
  const s = snap.find((x) => x.id === sel);
  const clock = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <>
      {ch.modal && <div className="of-backdrop" onClick={() => ch.setModal(false)} aria-hidden />}
      <div
        ref={root}
        className={`of-root ${ch.night ? '' : 'day'} ${ch.modal ? 'of-modal' : ''}`}
        role={ch.modal ? 'dialog' : undefined}
        aria-modal={ch.modal || undefined}
        aria-label={ch.modal ? p.title : undefined}
        tabIndex={-1}
      >
        <div ref={stage} className="of-stage" aria-label={`Map of the ${p.title} floor`} />
        <div ref={labels} className="of-labels" />
        <header className="of-top of-panel">
          <Logo />
          <div>
            <h1>{p.title}</h1>
            <p>
              {p.sub}
              {p.total > desks.length && ` · showing ${desks.length} of ${p.total}`}
            </p>
          </div>
          <div className="of-clock">{clock}</div>
          {ch.modal && (
            <button
              className="of-x"
              aria-label="Close full view"
              onClick={() => ch.setModal(false)}
            >
              ×
            </button>
          )}
        </header>
        <Roster title={p.rosterTitle} desks={desks} snap={snap} sel={sel} api={api.current} />
        {d && s && api.current && (
          <DeskCard d={d} s={s} api={api.current} follow={follow} setFollow={setFollow} />
        )}
        {!panel &&
          (typeof p.overlay === 'function'
            ? p.overlay({ max: maxed === 'overlay', toggleMax: () => toggleMax('overlay') })
            : p.overlay)}
        {panel && (
          <BoardPanel
            by={panel}
            title={panel === 'board' ? p.boards.big : p.boards.small}
            groups={p.boards.groups}
            desks={desks}
            snap={snap}
            sel={sel}
            onPick={(id) => {
              api.current?.select(id);
              if (maxed === 'board') setMaxedState('');
            }}
            onClose={() => {
              setPanel('');
              if (maxed === 'board') setMaxedState('');
            }}
            max={maxed === 'board'}
            onMax={() => toggleMax('board')}
          />
        )}
        <nav className="of-dock of-panel" aria-label="View controls">
          <button onClick={() => api.current?.overview()}>Overview</button>
          <button aria-pressed={!ch.night} onClick={() => ch.setNight(!ch.night)}>
            {ch.night ? 'Daylight' : 'Night'}
          </button>
          <button
            aria-pressed={paused}
            onClick={() => {
              setPaused(!paused);
              api.current?.setPaused(!paused);
            }}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button aria-pressed={ch.modal} onClick={() => ch.setModal(!ch.modal)}>
            {ch.modal ? 'Exit full view' : 'Full view'}
          </button>
          {ch.modal && (
            <button className="of-full" aria-pressed={ch.full} onClick={ch.toggleFull}>
              {ch.full ? 'Exit full screen' : 'Full screen'}
            </button>
          )}
        </nav>
        <p className="of-hint">Drag · Ctrl + scroll to zoom · click bots, computers and boards</p>
        <p className="of-note">{p.note}</p>
      </div>
    </>
  );
}

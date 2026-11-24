'use client';
// Guided tours (Reactour). <TourHost> wraps the signed-in app; pages call useAutoTour('home' |
// 'new' | …) and the tour for that page starts once for people who joined after tours were added.
// Finished or skipped tours are saved in your preferences on the server (/api/me/prefs), so they
// don't show again on another browser. Anyone can start the tour for the page they are on from the
// account menu ("Show me around").
import { useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { TourProvider, useTour, type StepType } from '@reactour/tour';
import { S, api, can, type Any } from '../core';
import { TOURS, tourForPath, type TourId } from './steps';

/** People created before this date already know the app: their tours don't start by themselves. */
const TOURS_SINCE = '2026-11-14T00:00:00Z';

type Ctl = {
  setSteps?: (s: StepType[]) => void;
  setIsOpen: (v: boolean) => void;
  setCurrentStep: (n: number) => void;
  isOpen: boolean;
};
let ctl: Ctl | null = null;
let activeId: TourId | null = null;
const startedThisVisit = new Set<string>();

const visible = (sel: string) => {
  const el = document.querySelector(sel) as HTMLElement | null;
  return Boolean(el && el.getClientRects().length);
};

function StepBody({
  title,
  text,
  n,
  total,
}: {
  title: string;
  text: string;
  n: number;
  total: number;
}) {
  return (
    <div className="tour-step">
      <span className="tour-count">
        Step {n} of {total}
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

/** Starts a tour now. Returns false when none of its steps can be shown on this page. */
export function startTour(id: TourId): boolean {
  if (!ctl?.setSteps) return false;
  const def = TOURS[id];
  const shown = def.steps.filter(
    (s) => (!s.perm || can(s.perm)) && visible(`[data-tour="${s.target}"]`),
  );
  if (!shown.length) return false;
  ctl.setSteps(
    shown.map((s, i): StepType => ({
      selector: `[data-tour="${s.target}"]`,
      ...(s.position ? { position: s.position } : {}),
      content: <StepBody title={s.title} text={s.text} n={i + 1} total={shown.length} />,
    })),
  );
  activeId = id;
  ctl.setCurrentStep(0);
  ctl.setIsOpen(true);
  return true;
}

/** Starts the tour for the page you're on (account menu → "Show me around"). */
export function startTourHere(): boolean {
  const id = tourForPath(location.pathname, Boolean(S.drawer));
  return startTour(id) || (id !== 'home' && startTour('home'));
}

function prefs(): Any {
  return S.auth?.prefs || { tours: {}, toursOff: false };
}
async function markDone(id: TourId) {
  const p = prefs();
  if (S.auth)
    S.auth.prefs = { ...p, tours: { ...(p.tours || {}), [id]: new Date().toISOString() } };
  try {
    await api('/api/me/prefs', { method: 'PUT', body: { tourDone: id } });
  } catch {
    /* best effort: it may show once more */
  }
}
/** Show every tour again from the start (account menu). */
export async function resetTours() {
  try {
    const p = await api('/api/me/prefs', { method: 'PUT', body: { tourReset: true } });
    if (S.auth) S.auth.prefs = p;
  } catch {
    /* ignore */
  }
  startedThisVisit.clear();
}

function shouldAutoStart(id: TourId) {
  const p = prefs();
  if (!S.user || p.toursOff || p.tours?.[id] || startedThisVisit.has(id)) return false;
  if (S.auth?.legal?.needs?.length) return false; // the Terms come first
  if (S.modal || ctl?.isOpen) return false;
  const created = Date.parse(S.user.createdAt || '');
  return Number.isFinite(created) && created >= Date.parse(TOURS_SINCE);
}

/**
 * Starts the page's tour once, for new people, after the page has settled. `when`: wait until it
 * has content.
 */
export function useAutoTour(id: TourId, when = true) {
  useEffect(() => {
    if (!when) return;
    const t = setTimeout(() => {
      if (!shouldAutoStart(id)) return;
      startedThisVisit.add(id);
      startTour(id);
    }, 900);
    return () => clearTimeout(t);
  }, [id, when]);
}

function Bridge() {
  const t = useTour();
  const pathname = usePathname();
  useEffect(() => {
    ctl = t as unknown as Ctl;
  });
  // A tour belongs to its page: leaving the page ends it.
  useEffect(() => {
    if (ctl?.isOpen) ctl.setIsOpen(false);
  }, [pathname]);
  return null;
}

const btn = (cls: string, label: string, onClick: () => void) => (
  <button type="button" className={`btn sm ${cls}`} onClick={onClick}>
    {label}
  </button>
);

export function TourHost({ children }: { children: ReactNode }) {
  return (
    <TourProvider
      steps={[]}
      className="tour-pop"
      padding={{ mask: 6, popover: [10, 10] }}
      showBadge={false}
      showDots={false}
      scrollSmooth
      onClickMask={({ setIsOpen }) => setIsOpen(false)}
      beforeClose={() => {
        if (activeId) {
          const id = activeId;
          activeId = null;
          markDone(id);
        }
      }}
      accessibilityOptions={{
        ariaLabelledBy: 'tour',
        closeButtonAriaLabel: 'Close the tour',
        showNavigationScreenReaders: false,
      }}
      styles={{
        popover: (base) => ({
          ...base,
          background: 'var(--bg-raised, var(--bg))',
          color: 'var(--text)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-overlay, 0 12px 32px rgba(0,0,0,.2))',
          padding: '20px 20px 14px',
          maxWidth: 340,
          border: '1px solid var(--border)',
        }),
        maskWrapper: (base) => ({ ...base, color: '#000', opacity: 0.5 }),
        maskArea: (base) => ({ ...base, rx: 10 }),
        close: (base) => ({
          ...base,
          top: 14,
          right: 14,
          width: 10,
          height: 10,
          color: 'var(--text-subtle)',
        }),
        controls: (base) => ({ ...base, marginTop: 16, justifyContent: 'space-between' }),
      }}
      prevButton={({ currentStep, setCurrentStep, setIsOpen }) =>
        currentStep === 0
          ? btn('subtle', 'Skip tour', () => setIsOpen(false))
          : btn('subtle', 'Back', () => setCurrentStep((s) => s - 1))
      }
      nextButton={({ currentStep, stepsLength, setCurrentStep, setIsOpen }) =>
        currentStep >= stepsLength - 1
          ? btn('primary', 'Done', () => setIsOpen(false))
          : btn('primary', 'Next', () => setCurrentStep((s) => s + 1))
      }
    >
      <Bridge />
      {children}
    </TourProvider>
  );
}

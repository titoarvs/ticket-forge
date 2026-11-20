'use client';
import { useState, useEffect } from 'react';
import { DAYS, type TlEntry, CATS } from '@/lib/timeline';

export const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('en', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
export const dayShort = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('en', { day: 'numeric', month: 'short' });
export const dayNo = (d: string) => DAYS.findIndex((x) => x.date === d) + 1;
export const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
/** Counts up to `to` once, over about a second (straight to the number when motion is reduced). */
function useCountUp(to: number, run: boolean) {
  const [n, setN] = useState(to);
  useEffect(() => {
    if (!run || reduced()) {
      setN(to);
      return undefined;
    }
    let raf = 0;
    const t0 = performance.now();
    setN(0);
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 1000);
      setN(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, run]);
  return n;
}
export function Stat({ value, label, run }: { value: number; label: string; run: boolean }) {
  const n = useCountUp(value, run);
  return (
    <div className="pt-stat">
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}
export function Card({
  e,
  i,
  open,
  toggle,
}: {
  e: TlEntry;
  i: number;
  open: boolean;
  toggle: () => void;
}) {
  const c = CATS[e.cat];
  return (
    <article
      className="pt-card"
      data-reveal
      style={{ ['--c' as string]: c.color, ['--i' as string]: i % 5 } as React.CSSProperties}
    >
      <span className="pt-ico" aria-hidden>
        {c.icon}
      </span>
      <div className="pt-body">
        <div className="pt-meta">
          <span className="pt-cat">{c.label}</span>
          {(e.tags || []).map((t) => (
            <span key={t} className="pt-tag">
              {t}
            </span>
          ))}
        </div>
        <h3>{e.title}</h3>
        <p>{e.text}</p>
        {e.details && (
          <>
            <button type="button" className="pt-more" aria-expanded={open} onClick={toggle}>
              {open ? 'Hide details' : 'Details'}
              <i aria-hidden />
            </button>
            <div className={`pt-detail ${open ? 'open' : ''}`}>
              <div>
                <ul>
                  {e.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

'use client';
// The product timeline (/timeline): how TicketForge grew, day by day. Scroll-revealed cards on a line that fills as you
// read, a date rail that follows you (and becomes a swipeable bar on phones), filters, search, oldest/newest order,
// expandable details and j/k to hop between days. Everything is in the page for search engines and works without
// animation: with "reduce motion" on (or before scripts load) all cards simply show.
import { useEffect, useMemo, useRef, useState } from 'react';
import { TIMELINE, DAYS, CATS, type TlCat, type TlEntry } from '@/lib/timeline';

const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
const dayShort = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en', { day: 'numeric', month: 'short' });
const dayNo = (d: string) => DAYS.findIndex((x) => x.date === d) + 1;
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Counts up to `to` once, over about a second (straight to the number when motion is reduced). */
function useCountUp(to: number, run: boolean) {
  const [n, setN] = useState(to);
  useEffect(() => {
    if (!run || reduced()) { setN(to); return undefined; }
    let raf = 0; const t0 = performance.now();
    setN(0);
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / 1000); setN(Math.round(to * (1 - (1 - p) ** 3))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, run]);
  return n;
}

function Stat({ value, label, run }: { value: number; label: string; run: boolean }) {
  const n = useCountUp(value, run);
  return <div className="pt-stat"><b>{n}</b><span>{label}</span></div>;
}

function Card({ e, i, open, toggle }: { e: TlEntry; i: number; open: boolean; toggle: () => void }) {
  const c = CATS[e.cat];
  return (
    <article className="pt-card" data-reveal style={{ ['--c' as string]: c.color, ['--i' as string]: i % 5 } as React.CSSProperties}>
      <span className="pt-ico" aria-hidden>{c.icon}</span>
      <div className="pt-body">
        <div className="pt-meta"><span className="pt-cat">{c.label}</span>{(e.tags || []).map((t) => <span key={t} className="pt-tag">{t}</span>)}</div>
        <h3>{e.title}</h3>
        <p>{e.text}</p>
        {e.details && <>
          <button type="button" className="pt-more" aria-expanded={open} onClick={toggle}>{open ? 'Hide details' : 'Details'}<i aria-hidden /></button>
          <div className={`pt-detail ${open ? 'open' : ''}`}><div><ul>{e.details.map((d) => <li key={d}>{d}</li>)}</ul></div></div>
        </>}
      </div>
    </article>
  );
}

export function ProductTimeline() {
  const [cat, setCat] = useState<'all' | TlCat>('all');
  const [q, setQ] = useState('');
  const [newest, setNewest] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [active, setActive] = useState('');
  const [ready, setReady] = useState(false);
  const [top, setTop] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);

  const query = q.trim().toLowerCase();
  const visible = useMemo(() => TIMELINE.filter((e) => (cat === 'all' || e.cat === cat)
    && (!query || `${e.title} ${e.text} ${(e.tags || []).join(' ')} ${(e.details || []).join(' ')}`.toLowerCase().includes(query))), [cat, query]);
  const days = useMemo(() => {
    const ds = DAYS.map((d) => ({ ...d, items: visible.filter((e) => e.date === d.date) })).filter((d) => d.items.length);
    return newest ? [...ds].reverse() : ds;
  }, [visible, newest]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: TIMELINE.length };
    for (const e of TIMELINE) c[e.cat] = (c[e.cat] || 0) + 1;
    return c;
  }, []);
  const perDay = useMemo(() => DAYS.map((d) => ({ date: d.date, n: TIMELINE.filter((e) => e.date === d.date).length })), []);
  const maxDay = Math.max(...perDay.map((d) => d.n));
  const key = days.map((d) => d.date + d.items.length).join();

  useEffect(() => { setReady(true); }, []);

  // Cards and day headings glide in as they reach the screen.
  useEffect(() => {
    if (!ready) return undefined;
    const els = [...document.querySelectorAll<HTMLElement>('[data-reveal]:not(.in)')];
    if (reduced() || !('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('in')); return undefined; }
    const io = new IntersectionObserver((rows) => rows.forEach((r) => { if (r.isIntersecting) { r.target.classList.add('in'); io.unobserve(r.target); } }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ready, key]);

  // Which day you are reading, for the rail.
  useEffect(() => {
    if (!ready || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver((rows) => { for (const r of rows) if (r.isIntersecting) setActive((r.target as HTMLElement).dataset.date || ''); }, { rootMargin: '-30% 0px -60% 0px' });
    document.querySelectorAll('.pt-day').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ready, key]);

  // The line fills as you read; the back-to-top button appears after a while.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = listRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (innerHeight * 0.45 - r.top) / Math.max(1, r.height)));
      el.style.setProperty('--p', p.toFixed(4));
      railRef.current?.style.setProperty('--p', p.toFixed(4));
      setTop(scrollY > 700);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    addEventListener('scroll', on, { passive: true }); addEventListener('resize', on);
    return () => { removeEventListener('scroll', on); removeEventListener('resize', on); if (raf) cancelAnimationFrame(raf); };
  }, [key]);

  // On phones the rail is a bar: keep the day you are reading in view.
  useEffect(() => {
    const rail = railRef.current; if (!rail || rail.scrollWidth <= rail.clientWidth + 2) return;
    const chip = rail.querySelector<HTMLElement>(`[data-chip="${active}"]`); if (!chip) return;
    rail.scrollTo({ left: chip.offsetLeft - rail.clientWidth / 2 + chip.clientWidth / 2, behavior: reduced() ? 'auto' : 'smooth' });
  }, [active]);

  const jump = (date: string) => document.getElementById(`pt-${date}`)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  const step = (dir: 1 | -1) => { const i = days.findIndex((d) => d.date === active); const n = days[Math.max(0, Math.min(days.length - 1, (i < 0 ? 0 : i) + dir))]; if (n) jump(n.date); };
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey || (ev.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
      if (ev.key === 'j') step(1); else if (ev.key === 'k') step(-1);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  const allOpen = visible.filter((e) => e.details).every((e) => open.has(e.id));
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(visible.filter((e) => e.details).map((e) => e.id)));
  const last = DAYS[DAYS.length - 1].date;
  const now = <div className="pt-now" data-reveal><span className="pt-pulse" aria-hidden />Today · {dayShort(last)}<small>and still shipping</small></div>;
  const start = <div className="pt-now pt-start" data-reveal><span aria-hidden>🌱</span>{dayShort(DAYS[0].date)} · First commit</div>;

  return (
    <div className={`pt ${ready ? 'pt-js' : ''}`}>
      <header className="pt-hero">
        <p className="mk-eyebrow">Product timeline</p>
        <h1>How TicketForge grew, day by day</h1>
        <p className="mk-lead">From a document-to-backlog generator to AI agents that write code, in {DAYS.length} days. Scroll to follow the story, or jump to any day.</p>
        <div className="pt-stats">
          <Stat value={TIMELINE.length} label="features shipped" run={ready} />
          <Stat value={DAYS.length} label="days" run={ready} />
          <Stat value={Object.keys(CATS).length} label="areas" run={ready} />
        </div>
        <div className="pt-spark" role="group" aria-label="Features shipped per day">
          {perDay.map((d, i) => (
            <button key={d.date} type="button" className="pt-bar" onClick={() => jump(d.date)} title={`${dayLabel(d.date)}: ${d.n} features`} aria-label={`${dayLabel(d.date)}: ${d.n} features. Jump to this day`}
              style={{ ['--hn' as string]: Math.max(0.14, d.n / maxDay), ['--d' as string]: `${i * 70}ms` } as React.CSSProperties}><i /><span>{dayShort(d.date).replace(' Nov', '')}</span></button>
          ))}
        </div>
      </header>

      <div className="pt-tools">
        <div className="pt-chips" role="group" aria-label="Filter by area">
          <button type="button" className={cat === 'all' ? 'on' : ''} aria-pressed={cat === 'all'} onClick={() => setCat('all')}>All <em>{counts.all}</em></button>
          {(Object.keys(CATS) as TlCat[]).map((k) => (
            <button key={k} type="button" className={cat === k ? 'on' : ''} aria-pressed={cat === k} onClick={() => setCat(cat === k ? 'all' : k)} style={{ ['--c' as string]: CATS[k].color } as React.CSSProperties}>
              <i aria-hidden />{CATS[k].label} <em>{counts[k]}</em></button>
          ))}
        </div>
        <div className="pt-ctl">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search features" aria-label="Search features" />
          <button type="button" className="pt-btn" onClick={() => setNewest(!newest)} title="Change the order">{newest ? 'Newest first ↓' : 'Oldest first ↓'}</button>
          <button type="button" className="pt-btn" onClick={toggleAll}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
        </div>
      </div>

      <div className="pt-layout">
        <nav className="pt-rail" ref={railRef} aria-label="Jump to a day">
          {days.map((d) => (
            <button key={d.date} type="button" data-chip={d.date} className={active === d.date ? 'on' : ''} aria-current={active === d.date ? 'true' : undefined} onClick={() => jump(d.date)}>
              <i aria-hidden /><span><b>Day {dayNo(d.date)}</b><small>{dayShort(d.date)} · {d.items.length}</small></span></button>
          ))}
          {!days.length && <span className="pt-rail-none">No days</span>}
          <small className="pt-keys" aria-hidden>Tip: press <kbd>j</kbd> / <kbd>k</kbd></small>
        </nav>

        <div className="pt-list" ref={listRef}>
          {days.length > 0 && cat === 'all' && !query && (newest ? now : start)}
          {days.map((d) => (
            <section key={d.date} id={`pt-${d.date}`} className="pt-day" data-date={d.date} aria-labelledby={`pth-${d.date}`}>
              <div className="pt-day-h" data-reveal>
                <span className="pt-dot" aria-hidden />
                <div><span className="pt-daynum">Day {dayNo(d.date)} · {dayLabel(d.date)}</span><h2 id={`pth-${d.date}`}>{d.title}</h2><p>{d.blurb}</p></div>
              </div>
              <div className="pt-cards">{d.items.map((e, i) => <Card key={e.id} e={e} i={i} open={open.has(e.id)} toggle={() => setOpen((s) => { const n = new Set(s); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })} />)}</div>
            </section>
          ))}
          {days.length > 0 && cat === 'all' && !query && (newest ? start : now)}
          {!days.length && (
            <div className="pt-empty"><span aria-hidden>🔎</span><h3>Nothing matches</h3><p>Try another word, or show every area.</p>
              <button type="button" className="btn" onClick={() => { setCat('all'); setQ(''); }}>Clear filters</button></div>
          )}
        </div>
      </div>
      <button type="button" className={`pt-top ${top ? 'show' : ''}`} onClick={() => scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' })} aria-label="Back to the top">↑</button>
    </div>
  );
}

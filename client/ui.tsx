'use client';
// Small shared React components.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { I, typeIcon, priorityIcon } from './icons';
import { S, emit, closeModal, hashColor, initials, sCls, toast, dismissToast, type Any } from './core';

export { I };
const sized = (svg: string, size?: number) => (size ? svg.replace('width="16" height="16"', `width="${size}" height="${size}"`) : svg);
/** Renders one of the built-in SVG icons. */
export const Ico = ({ svg, size, className = '', style }: { svg: string; size?: number; className?: string; style?: Any }) => (
  <span className={`ico ${className}`} style={style} dangerouslySetInnerHTML={{ __html: sized(svg, size) }} />
);
export const TypeIcon = ({ type, size }: { type: string; size?: number }) => <Ico svg={typeIcon(type)} size={size} />;
export const PriorityIcon = ({ p }: { p: string }) => <Ico svg={priorityIcon(p)} />;

export function Avatar({ name, size = 24 }: { name?: string; size?: number }) {
  if (!name) return <span className="avatar none" style={{ width: size, height: size }} title="Unassigned"><Ico svg={I.user} /></span>;
  return <span className="avatar" style={{ background: hashColor(name), width: size, height: size, fontSize: size < 24 ? 9 : 10 }} title={name}>{initials(name)}</span>;
}
export const ELoz = ({ e }: { e: Any }) => (e ? <span className="eloz" style={{ ['--ec' as Any]: e.color }} title={e.title}>{e.title}</span> : null);
export const StatusLoz = ({ s }: { s: string }) => <span className={`loz ${sCls(s)}`}>{s}</span>;
/** Where an issue's implementation lives: frontend, backend or both (projects with a separate backend repository). */
export const LAYER_LABEL: Record<string, string> = { frontend: 'Frontend', backend: 'Backend', both: 'Frontend + Backend' };
export const LayerChip = ({ layer, short = false }: { layer?: string; short?: boolean }) => (layer && LAYER_LABEL[layer]
  ? <span className={`layer-chip l-${layer}`} title={`Implementation: ${LAYER_LABEL[layer]}`}>{short ? { frontend: 'FE', backend: 'BE', both: 'FE+BE' }[layer] : LAYER_LABEL[layer]}</span> : null);
export const Swatch = ({ color, style }: { color: string; style?: Any }) => <span className="bar-swatch" style={{ background: color, ...style }} />;
export { opts, MenuItem } from './fields';

/** A textarea that grows with its content. */
export function AutoTextarea({ value, max = 640, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { max?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight + 2, max)}px`;
  }, [value, max]);
  return <textarea ref={ref} value={value ?? ''} {...rest} />;
}

/** Dropdown menu that closes when you click elsewhere. `id` is shared through S.menu. */
export function Menu({ id, button, children, left = false, style }: { id: string; button: ReactNode; children: ReactNode; left?: boolean; style?: Any }) {
  const ref = useRef<HTMLDivElement>(null);
  const open = S.menu === id;
  useEffect(() => {
    if (!open) return undefined;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { S.menu = null; emit(); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref} style={style}>
      {button}
      {open && <div className={`menu ${left ? 'left' : ''}`} onClick={() => { S.menu = null; emit(); }}>{children}</div>}
    </div>
  );
}

export type Action = { label: string; onClick?: () => void; kind?: 'primary' | 'danger' | 'ai' | 'subtle'; disabled?: boolean; hidden?: boolean };
/** Dialog frame. Render it from a component passed to openModal(). */
/** persistent: clicking outside or pressing Escape doesn't close it (work in progress). */
export function Modal({ title, children, actions = [], wide = false, left, persistent = false }: { title: string; children: ReactNode; actions?: Action[]; wide?: boolean; left?: ReactNode; persistent?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !persistent) closeModal(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [persistent]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !persistent) closeModal(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h3>{title}</h3><button className="icon-btn" onClick={closeModal} aria-label="Close"><Ico svg={I.close} /></button></header>
        <div className="mb">{children}</div>
        <footer>
          {left && <div className="left">{left}</div>}
          {actions.filter((a) => !a.hidden).map((a) => (
            <button key={a.label} className={`btn ${a.kind || 'subtle'}`} disabled={a.disabled} onClick={a.onClick || closeModal}>{a.label}</button>
          ))}
        </footer>
      </div>
    </div>
  );
}
export function Confirm({ title, text, label, onYes }: { title: string; text: ReactNode; label: string; onYes: () => void | Promise<void> }) {
  return <Modal title={title} actions={[{ label: 'Cancel' }, { label, kind: 'danger', onClick: async () => { closeModal(); await onYes(); } }]}><p style={{ marginTop: 0 }}>{text}</p></Modal>;
}

const TOAST_ICON: Record<string, [string, string]> = { ok: ['check', 'Done'], err: ['warn', 'Error'], warn: ['warn', 'Warning'], info: ['bot', 'Note'] };
function ToastItem({ t }: { t: Any }) {
  const [ic, label] = TOAST_ICON[t.kind] || TOAST_ICON.ok;
  return (
    <div className={`toast ${t.kind}`} role={t.kind === 'err' ? 'alert' : 'status'}>
      <span className="toast-ic" aria-hidden><Ico svg={(I as Any)[ic]} /></span>
      <div className="toast-body">
        {t.title && <b className="toast-title">{t.title}</b>}
        <span className="toast-msg"><span className="sr-only">{label}: </span>{t.msg}</span>
        {t.action && <button className="toast-action" onClick={() => { t.action.onClick(); dismissToast(t.id); }}>{t.action.label}</button>}
      </div>
      {t.count > 1 && <span className="toast-count" title={`Shown ${t.count} times`}>×{t.count}</span>}
      <button className="toast-x" aria-label="Dismiss" onClick={() => dismissToast(t.id)}><Ico svg={I.close} /></button>
      {/* The bar empties over the toast's lifetime (paused while hovered); when it ends the toast goes. */}
      <span key={t.shownAt} className="toast-time" style={{ animationDuration: `${t.duration}ms` }} onAnimationEnd={() => dismissToast(t.id)} />
    </div>
  );
}
export function Toasts() {
  return <div id="toasts" aria-live="polite">{S.toasts.map((t: Any) => <ToastItem key={t.id} t={t} />)}</div>;
}

const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** Re-renders every second while `on`, for elapsed times. */
export function useTick(on = true) {
  const [, set] = useState(0);
  useEffect(() => { if (!on) return undefined; const h = setInterval(() => set((n) => n + 1), 1000); return () => clearInterval(h); }, [on]);
}
/** "1:24" since `since` (ms or ISO), updating every second. */
export function Elapsed({ since }: { since: number | string }) {
  useTick();
  return <span className="elapsed">{clock(Date.now() - new Date(since).getTime())}</span>;
}

/** The "Working on…" tray: AI work running in the background (lib: startTask / withBusy). */
export function TaskTray() {
  const [open, setOpen] = useState(true);
  const tasks: Any[] = S.tasks || [];
  const running = tasks.filter((t) => t.status === 'running');
  useTick(running.length > 0);
  if (!tasks.length) return null;
  const head = running.length ? `Working on ${running.length} task${running.length > 1 ? 's' : ''}` : 'All done';
  return (
    <section id="task-tray" className={open ? '' : 'closed'} aria-label="Background work">
      <button className="tray-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        {running.length ? <span className="spinner" /> : <Ico svg={I.check} className="tray-ok" />}
        <b>{head}</b><span className="spacer" />
        {!open && running[0] && <span className="muted small tray-peek">{running[0].label}</span>}
        <Ico svg={I.chevron} className={`tray-chev ${open ? "up" : ""}`} />
      </button>
      {open && <ul className="tray-list">{tasks.map((t) => {
        const pct = t.total ? Math.min(100, Math.round(((t.status === 'ok' ? t.total : t.done) / t.total) * 100)) : 0;
        return (
          <li key={t.id} className={`tray-item ${t.status}`}>
            <div className="tray-row">
              {t.status === 'ok' ? <Ico svg={I.check} className="tray-ok" /> : <span className="spinner" />}
              <div className="tray-text"><b>{t.label}</b>
                <span className="muted small">{t.status === 'ok' ? (t.message || 'Done') : t.detail || 'Starting…'}</span></div>
              <span className="muted small tray-time">{t.status === 'ok' ? clock((t.endedAt || Date.now()) - t.startedAt) : clock(Date.now() - t.startedAt)}</span>
              {t.cancel && t.status === 'running' && <button className="link-btn small" onClick={t.cancel}>Cancel</button>}
            </div>
            <div className={`tray-bar ${t.total ? '' : 'indeterminate'} ${t.status}`} role="progressbar" aria-label={t.label}
              aria-valuemin={0} aria-valuemax={t.total || undefined} aria-valuenow={t.total ? t.done : undefined}>
              <span style={t.total ? { width: `${t.status === 'ok' ? 100 : Math.max(pct, 4)}%` } : undefined} /></div>
            {t.total > 0 && t.status === 'running' && <span className="muted small tray-count">{t.done} of {t.total} done</span>}
          </li>
        );
      })}</ul>}
    </section>
  );
}
/** Kept for older imports: running work now shows in the tray. */
export const BusyPill = () => null;
export const Spinner = ({ style }: { style?: Any }) => <span className="spinner" style={{ color: 'var(--brand)', ...style }} />;

// ---------------------------------------------------------------- loading, empty and error states
/** A placeholder block that shimmers while content loads. Size it like the content it stands in for. */
export const Sk = ({ w, h = 12, r, style, className = '' }: { w?: number | string; h?: number | string; r?: number | string; style?: Any; className?: string }) => (
  <span className={`sk ${className}`} style={{ width: w ?? '100%', height: h, borderRadius: r, ...style }} aria-hidden="true" />
);
/** Wraps skeletons: tells screen readers something is loading, and fades in after a moment so quick loads don't flash. */
export function Loading({ label = 'Loading…', children, className = '', style }: { label?: string; children: ReactNode; className?: string; style?: Any }) {
  return <div className={`sk-wrap ${className}`} role="status" aria-busy="true" style={style}><span className="sr-only">{label}</span>{children}</div>;
}

export type Tone = 'brand' | 'ai' | 'danger' | 'neutral' | 'success' | 'epic';
/** A centred message for "nothing here yet" or "nothing matches", with an icon and the next thing to do. */
export function EmptyState({ icon, tone = 'brand', title, children, actions, compact = false, className = '' }: {
  icon?: string; tone?: Tone; title: ReactNode; children?: ReactNode; actions?: ReactNode; compact?: boolean; className?: string;
}) {
  return (
    <div className={`state ${compact ? 'compact' : ''} ${className}`}>
      {icon && <span className={`state-ic ${tone}`}><Ico svg={icon} size={compact ? 20 : 28} /></span>}
      <h3>{title}</h3>
      {children && <div className="state-body">{children}</div>}
      {actions && <div className="state-actions">{actions}</div>}
    </div>
  );
}

/** Something failed to load: says what, offers "Try again", and notices when the browser is offline. */
export function ErrorState({ title = 'Couldn’t load this', error, children, onRetry, actions, compact = false }: {
  title?: ReactNode; error?: Any; children?: ReactNode; onRetry?: () => unknown; actions?: ReactNode; compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const detail = typeof error === 'string' ? error : error?.message;
  const retry = async () => { setBusy(true); try { await onRetry?.(); } catch (e: Any) { toast(e?.message || String(e), 'err'); } finally { setBusy(false); } };
  return (
    <EmptyState icon={I.warn} tone="danger" compact={compact} title={offline ? 'You’re offline' : title}
      actions={(onRetry || actions) && <>
        {onRetry && <button className="btn primary" disabled={busy} onClick={retry}>{busy ? <><span className="spinner" />Trying again…</> : <><Ico svg={I.refresh} />Try again</>}</button>}
        {actions}
      </>}>
      {offline ? <p>Check your internet connection, then try again.</p> : children}
      {!offline && detail && <p className="state-detail">{detail}</p>}
    </EmptyState>
  );
}

/** A settings card: title, one-line explanation, optional actions on the right, then the content. */
export function SetCard({ title, desc, right, children, tone, id }: { title: React.ReactNode; desc?: React.ReactNode; right?: React.ReactNode; children?: React.ReactNode; tone?: 'danger'; id?: string }) {
  return (
    <section className={`set-card ${tone ? `tone-${tone}` : ''}`} id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      <header className="set-card-h"><div style={{ minWidth: 0 }}><h3 id={id ? `${id}-h` : undefined}>{title}</h3>{desc && <p>{desc}</p>}</div>{right && <div className="set-card-right">{right}</div>}</header>
      {children}
    </section>
  );
}

/** Which section of a long settings page is open; remembered per browser. */
export function useSection(key: string, keys: string[], dflt: string): [string, (k: string) => void] {
  const [v, setV] = useState(() => { try { const x = localStorage.getItem(key); return x && keys.includes(x) ? x : dflt; } catch { return dflt; } });
  const set = (k: string) => { setV(k); try { localStorage.setItem(key, k); } catch { /* private mode */ } };
  return [keys.includes(v) ? v : dflt, set];
}
/** Section navigation for a long settings page: a list on the left (a scrolling row on small screens). */
export function SectionNav({ items, value, onChange, label }: { items: { key: string; label: string; hint?: string; icon?: string; badge?: ReactNode }[]; value: string; onChange: (k: string) => void; label: string }) {
  return (
    <nav className="sec-nav" role="tablist" aria-label={label}>
      {items.map((x) => (
        <button key={x.key} type="button" role="tab" aria-selected={value === x.key} className={value === x.key ? 'on' : ''} onClick={() => onChange(x.key)}>
          {x.icon && <Ico svg={x.icon} />}<span className="sec-nav-t"><b>{x.label}{x.badge}</b>{x.hint && <span>{x.hint}</span>}</span>
        </button>))}
    </nav>
  );
}

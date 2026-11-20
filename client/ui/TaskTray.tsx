'use client';
import { useState, useEffect, type ReactNode } from 'react';
import { I } from '../icons';
import { type Any, S, toast } from '../core';
import { Ico } from './Modal';

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
/** Re-renders every second while `on`, for elapsed times. */
export function useTick(on = true) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const h = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, [on]);
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
  const head = running.length
    ? `Working on ${running.length} task${running.length > 1 ? 's' : ''}`
    : 'All done';
  return (
    <section id="task-tray" className={open ? '' : 'closed'} aria-label="Background work">
      <button className="tray-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        {running.length ? <span className="spinner" /> : <Ico svg={I.check} className="tray-ok" />}
        <b>{head}</b>
        <span className="spacer" />
        {!open && running[0] && <span className="muted small tray-peek">{running[0].label}</span>}
        <Ico svg={I.chevron} className={`tray-chev ${open ? 'up' : ''}`} />
      </button>
      {open && (
        <ul className="tray-list">
          {tasks.map((t) => {
            const pct = t.total
              ? Math.min(100, Math.round(((t.status === 'ok' ? t.total : t.done) / t.total) * 100))
              : 0;
            return (
              <li key={t.id} className={`tray-item ${t.status}`}>
                <div className="tray-row">
                  {t.status === 'ok' ? (
                    <Ico svg={I.check} className="tray-ok" />
                  ) : (
                    <span className="spinner" />
                  )}
                  <div className="tray-text">
                    <b>{t.label}</b>
                    <span className="muted small">
                      {t.status === 'ok' ? t.message || 'Done' : t.detail || 'Starting…'}
                    </span>
                  </div>
                  <span className="muted small tray-time">
                    {t.status === 'ok'
                      ? clock((t.endedAt || Date.now()) - t.startedAt)
                      : clock(Date.now() - t.startedAt)}
                  </span>
                  {t.cancel && t.status === 'running' && (
                    <button className="link-btn small" onClick={t.cancel}>
                      Cancel
                    </button>
                  )}
                </div>
                <div
                  className={`tray-bar ${t.total ? '' : 'indeterminate'} ${t.status}`}
                  role="progressbar"
                  aria-label={t.label}
                  aria-valuemin={0}
                  aria-valuemax={t.total || undefined}
                  aria-valuenow={t.total ? t.done : undefined}
                >
                  <span
                    style={
                      t.total
                        ? { width: `${t.status === 'ok' ? 100 : Math.max(pct, 4)}%` }
                        : undefined
                    }
                  />
                </div>
                {t.total > 0 && t.status === 'running' && (
                  <span className="muted small tray-count">
                    {t.done} of {t.total} done
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
export const Spinner = ({ style }: { style?: Any }) => (
  <span className="spinner" style={{ color: 'var(--brand)', ...style }} />
);
// ---------------------------------------------------------------- loading, empty and error states
/**
 * A placeholder block that shimmers while content loads. Size it like the content it stands in for.
 */
export const Sk = ({
  w,
  h = 12,
  r,
  style,
  className = '',
}: {
  w?: number | string;
  h?: number | string;
  r?: number | string;
  style?: Any;
  className?: string;
}) => (
  <span
    className={`sk ${className}`}
    style={{ width: w ?? '100%', height: h, borderRadius: r, ...style }}
    aria-hidden="true"
  />
);
/**
 * Wraps skeletons: tells screen readers something is loading, and fades in after a moment so quick
 * loads don't flash.
 */
export function Loading({
  label = 'Loading…',
  children,
  className = '',
  style,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
  style?: Any;
}) {
  return (
    <div className={`sk-wrap ${className}`} role="status" aria-busy="true" style={style}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
export type Tone = 'brand' | 'ai' | 'danger' | 'neutral' | 'success' | 'epic';
/**
 * A centred message for "nothing here yet" or "nothing matches", with an icon and the next thing to
 * do.
 */
export function EmptyState({
  icon,
  tone = 'brand',
  title,
  children,
  actions,
  compact = false,
  className = '',
}: {
  icon?: string;
  tone?: Tone;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={`state ${compact ? 'compact' : ''} ${className}`}>
      {icon && (
        <span className={`state-ic ${tone}`}>
          <Ico svg={icon} size={compact ? 20 : 28} />
        </span>
      )}
      <h3>{title}</h3>
      {children && <div className="state-body">{children}</div>}
      {actions && <div className="state-actions">{actions}</div>}
    </div>
  );
}
/**
 * Something failed to load: says what, offers "Try again", and notices when the browser is offline.
 */
export function ErrorState({
  title = 'Couldn’t load this',
  error,
  children,
  onRetry,
  actions,
  compact = false,
}: {
  title?: ReactNode;
  error?: Any;
  children?: ReactNode;
  onRetry?: () => unknown;
  actions?: ReactNode;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const detail = typeof error === 'string' ? error : error?.message;
  const retry = async () => {
    setBusy(true);
    try {
      await onRetry?.();
    } catch (e: Any) {
      toast(e?.message || String(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <EmptyState
      icon={I.warn}
      tone="danger"
      compact={compact}
      title={offline ? 'You’re offline' : title}
      actions={
        (onRetry || actions) && (
          <>
            {onRetry && (
              <button className="btn primary" disabled={busy} onClick={retry}>
                {busy ? (
                  <>
                    <span className="spinner" />
                    Trying again…
                  </>
                ) : (
                  <>
                    <Ico svg={I.refresh} />
                    Try again
                  </>
                )}
              </button>
            )}
            {actions}
          </>
        )
      }
    >
      {offline ? <p>Check your internet connection, then try again.</p> : children}
      {!offline && detail && <p className="state-detail">{detail}</p>}
    </EmptyState>
  );
}
/**
 * A settings card: title, one-line explanation, optional actions on the right, then the content.
 */
export function SetCard({
  title,
  desc,
  right,
  children,
  tone,
  id,
}: {
  title: React.ReactNode;
  desc?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
  tone?: 'danger';
  id?: string;
}) {
  return (
    <section
      className={`set-card ${tone ? `tone-${tone}` : ''}`}
      id={id}
      aria-labelledby={id ? `${id}-h` : undefined}
    >
      <header className="set-card-h">
        <div style={{ minWidth: 0 }}>
          <h3 id={id ? `${id}-h` : undefined}>{title}</h3>
          {desc && <p>{desc}</p>}
        </div>
        {right && <div className="set-card-right">{right}</div>}
      </header>
      {children}
    </section>
  );
}
/** Which section of a long settings page is open; remembered per browser. */
export function useSection(
  key: string,
  keys: string[],
  dflt: string,
): [string, (k: string) => void] {
  const [v, setV] = useState(() => {
    try {
      const x = localStorage.getItem(key);
      return x && keys.includes(x) ? x : dflt;
    } catch {
      return dflt;
    }
  });
  const set = (k: string) => {
    setV(k);
    try {
      localStorage.setItem(key, k);
    } catch {
      /* private mode */
    }
  };
  return [keys.includes(v) ? v : dflt, set];
}
/**
 * Section navigation for a long settings page: a list on the left (a scrolling row on small
 * screens).
 */
export function SectionNav({
  items,
  value,
  onChange,
  label,
}: {
  items: { key: string; label: string; hint?: string; icon?: string; badge?: ReactNode }[];
  value: string;
  onChange: (k: string) => void;
  label: string;
}) {
  return (
    <nav className="sec-nav" role="tablist" aria-label={label}>
      {items.map((x) => (
        <button
          key={x.key}
          type="button"
          role="tab"
          aria-selected={value === x.key}
          className={value === x.key ? 'on' : ''}
          onClick={() => onChange(x.key)}
        >
          {x.icon && <Ico svg={x.icon} />}
          <span className="sec-nav-t">
            <b>
              {x.label}
              {x.badge}
            </b>
            {x.hint && <span>{x.hint}</span>}
          </span>
        </button>
      ))}
    </nav>
  );
}

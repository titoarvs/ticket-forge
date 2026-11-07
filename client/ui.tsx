'use client';
// Small shared React components.
import { useEffect, useLayoutEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { I, typeIcon, priorityIcon } from './icons';
import { S, emit, closeModal, hashColor, initials, sCls, type Any } from './core';

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
export function Modal({ title, children, actions = [], wide = false, left }: { title: string; children: ReactNode; actions?: Action[]; wide?: boolean; left?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
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

export function Toasts() {
  return (
    <div id="toasts" role="status" aria-live="polite">
      {S.toasts.map((t: Any) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'err' ? <Ico svg={I.warn} style={{ color: 'var(--danger)' }} /> : <Ico svg={I.check} style={{ color: '#22a06b' }} />}
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
export const BusyPill = () => (S.busy ? <div id="busy"><span className="spinner" />{S.busy}</div> : null);
export const Spinner = ({ style }: { style?: Any }) => <span className="spinner" style={{ color: 'var(--brand)', ...style }} />;

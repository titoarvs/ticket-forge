'use client';
import {
  type TextareaHTMLAttributes,
  useRef,
  useLayoutEffect,
  type ReactNode,
  useEffect,
} from 'react';
import { typeIcon, priorityIcon, I } from '../icons';
import { type Any, hashColor, initials, sCls, S, emit, closeModal, dismissToast } from '../core';
import { AiRunPicker } from './AiRunPicker';

const sized = (svg: string, size?: number) =>
  size ? svg.replace('width="16" height="16"', `width="${size}" height="${size}"`) : svg;
/** Renders one of the built-in SVG icons. */
export const Ico = ({
  svg,
  size,
  className = '',
  style,
}: {
  svg: string;
  size?: number;
  className?: string;
  style?: Any;
}) => (
  <span
    className={`ico ${className}`}
    style={style}
    dangerouslySetInnerHTML={{ __html: sized(svg, size) }}
  />
);
export const TypeIcon = ({ type, size }: { type: string; size?: number }) => (
  <Ico svg={typeIcon(type)} size={size} />
);
export const PriorityIcon = ({ p }: { p: string }) => <Ico svg={priorityIcon(p)} />;
export function Avatar({ name, size = 24 }: { name?: string; size?: number }) {
  if (!name)
    return (
      <span className="avatar none" style={{ width: size, height: size }} title="Unassigned">
        <Ico svg={I.user} />
      </span>
    );
  return (
    <span
      className="avatar"
      style={{
        background: hashColor(name),
        width: size,
        height: size,
        fontSize: size < 24 ? 9 : 10,
      }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
export const ELoz = ({ e }: { e: Any }) =>
  e ? (
    <span className="eloz" style={{ ['--ec' as Any]: e.color }} title={e.title}>
      {e.title}
    </span>
  ) : null;
export const StatusLoz = ({ s }: { s: string }) => <span className={`loz ${sCls(s)}`}>{s}</span>;
/**
 * Where an issue's implementation lives: frontend, backend or both (projects with a separate
 * backend repository).
 */
export const LAYER_LABEL: Record<string, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  both: 'Frontend + Backend',
};
export const LayerChip = ({ layer, short = false }: { layer?: string; short?: boolean }) =>
  layer && LAYER_LABEL[layer] ? (
    <span className={`layer-chip l-${layer}`} title={`Implementation: ${LAYER_LABEL[layer]}`}>
      {short ? { frontend: 'FE', backend: 'BE', both: 'FE+BE' }[layer] : LAYER_LABEL[layer]}
    </span>
  ) : null;
export const Swatch = ({ color, style }: { color: string; style?: Any }) => (
  <span className="bar-swatch" style={{ background: color, ...style }} />
);
/** A textarea that grows with its content. */
export function AutoTextarea({
  value,
  max = 640,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { max?: number }) {
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
export function Menu({
  id,
  button,
  children,
  left = false,
  style,
}: {
  id: string;
  button: ReactNode;
  children: ReactNode;
  left?: boolean;
  style?: Any;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const open = S.menu === id;
  useEffect(() => {
    if (!open) return undefined;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        S.menu = null;
        emit();
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref} style={style}>
      {button}
      {open && (
        <div
          className={`menu ${left ? 'left' : ''}`}
          onClick={() => {
            S.menu = null;
            emit();
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
export type Action = {
  label: string;
  onClick?: () => void;
  kind?: 'primary' | 'danger' | 'ai' | 'subtle';
  disabled?: boolean;
  busy?: boolean;
  hidden?: boolean;
};
/** Dialog frame. Render it from a component passed to openModal(). */
/** persistent: clicking outside or pressing Escape doesn't close it (work in progress). */
export function Modal({
  title,
  children,
  actions = [],
  wide = false,
  left,
  persistent = false,
}: {
  title: string;
  children: ReactNode;
  actions?: Action[];
  wide?: boolean | 'xl';
  left?: ReactNode;
  persistent?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !persistent) closeModal();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [persistent]);
  return (
    <div
      className="modal-back"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !persistent) closeModal();
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''} ${wide === 'xl' ? 'xl' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h3>{title}</h3>
          <button className="icon-btn" onClick={closeModal} aria-label="Close">
            <Ico svg={I.close} />
          </button>
        </header>
        <div className="mb">{children}</div>
        <footer>
          {left && <div className="left">{left}</div>}
          {!left && actions.some((a) => a.kind === 'ai' && !a.hidden) && (
            <div className="left">
              <AiRunPicker />
            </div>
          )}
          {actions
            .filter((a) => !a.hidden)
            .map((a) => (
              <button
                key={a.label}
                className={`btn ${a.kind || 'subtle'}`}
                disabled={a.disabled || a.busy}
                aria-busy={a.busy || undefined}
                onClick={a.onClick || closeModal}
              >
                {a.busy && <span className="spinner" />}
                {a.label}
              </button>
            ))}
        </footer>
      </div>
    </div>
  );
}
export function Confirm({
  title,
  text,
  label,
  onYes,
}: {
  title: string;
  text: ReactNode;
  label: string;
  onYes: () => void | Promise<void>;
}) {
  return (
    <Modal
      title={title}
      actions={[
        { label: 'Cancel' },
        {
          label,
          kind: 'danger',
          onClick: async () => {
            closeModal();
            await onYes();
          },
        },
      ]}
    >
      <p style={{ marginTop: 0 }}>{text}</p>
    </Modal>
  );
}
const TOAST_ICON: Record<string, [string, string]> = {
  ok: ['check', 'Done'],
  err: ['warn', 'Error'],
  warn: ['warn', 'Warning'],
  info: ['bot', 'Note'],
};
function ToastItem({ t }: { t: Any }) {
  const [ic, label] = TOAST_ICON[t.kind] || TOAST_ICON.ok;
  return (
    <div className={`toast ${t.kind}`} role={t.kind === 'err' ? 'alert' : 'status'}>
      <span className="toast-ic" aria-hidden>
        <Ico svg={(I as Any)[ic]} />
      </span>
      <div className="toast-body">
        {t.title && <b className="toast-title">{t.title}</b>}
        <span className="toast-msg">
          <span className="sr-only">{label}: </span>
          {t.msg}
        </span>
        {t.action && (
          <button
            className="toast-action"
            onClick={() => {
              t.action.onClick();
              dismissToast(t.id);
            }}
          >
            {t.action.label}
          </button>
        )}
      </div>
      {t.count > 1 && (
        <span className="toast-count" title={`Shown ${t.count} times`}>
          ×{t.count}
        </span>
      )}
      <button className="toast-x" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
        <Ico svg={I.close} />
      </button>
      {/* The bar empties over the toast's lifetime (paused while hovered); when it ends the toast goes. */}
      <span
        key={t.shownAt}
        className="toast-time"
        style={{ animationDuration: `${t.duration}ms` }}
        onAnimationEnd={() => dismissToast(t.id)}
      />
    </div>
  );
}
export function Toasts() {
  return (
    <div id="toasts" aria-live="polite">
      {S.toasts.map((t: Any) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}

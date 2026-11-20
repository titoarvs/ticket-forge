'use client';
import { type Any, S, emit, setMenu, ticket, epic, saveUi } from '../core';
import { Menu, Ico, I, TypeIcon } from '../ui';
import { IssuePanel } from './IssuePanel';
import { EpicPanel } from './EpicPanel';

export const prCls = (s: string) =>
  (({ Open: 'pr-open', Merged: 'pr-merged', Declined: 'pr-declined', Draft: 'pr-draft' }) as Any)[
    s
  ] || 'pr-open';
const close = () => {
  S.drawer = null;
  S.full = false;
  emit();
};
export function Head({ crumb, menu }: { crumb: React.ReactNode; menu: React.ReactNode }) {
  return (
    <div className="dr-head">
      <div className="dr-crumb">{crumb}</div>
      <div className="spacer" />
      <Menu
        id="drawer"
        button={
          <button
            className="icon-btn"
            title="More actions"
            aria-label="More actions"
            onClick={() => setMenu('drawer')}
          >
            <Ico svg={I.more} />
          </button>
        }
      >
        {menu}
      </Menu>
      <button
        className="icon-btn"
        title={S.full ? 'Collapse' : 'Expand'}
        aria-label={S.full ? 'Collapse' : 'Expand'}
        onClick={() => {
          S.full = !S.full;
          emit();
        }}
      >
        <Ico svg={S.full ? I.collapse : I.expand} />
      </button>
      <button className="icon-btn" title="Close (Esc)" aria-label="Close" onClick={close}>
        <Ico svg={I.close} />
      </button>
    </div>
  );
}
export const Crumb = ({
  type,
  keyText,
  onClick,
}: {
  type: string;
  keyText: string;
  onClick?: () => void;
}) => (
  <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
    <TypeIcon type={type} />
    {onClick ? (
      <a className="key link" onClick={onClick}>
        {keyText}
      </a>
    ) : (
      <span className="key">{keyText}</span>
    )}
  </span>
);
export function Drawer() {
  const t = S.drawer?.kind === 'issue' ? ticket(S.drawer.id) : null;
  const e = S.drawer?.kind === 'epic' ? epic(S.drawer.id) : null;
  if (!t && !e) return null;
  return (
    <>
      {S.full && <div className="drawer-blanket" onClick={close} />}
      <aside
        className={`drawer ${S.full ? 'full' : ''} ${S.drawerW ? 'sized' : ''}`}
        style={S.drawerW ? { ['--drawer-w' as string]: `${S.drawerW}px` } : undefined}
      >
        {!S.full && <ResizeHandle />}
        {t ? <IssuePanel key={t.id} t={t} /> : <EpicPanel key={e.id} e={e} />}
      </aside>
    </>
  );
}
const DRAWER_MIN = 380;
/** Widest the panel may be: leave room for the list beside it. */
const drawerMax = (el: HTMLElement) =>
  Math.max(DRAWER_MIN, (el.parentElement?.clientWidth || window.innerWidth) - 360);
const setDrawerW = (w: number | null) => {
  S.drawerW = w;
  saveUi();
  emit();
};
/**
 * Drag the panel's left edge to resize it; double-click resets. Arrow keys work too when it has
 * focus.
 */
function ResizeHandle() {
  const start = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const handle = ev.currentTarget,
      aside = handle.parentElement as HTMLElement;
    const right = aside.getBoundingClientRect().right,
      max = drawerMax(aside);
    let w = aside.offsetWidth;
    handle.setPointerCapture(ev.pointerId);
    document.body.classList.add('resizing-x');
    aside.classList.add('sized');
    const move = (e: PointerEvent) => {
      w = Math.round(Math.min(max, Math.max(DRAWER_MIN, right - e.clientX)));
      aside.style.setProperty('--drawer-w', `${w}px`);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      document.body.classList.remove('resizing-x');
      setDrawerW(w);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };
  const key = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    ev.preventDefault();
    const aside = ev.currentTarget.parentElement as HTMLElement;
    const step = ev.shiftKey ? 80 : 20;
    setDrawerW(
      Math.min(
        drawerMax(aside),
        Math.max(DRAWER_MIN, aside.offsetWidth + (ev.key === 'ArrowLeft' ? step : -step)),
      ),
    );
  };
  return (
    <div
      className="drawer-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={start}
      onDoubleClick={() => setDrawerW(null)}
      onKeyDown={key}
    />
  );
}

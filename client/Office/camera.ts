// Agent Office: the camera. x, y is the world point at the centre of the stage and p the pixels
// per world unit; X, Y, Pp are where it's heading (it eases there each frame). Handles dragging,
// wheel and pinch zoom, clicking a bot, and keeps the canvas sized to the stage.
import type { Bot } from './bots';

type CamOpts = {
  selected: () => Bot | null;
  /** A click (not a drag) at a world point. */
  onTap: (wx: number, wy: number) => void;
  /** The pointer moved over (or, with null, left) the floor without a button down. */
  onHover: (w: [number, number] | null, sx: number, sy: number) => void;
  onUnfollow: () => void;
  /** The middle of the desks: where a narrow stage looks first. */
  focusX: number;
};

export function createCamera(cv: HTMLCanvasElement, stage: HTMLElement, o: CamOpts) {
  let W = 1;
  let H = 1;
  let DPR = 1;
  const cam = { x: 0, y: 0, p: 30, X: 0, Y: 0, Pp: 30 };

  const fit = () => {
    if (W < 640) return { x: o.focusX, y: -2, p: Math.max(Math.min(W / 33, H / 24.5), 24) };
    if (W > 900) {
      const p = Math.min((W - 320) / 33, (H - 90) / 24.5);
      return { x: 145 / p, y: -0.6, p };
    }
    return { x: 0, y: -0.9, p: Math.min(W / 33, H / 24.5) };
  };
  const overview = (snap: boolean) => {
    const f = fit();
    Object.assign(cam, { X: f.x, Y: f.y, Pp: f.p });
    if (snap) Object.assign(cam, { x: f.x, y: f.y, p: f.p });
  };
  const resize = () => {
    const r = stage.getBoundingClientRect();
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
  };
  resize();
  overview(true);
  const ro = new ResizeObserver(() => {
    resize();
    if (!o.selected()) overview(true);
  });
  ro.observe(stage);

  const minP = () => Math.min(W / 40, H / 30);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const zoomAt = (sx: number, sy: number, f: number) => {
    const np = Math.min(150, Math.max(minP(), cam.Pp * f));
    const wx = (sx - W / 2) / cam.Pp + cam.X;
    const wy = (sy - H / 2) / cam.Pp + cam.Y;
    cam.X = wx - (sx - W / 2) / np;
    cam.Y = wy - (sy - H / 2) / np;
    cam.Pp = np;
    o.onUnfollow();
  };
  const world = (sx: number, sy: number): [number, number] => [
    (sx - W / 2) / cam.p + cam.x,
    (sy - H / 2) / cam.p + cam.y,
  ];
  const pick = (sx: number, sy: number) => o.onTap(...world(sx, sy));

  const ptrs = new Map<number, { x: number; y: number }>();
  let down = false;
  let moved = 0;
  let pinch: number | null = null;
  const onDown = (e: PointerEvent) => {
    cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    down = true;
    moved = 0;
  };
  const onMove = (e: PointerEvent) => {
    const p = ptrs.get(e.pointerId);
    if (!p) {
      const [sx, sy] = local(e);
      return o.onHover(world(sx, sy), sx, sy);
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const [mx, my] = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      if (pinch) zoomAt(mx, my, d / pinch);
      pinch = d;
    }
    cam.X -= dx / cam.Pp / (ptrs.size || 1);
    cam.Y -= dy / cam.Pp / (ptrs.size || 1);
    if (moved > 6) o.onUnfollow();
  };
  const onUp = (e: PointerEvent) => {
    ptrs.delete(e.pointerId);
    pinch = null;
    if (down && moved < 6 && ptrs.size === 0) {
      const [sx, sy] = local(e);
      pick(sx, sy);
    }
    down = false;
  };
  const onLeave = () => o.onHover(null, 0, 0);
  const onCancel = (e: PointerEvent) => {
    ptrs.delete(e.pointerId);
    pinch = null;
  };
  // Inside the page a plain wheel scrolls the page; Ctrl/⌘ + wheel (and trackpad pinch) zooms.
  // In full screen the wheel always zooms.
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey && !document.fullscreenElement) return;
    e.preventDefault();
    const [sx, sy] = local(e);
    zoomAt(sx, sy, Math.exp(-Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0016));
  };
  const noMenu = (e: Event) => e.preventDefault();
  cv.addEventListener('contextmenu', noMenu);
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onCancel);
  cv.addEventListener('pointerleave', onLeave);
  cv.addEventListener('wheel', onWheel, { passive: false });

  return Object.assign(cam, {
    size: () => ({ W, H, DPR }),
    overview,
    aim: (x: number, y: number) => Object.assign(cam, { X: x, Y: y }),
    /** Look at a point, zoomed in at least to p. */
    focus: (x: number, y: number, p = 60) =>
      Object.assign(cam, { X: x, Y: y, Pp: Math.max(cam.Pp, Math.min(p, 150)) }),
    zoomIn: () => (cam.Pp = Math.max(cam.Pp, W < 640 ? 48 : 70)),
    step: (dt: number) => {
      cam.X = Math.max(-16, Math.min(16, cam.X));
      cam.Y = Math.max(-12.5, Math.min(11, cam.Y));
      const k = 1 - Math.exp(-dt * 9);
      cam.x += (cam.X - cam.x) * k;
      cam.y += (cam.Y - cam.y) * k;
      cam.p += (cam.Pp - cam.p) * k;
    },
    destroy: () => {
      ro.disconnect();
      cv.removeEventListener('contextmenu', noMenu);
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onCancel);
      cv.removeEventListener('pointerleave', onLeave);
      cv.removeEventListener('wheel', onWheel);
    },
  });
}
export type Camera = ReturnType<typeof createCamera>;

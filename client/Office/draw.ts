// Agent Office: the drawing state shared by the office's parts (the canvas, the palette, the time)
// and the primitives everything is drawn with. World units: x across, z into the room; a height h
// above the floor is drawn h·K higher on screen (the ¾ view).
export const PI = Math.PI;
export const K = 0.6;

export const NIGHT = {
  bg: '#06080d',
  floor: '#181b21',
  grid: 'rgba(255,255,255,.035)',
  slab: '#0c0e12',
  wall: '#1d2027',
  wallT: '#2b2f37',
  oakT: '#94663f',
  oakF: '#5f3f28',
  walT: '#4a2f22',
  walF: '#33201a',
  whT: '#e9ecf0',
  whF: '#aeb4bd',
  dkT: '#1b1e24',
  dkF: '#101216',
  metal: '#7d8691',
  fabT: '#2f5a66',
  fabF: '#21434c',
  fab2T: '#c8b8a2',
  fab2F: '#9c8c77',
  rug: '#252b36',
  rug2: '#2a2533',
  leaf: '#2f7d4f',
  leaf2: '#3f9a63',
  potT: '#d9d3c9',
  potF: '#aaa398',
  glass: 'rgba(160,215,255,.06)',
  glassL: 'rgba(190,230,255,.35)',
  G: 1,
  sh: 0.42,
  screenDim: 0.62,
};
export type Pal = typeof NIGHT;
export const DAY: Pal = {
  bg: '#c9d3dd',
  floor: '#d3d0ca',
  grid: 'rgba(0,0,0,.05)',
  slab: '#9aa3ad',
  wall: '#e7e3dd',
  wallT: '#f4f1ec',
  oakT: '#c4935f',
  oakF: '#9a6d44',
  walT: '#7a5038',
  walF: '#5c3a28',
  whT: '#ffffff',
  whF: '#d4d9df',
  dkT: '#3a3f47',
  dkF: '#262a30',
  metal: '#9aa3ad',
  fabT: '#3f7480',
  fabF: '#2f5a63',
  fab2T: '#e6dccd',
  fab2F: '#c7b9a6',
  rug: '#b9bfc8',
  rug2: '#c6bdb3',
  leaf: '#3c9460',
  leaf2: '#55b077',
  potT: '#f2eee8',
  potF: '#cfc8bd',
  glass: 'rgba(150,200,240,.16)',
  glassL: 'rgba(80,120,160,.45)',
  G: 0.3,
  sh: 0.22,
  screenDim: 0.45,
};

/** What the current frame draws with. The engine sets it at the start of every frame. */
export const R = {
  ctx: null as unknown as CanvasRenderingContext2D,
  P: NIGHT,
  night: true,
  simT: 0,
  reduce: false,
};

export function mk(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d') as CanvasRenderingContext2D, w, h);
  return c;
}

export function rr(x: number, y: number, w: number, h: number, r: number) {
  const { ctx } = R;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

const glowCache: Record<string, HTMLCanvasElement> = {};
function glowSprite(c: string) {
  return (glowCache[c] ||= mk(128, 128, (g, w) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, c);
    r.addColorStop(0.35, c + '66');
    r.addColorStop(1, c + '00');
    g.fillStyle = r;
    g.fillRect(0, 0, w, w);
  }));
}

/** A soft additive light; c is a #rrggbb colour, sy squashes it vertically. */
export function glow(x: number, y: number, r: number, c: string, a: number, sy = 1) {
  const { ctx, P } = R;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, a * P.G);
  ctx.drawImage(glowSprite(c), x - r, y - r * sy, r * 2, r * 2 * sy);
  ctx.restore();
}

/** A box from (x0,z0) to (x1,z1), h tall, standing y0 above the floor. */
export function block(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  h: number,
  top: string,
  front: string,
  y0 = 0,
) {
  const { ctx } = R;
  const yt = y0 + h;
  ctx.fillStyle = front;
  ctx.fillRect(x0, z1 - yt * K, x1 - x0, h * K);
  ctx.fillStyle = top;
  ctx.fillRect(x0, z0 - yt * K, x1 - x0, z1 - z0);
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  ctx.fillRect(x0, z1 - yt * K - 0.012, x1 - x0, 0.024);
}

export function cylinder(
  x: number,
  z: number,
  r: number,
  h: number,
  top: string,
  side: string,
  y0 = 0,
) {
  const { ctx } = R;
  const yb = z - y0 * K;
  const yt = z - (y0 + h) * K;
  ctx.fillStyle = side;
  ctx.beginPath();
  ctx.arc(x, yb, r, 0, PI * 2);
  ctx.fill();
  ctx.fillRect(x - r, yt, r * 2, yb - yt);
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.arc(x, yt, r, 0, PI * 2);
  ctx.fill();
}

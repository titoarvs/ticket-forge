// Agent Office: the furniture. Each piece adds its floor shadow, any light pool it casts, and a
// prop: a draw call sorted by its front edge (k), so nearer things are drawn over farther ones.
import { R, K, PI, block, cylinder, glow } from './draw';
import { CORE, type Layout } from './layout';
import type { Bot } from './bots';
import { drawCore } from './scene';

type Prop = { k: number; d: () => void };
export type World = {
  L: Layout;
  bots: Bot[];
  shadows: number[][];
  pools: [number, number, number, string, number][];
  props: Prop[];
  leds: number[];
  kanC: HTMLCanvasElement;
  boardC: HTMLCanvasElement;
};

export const LEDC = ['#39d98a', '#3ee0ff', '#ffb547', '#111418'];

const prop = (w: World, k: number, d: () => void) => w.props.push({ k, d });
const shR = (w: World, x0: number, z0: number, x1: number, z1: number) =>
  w.shadows.push([0, x0, z0, x1, z1]);
const shC = (w: World, x: number, z: number, r: number) => w.shadows.push([1, x, z, r]);

function drawDesk(b: Bot) {
  const { ctx, P } = R;
  const { x, z } = b.desk;
  ctx.fillStyle = P.metal;
  ctx.fillRect(x - 0.9, z + 0.475 - 0.72 * K, 0.05, 0.72 * K);
  ctx.fillRect(x + 0.85, z + 0.475 - 0.72 * K, 0.05, 0.72 * K);
  block(x - 0.95, z - 0.475, x + 0.95, z + 0.475, 0.05, P.oakT, P.oakF, 0.72);
  ctx.fillStyle = P.metal;
  ctx.fillRect(x - 0.03, z - 0.3 - 0.95 * K, 0.06, 0.2 * K);
  block(x - 0.53, z - 0.36, x + 0.53, z - 0.3, 0.62, P.dkT, P.dkF, 0.84);
  const sx = x - 0.49;
  const sy = z - 0.3 - 1.43 * K;
  const sw = 0.98;
  const sh = 0.55 * K;
  ctx.drawImage(b.code, 0, ((b.scroll * 200) | 0) % 200, 200, 69, sx, sy, sw, sh);
  if (b.state !== 'work') {
    ctx.fillStyle = b.state === 'off' ? 'rgba(0,0,0,.85)' : `rgba(0,0,0,${P.screenDim})`;
    ctx.fillRect(sx, sy, sw, sh);
  } else glow(x, sy + sh / 2, 0.75, b.color, 0.22, 0.6);
  ctx.fillStyle = P.whT;
  ctx.fillRect(x - 0.32, z + 0.05 - 0.77 * K, 0.5, 0.15);
  cylinder(x + 0.62, z + 0.12, 0.045, 0.1, P.whT, P.whF, 0.77);
}

function addDesk(w: World, b: Bot) {
  const { x, z } = b.desk;
  shR(w, x - 0.95, z - 0.475, x + 0.95, z + 0.475);
  w.pools.push([x, z + 0.2, 1.1, b.color, 0.18]);
  w.pools.push([x, z - 0.2, 2.2, '#ffe2c0', 0.22]);
  prop(w, z + 0.475, () => drawDesk(b));
}

function plant(w: World, x: number, z: number, s: number) {
  shC(w, x, z, 0.3 * s);
  const leaves = [
    [0, 0.95, 0.3],
    [-0.17, 0.78, 0.22],
    [0.18, 0.8, 0.23],
    [-0.06, 1.2, 0.2],
    [0.12, 1.1, 0.19],
  ];
  prop(w, z + 0.2 * s, () => {
    const { ctx, P } = R;
    cylinder(x, z, 0.22 * s, 0.48 * s, P.potT, P.potF);
    leaves.forEach(([dx, h, r], i) => {
      ctx.fillStyle = i % 2 ? P.leaf : P.leaf2;
      ctx.beginPath();
      ctx.arc(x + dx * s, z - h * s * K - 0.05, r * s, 0, PI * 2);
      ctx.fill();
    });
  });
}

function chair(w: World, x: number, z: number) {
  shC(w, x, z, 0.28);
  prop(w, z + 0.25, () => {
    const { ctx, P } = R;
    ctx.fillStyle = P.metal;
    ctx.fillRect(x - 0.02, z - 0.45 * K, 0.04, 0.45 * K);
    block(x - 0.25, z - 0.25, x + 0.25, z + 0.25, 0.07, P.fabT, P.fabF, 0.45);
  });
}

function addServers(w: World) {
  [-14.3, -13.3, -12.3].forEach((x, ri) => {
    shR(w, x - 0.45, -9.95, x + 0.45, -9.05);
    prop(w, -9.05, () => {
      const { ctx, P } = R;
      block(x - 0.45, -9.95, x + 0.45, -9.05, 2.1, P.dkT, P.dkF);
      const fy = -9.05 - 2.1 * K;
      for (let r = 0; r < 14; r++)
        for (let c = 0; c < 6; c++) {
          ctx.fillStyle = LEDC[w.leds[ri * 84 + r * 6 + c]];
          ctx.fillRect(x - 0.33 + c * 0.12, fy + 0.1 + r * 0.08, 0.06, 0.025);
        }
      ctx.fillStyle = '#3ee0ff';
      ctx.fillRect(x - 0.45, -9.95 - 2.1 * K, 0.9, 0.03);
    });
  });
  w.pools.push([-12.3, -8.6, 2.2, '#3ee0ff', 0.25]);
}

function glassPane(x0: number, x1: number) {
  const { ctx, P } = R;
  const top = -4.2 - 2.9 * K;
  ctx.fillStyle = P.glass;
  ctx.fillRect(x0, top, x1 - x0, 2.9 * K);
  ctx.strokeStyle = P.glassL;
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.moveTo(x0, top);
  ctx.lineTo(x1, top);
  ctx.stroke();
  ctx.lineWidth = 0.015;
  ctx.beginPath();
  ctx.moveTo(x0, -4.2);
  ctx.lineTo(x1, -4.2);
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, top, x1 - x0, 2.9 * K);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,.07)';
  ctx.lineWidth = 0.12;
  for (let x = x0 + 0.4; x < x1 + 1; x += 1.4) {
    ctx.beginPath();
    ctx.moveTo(x, -4.2);
    ctx.lineTo(x + 0.9, top);
    ctx.stroke();
  }
  ctx.restore();
}

function meetingWalls() {
  const { ctx, P } = R;
  glassPane(6, 8);
  glassPane(9.4, 13.5);
  ctx.fillStyle = P.dkF;
  [6, 8, 9.4, 13.5].forEach((x) => ctx.fillRect(x - 0.03, -4.2 - 2.9 * K, 0.06, 2.9 * K));
  ctx.strokeStyle = P.glassL;
  ctx.lineWidth = 0.03;
  [6, 13.5].forEach((x) => {
    ctx.beginPath();
    ctx.moveTo(x, -10 - 2.9 * K);
    ctx.lineTo(x, -4.2 - 2.9 * K);
    ctx.stroke();
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(x, -10);
    ctx.lineTo(x, -4.2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

function meetingTable() {
  const { ctx, P } = R;
  cylinder(9.75, -6.9, 0.14, 0.72, P.metal, P.metal);
  cylinder(9.75, -6.9, 1.1, 0.05, P.walT, P.walF, 0.72);
  const ty = -6.9 - 0.77 * K;
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.arc(9.75, ty, 1.0, 0, PI * 2);
  ctx.stroke();
  for (const [x, y] of [
    [9.75, ty + 0.62],
    [9.0, ty - 0.25],
    [10.5, ty - 0.25],
  ]) {
    ctx.fillStyle = P.dkT;
    ctx.fillRect(x - 0.18, y - 0.11, 0.36, 0.22);
    ctx.fillStyle = '#3ee0ff';
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x - 0.15, y - 0.08, 0.3, 0.12);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = P.whT;
  ctx.fillRect(9.55, ty - 0.05, 0.4, 0.28);
}

function addMeeting(w: World) {
  shC(w, 9.75, -6.9, 1.15);
  prop(w, -5.8, meetingTable);
  [225, 270, 315].forEach((a) => {
    const r = (a * PI) / 180;
    chair(w, 9.75 + Math.cos(r) * 1.55, -6.9 + Math.sin(r) * 1.55);
  });
  w.pools.push([9.75, -6.9, 2.6, '#ffe2c0', 0.25]);
  prop(w, -4.2, meetingWalls);
}

function sofa() {
  const { P } = R;
  block(7.8, 4.85, 11.4, 5.15, 0.92, P.fabT, P.fabF);
  block(7.8, 5.1, 11.4, 5.95, 0.42, P.fabT, P.fabF);
  [8.4, 9.6, 10.8].forEach((x) =>
    block(x - 0.55, 5.15, x + 0.55, 5.85, 0.12, P.fab2T, P.fab2F, 0.42),
  );
  block(7.55, 4.85, 7.85, 5.95, 0.62, P.fabT, P.fabF);
  block(11.35, 4.85, 11.65, 5.95, 0.62, P.fabT, P.fabF);
}

function addLounge(w: World) {
  shR(w, 7.6, 4.8, 11.6, 6);
  prop(w, 6, sofa);
  shC(w, 9.6, 7, 0.65);
  prop(w, 7.3, () => {
    const { ctx, P } = R;
    cylinder(9.6, 7, 0.18, 0.36, P.metal, P.metal);
    cylinder(9.6, 7, 0.62, 0.04, P.walT, P.walF, 0.36);
    cylinder(9.35, 6.95, 0.05, 0.08, P.whT, P.whF, 0.4);
    ctx.fillStyle = '#c9a46b';
    ctx.fillRect(9.75, 6.85 - 0.42 * K, 0.28, 0.2);
  });
  for (const [x, z] of [
    [7, 7],
    [12.2, 7],
  ]) {
    shR(w, x - 0.43, z - 0.43, x + 0.43, z + 0.43);
    const bx = x - 0.43 + (x < 9 ? 0 : 0.68);
    prop(w, z + 0.43, () => {
      const { P } = R;
      block(x - 0.43, z - 0.43, x + 0.43, z + 0.43, 0.4, P.fab2T, P.fab2F);
      block(bx, z - 0.43, bx + 0.18, z + 0.43, 0.85, P.fab2T, P.fab2F);
    });
  }
  shC(w, 7.1, 4.6, 0.25);
  prop(w, 4.7, () => {
    R.ctx.fillStyle = R.P.metal;
    R.ctx.fillRect(7.09, 4.6 - 1.6 * K, 0.025, 1.6 * K);
    cylinder(7.1, 4.6, 0.22, 0.3, '#ffe6c4', '#e9c896', 1.55);
  });
  w.pools.push([7.1, 4.9, 1.8, '#ffc890', 0.35]);
}

function addCoffee(w: World) {
  shR(w, 13.35, -1.4, 14.45, 1.8);
  prop(w, 1.8, () => {
    const { ctx, P } = R;
    block(13.35, -1.4, 14.45, 1.8, 1.0, P.walT, P.walF);
    block(13.3, -1.45, 14.5, 1.85, 0.04, P.whT, P.whF, 1.0);
    block(13.7, -0.95, 14.2, -0.5, 0.42, P.metal, '#5d656e', 1.04);
    ctx.fillStyle = '#ffb547';
    ctx.fillRect(13.75, -0.5 - 1.35 * K, 0.4, 0.03);
    [0.3, 0.7, 1.1].forEach((z) => cylinder(13.6, z, 0.05, 0.1, P.whT, P.whF, 1.04));
  });
  w.pools.push([13.2, -0.4, 1.4, '#ffb547', 0.25]);
}

function sideWalls() {
  const { ctx, P } = R;
  ctx.fillStyle = P.wallT;
  ctx.fillRect(-15.35, -10.3 - 3.4 * K, 0.35, 20.3);
  ctx.fillStyle = P.wall;
  ctx.fillRect(-15.35, 10 - 3.4 * K, 0.35, 3.4 * K);
  ctx.strokeStyle = P.glassL;
  ctx.lineWidth = 0.04;
  ctx.beginPath();
  ctx.moveTo(15, -10 - 1.1 * K);
  ctx.lineTo(15, 10 - 1.1 * K);
  ctx.stroke();
  ctx.fillStyle = P.glass;
  ctx.fillRect(14.98, 10 - 1.1 * K, 0.06, 1.1 * K);
}

const PLANTS = [
  [-9.4, -9.4, 1.1],
  [-2.3, -9.4, 1],
  [2.6, -9.3, 1.2],
  [4.9, -9.3, 1.3],
  [5.4, 9.2, 1.2],
  [14.3, 9.2, 1.3],
  [14.3, -3, 1],
  [6.4, -1, 1],
  [0.8, 9.2, 1.1],
];

export function buildWorld(
  L: Layout,
  bots: Bot[],
  kanC: HTMLCanvasElement,
  boardC: HTMLCanvasElement,
): World {
  const w: World = { L, bots, shadows: [], pools: [], props: [], leds: [], kanC, boardC };
  w.leds = [...Array(3 * 6 * 14)].map(() => (Math.random() * 3) | 0);
  bots.forEach((b) => addDesk(w, b));
  addServers(w);
  addMeeting(w);
  addLounge(w);
  addCoffee(w);
  shC(w, CORE[0], CORE[1], 1);
  w.pools.push([CORE[0], CORE[1], 3, '#3ee0ff', 0.4]);
  prop(w, CORE[1], () => drawCore(w));
  PLANTS.forEach(([x, z, s]) => plant(w, x, z, s));
  prop(w, 99, sideWalls);
  return w;
}

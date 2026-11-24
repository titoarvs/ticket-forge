// Agent Office: the parts drawn in fixed layers around the sorted props: the floor (rugs,
// shadows, light pools), the back wall (windows and boards), the lamps overhead, and the
// orchestrator core in the middle of the floor.
import { R, K, PI, cylinder, glow, rr } from './draw';
import { CORE } from './layout';
import { skylines } from './art';
import type { World } from './world';

const ico = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map((p) => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return p.map((c) => (c / l) * 0.62);
  });
  const e: [number, number][] = [];
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++)
      if (Math.hypot(v[i][0] - v[j][0], v[i][1] - v[j][1], v[i][2] - v[j][2]) < 0.7) e.push([i, j]);
  return { v, e };
})();

export function drawCore(w: World) {
  const { ctx, P, simT } = R;
  const [x0, z0] = CORE;
  cylinder(x0, z0, 0.9, 0.45, P.dkT, P.dkF);
  ctx.strokeStyle = '#3ee0ff';
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  ctx.arc(x0, z0 - 0.45 * K, 0.82, 0, PI * 2);
  ctx.stroke();
  const cx = x0;
  const cy = z0 - 1.6 * K;
  const a = simT * 0.5;
  const b = simT * 0.31;
  glow(cx, cy, 1.4, '#3ee0ff', 0.55);
  const pts = ico.v.map(([x, y, z]) => {
    const x1 = x * Math.cos(a) + z * Math.sin(a);
    let z1 = -x * Math.sin(a) + z * Math.cos(a);
    const y1 = y * Math.cos(b) - z1 * Math.sin(b);
    z1 = y * Math.sin(b) + z1 * Math.cos(b);
    return [cx + x1, cy - y1 * 0.9 + z1 * 0.25];
  });
  ctx.strokeStyle = 'rgba(120,235,255,.85)';
  ctx.lineWidth = 0.018;
  ctx.beginPath();
  for (const [i, j] of ico.e) {
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[j][0], pts[j][1]);
  }
  ctx.stroke();
  ctx.fillStyle = '#d8fbff';
  ctx.beginPath();
  ctx.arc(cx, cy, 0.16, 0, PI * 2);
  ctx.fill();
  const on = w.bots.filter((bt) => bt.state !== 'off');
  on.forEach((bt, i) => {
    const t = simT * 0.8 + (i * PI * 2) / on.length;
    ctx.fillStyle = bt.color;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(t) * 0.95,
      cy + Math.sin(t) * 0.3 - Math.sin(t * 1.3) * 0.15,
      0.06,
      0,
      PI * 2,
    );
    ctx.fill();
  });
}

function shadows(w: World) {
  const { ctx, P } = R;
  for (const s of w.shadows)
    for (const [e, a] of [
      [0.16, 0.12],
      [0.07, 0.18],
      [0, 0.28],
    ]) {
      ctx.fillStyle = `rgba(0,0,0,${a * P.sh})`;
      if (s[0]) {
        ctx.beginPath();
        ctx.arc(s[1] + 0.08, s[2] + 0.06, s[3] + e, 0, PI * 2);
        ctx.fill();
      } else {
        rr(s[1] - e + 0.08, s[2] - e + 0.06, s[3] - s[1] + e * 2, s[4] - s[2] + e * 2, 0.1 + e);
        ctx.fill();
      }
    }
}

export function drawGround(w: World) {
  const { ctx, P } = R;
  ctx.fillStyle = P.slab;
  ctx.fillRect(-15.35, 10, 30.7, 0.5);
  ctx.fillStyle = P.floor;
  ctx.fillRect(-15, -10, 30, 20);
  ctx.strokeStyle = P.grid;
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  for (let x = -15; x <= 15; x += 2.5) {
    ctx.moveTo(x, -10);
    ctx.lineTo(x, 10);
  }
  for (let z = -10; z <= 10; z += 2.5) {
    ctx.moveTo(-15, z);
    ctx.lineTo(15, z);
  }
  ctx.stroke();
  ctx.fillStyle = P.rug;
  rr(6.1, -9.6, 7.3, 5.3, 0.15);
  ctx.fill();
  ctx.fillStyle = P.rug2;
  rr(6.6, 4.3, 6.2, 5.1, 0.3);
  ctx.fill();
  ctx.fillStyle = P.rug;
  rr(-15, -9.95, 4, 2.6, 0.1);
  ctx.fill();
  for (const b of w.bots) {
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = b.state === 'work' ? 0.8 : b.state === 'off' ? 0.15 : 0.3;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.arc(b.seat[0], b.seat[1], 0.42, 0, PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  shadows(w);
  for (const [x, z, r, c, a] of w.pools) glow(x, z, r, c, a);
}

export function drawWall(w: World) {
  const { ctx, P } = R;
  const top = -10 - 3.4 * K;
  ctx.fillStyle = P.wallT;
  ctx.fillRect(-15.35, top - 0.3, 30.7, 0.3);
  ctx.fillStyle = P.wall;
  ctx.fillRect(-15.35, top, 30.7, 3.4 * K);
  const sky = R.night ? skylines().n : skylines().d;
  const S = 120;
  const wy0 = -10 - 3.25 * K;
  const wh = 3.05 * K;
  for (let x = -15; x < 15; x += 2.5) {
    if (x >= -10 && x < -2.5) continue;
    ctx.drawImage(sky, (x + 15) * S, (wy0 - top) * S, 2.5 * S, wh * S, x, wy0, 2.5, wh);
  }
  ctx.fillStyle = P.dkF;
  for (let x = -15; x <= 15.01; x += 2.5) ctx.fillRect(x - 0.05, top, 0.1, 3.4 * K);
  ctx.fillRect(-15.35, -10 - 0.15 * K, 30.7, 0.15 * K);
  ctx.fillRect(-15.35, top, 30.7, 0.06);
  ctx.fillRect(-8.9, -10 - 3.15 * K, 5.8, 2.45 * K);
  ctx.drawImage(w.kanC, -8.85, -10 - 3.1 * K, 5.7, 2.35 * K);
  glow(-6, -10 - 2 * K, 3, '#9fd8ff', 0.12, 0.4);
  ctx.fillRect(8.45, -10 - 2.75 * K, 2.7, 1.7 * K);
  ctx.drawImage(w.boardC, 8.5, -10 - 2.7 * K, 2.6, 1.6 * K);
}

export function drawOverhead(w: World) {
  const { ctx, night } = R;
  const { xs, rows } = w.L;
  const x0 = xs[0] - 1;
  const x1 = xs[xs.length - 1] + 1;
  for (const z of rows) {
    const y = z - 3.05 * K;
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 0.015;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, y);
    ctx.lineTo(x0 + 0.5, y - 0.6);
    ctx.moveTo(x1 - 0.5, y);
    ctx.lineTo(x1 - 0.5, y - 0.6);
    ctx.stroke();
    ctx.fillStyle = night ? '#fff3e2' : '#e8e4dd';
    rr(x0, y - 0.04, x1 - x0, 0.08, 0.04);
    ctx.fill();
    for (const x of xs) glow(x, y, 1.1, '#ffe2c0', 0.45, 0.45);
  }
  const my = -6.9 - 2.6 * K;
  ctx.strokeStyle = night ? '#fff3e2' : '#d6d0c6';
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.arc(9.75, my, 0.9, 0, PI * 2);
  ctx.stroke();
  glow(9.75, my, 1.6, '#ffe2c0', 0.35, 0.6);
  glow(7.1, 4.6 - 1.7 * K, 0.9, '#ffc890', 0.6);
  glow(13.95, -0.5 - 1.35 * K, 0.5, '#ffb547', 0.5);
}

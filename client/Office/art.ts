// Agent Office: the pictures drawn once, off screen: the city through the windows, the boards on
// the back wall (the desks by group, by team) and the scrolling code on each monitor.
import { K, mk } from './draw';

export type BoardBot = {
  name: string;
  color: string;
  group: string;
  team: string;
  badge: string;
  enabled: boolean;
};
/** What the boards say: the big one has a column per group, the small one a bar per team. */
export type Boards = { big: string; bigSub: string; small: string; groups: string[]; font: string };

function skyline(day: boolean) {
  const S = 120;
  return mk(30 * S, Math.round(3.4 * K * S), (g, w, h) => {
    const sk = g.createLinearGradient(0, 0, 0, h);
    const stops = day ? ['#6fa7dc', '#cfe2f1', '#eef2f4'] : ['#03050b', '#0e1a30', '#3a3022'];
    sk.addColorStop(0, stops[0]);
    sk.addColorStop(day ? 0.7 : 0.6, stops[1]);
    sk.addColorStop(1, stops[2]);
    g.fillStyle = sk;
    g.fillRect(0, 0, w, h);
    if (!day)
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(255,255,255,${Math.random() * 0.7})`;
        g.fillRect(Math.random() * w, Math.random() * h * 0.55, 1.5, 1.5);
      }
    let seed = 7;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const layers: [number, number, string, number][] = [
      [0.45, 0.55, day ? '#a9bacb' : '#141c2a', 0.15],
      [0.7, 0.95, day ? '#8296ab' : '#0b1019', 0.4],
    ];
    for (const [hm, hx, col, lit] of layers) {
      let x = -20;
      while (x < w) {
        const bw = 40 + rnd() * 120;
        const bh = h * (hm + rnd() * (hx - hm));
        g.fillStyle = col;
        g.fillRect(x, h - bh, bw, bh);
        for (let yy = h - bh + 8; yy < h - 4; yy += 10)
          for (let xx = x + 6; xx < x + bw - 8; xx += 12) {
            const r = rnd();
            if (day && r < 0.5) {
              g.fillStyle = 'rgba(255,255,255,.25)';
              g.fillRect(xx, yy, 7, 5);
            } else if (!day && r < lit) {
              g.fillStyle = r < lit * 0.75 ? '#ffd79a' : '#a8dcff';
              g.fillRect(xx, yy, 6, 4);
            }
          }
        x += bw + rnd() * 14;
      }
    }
  });
}

let sky: { n: HTMLCanvasElement; d: HTMLCanvasElement } | null = null;
/** The night and day skylines (made once, on first use). */
export const skylines = () => (sky ||= { n: skyline(false), d: skyline(true) });

/** text cut with an ellipsis to fit max pixels. */
function fit(g: CanvasRenderingContext2D, text: string, max: number) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

function boardCard(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  b: BoardBot,
  font: string,
) {
  g.fillStyle = '#1a212b';
  g.fillRect(x, y, w, 76);
  g.fillStyle = b.color;
  g.fillRect(x, y, 6, 76);
  g.beginPath();
  g.arc(x + 26, y + 38, 8, 0, 7);
  g.fill();
  g.fillStyle = '#eef1f5';
  g.font = `700 22px ${font}`;
  g.fillText(fit(g, b.name, w - 60), x + 46, y + 34);
  g.fillStyle = b.enabled ? '#39d98a' : '#9aa4b2';
  g.font = `600 18px ${font}`;
  g.fillText(fit(g, b.badge || (b.enabled ? 'On' : 'Off'), w - 60), x + 46, y + 60);
}

/** The big board: one column per group, its desks as cards. */
export function drawPhaseBoard(
  g: CanvasRenderingContext2D,
  w: number,
  bots: BoardBot[],
  B: Boards,
) {
  const { font } = B;
  g.fillStyle = '#0f141b';
  g.fillRect(0, 0, w, g.canvas.height);
  g.fillStyle = '#eef1f5';
  g.font = `800 38px ${font}`;
  g.fillText(B.big, 34, 54);
  g.fillStyle = '#9aa4b2';
  g.font = `500 22px ${font}`;
  g.textAlign = 'right';
  g.fillText(B.bigSub, w - 34, 52);
  g.textAlign = 'left';
  let cols = B.groups.filter((p) => bots.some((b) => b.group === p));
  if (!cols.length) cols = ['General'];
  const gap = 18;
  const cw = (w - 68 - (cols.length - 1) * gap) / cols.length;
  cols.forEach((p, ci) => {
    const cx = 34 + ci * (cw + gap);
    const list = bots.filter((b) => b.group === p);
    g.fillStyle = 'rgba(255,255,255,.04)';
    g.fillRect(cx, 78, cw, 306);
    g.fillStyle = '#c9d1d9';
    g.font = `700 22px ${font}`;
    g.fillText(fit(g, `${p}  ${list.length}`, cw - 28), cx + 14, 108);
    const shown = list.length > 3 ? list.slice(0, 2) : list;
    shown.forEach((b, k) => boardCard(g, cx + 10, 122 + k * 86, cw - 20, b, font));
    if (list.length > 3) {
      g.fillStyle = '#1a212b';
      g.fillRect(cx + 10, 294, cw - 20, 76);
      g.fillStyle = '#9aa4b2';
      g.font = `700 22px ${font}`;
      g.fillText(`+${list.length - 2} more`, cx + 28, 340);
    }
  });
}

/** The small board in the meeting room: how many desks each team has, and how many are busy. */
export function drawTeamBoard(g: CanvasRenderingContext2D, w: number, bots: BoardBot[], B: Boards) {
  const { font } = B;
  const h = g.canvas.height;
  g.fillStyle = '#0d1219';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#eef1f5';
  g.font = `700 34px ${font}`;
  g.fillText(B.small, 30, 52);
  const teams = [...new Set(bots.map((b) => b.team || 'General'))].slice(0, 6);
  const max = Math.max(
    1,
    ...teams.map((t) => bots.filter((b) => (b.team || 'General') === t).length),
  );
  const rowH = Math.min(44, (h - 90) / Math.max(1, teams.length));
  teams.forEach((t, i) => {
    const of = bots.filter((b) => (b.team || 'General') === t);
    const on = of.filter((b) => b.enabled).length;
    const y = 84 + i * rowH;
    const bw = w - 330;
    g.fillStyle = '#9aa4b2';
    g.font = `600 20px ${font}`;
    g.fillText(fit(g, t, 170), 30, y + rowH * 0.62);
    g.fillStyle = 'rgba(255,255,255,.08)';
    g.fillRect(220, y + rowH * 0.25, bw, rowH * 0.5);
    g.fillStyle = '#2a5d70';
    g.fillRect(220, y + rowH * 0.25, (bw * of.length) / max, rowH * 0.5);
    g.fillStyle = '#3ee0ff';
    g.fillRect(220, y + rowH * 0.25, (bw * on) / max, rowH * 0.5);
    g.fillStyle = '#eef1f5';
    g.fillText(`${on}/${of.length}`, w - 96, y + rowH * 0.62);
  });
}

/** Two screens' worth of coloured code lines (drawn twice, so it scrolls without a seam). */
export const codeCanvas = (c: string) =>
  mk(200, 400, (g, w) => {
    g.fillStyle = '#0b0f15';
    g.fillRect(0, 0, w, 400);
    const pal = [c, '#c9d1d9', '#8b949e', '#ff7b72', '#a5d6ff', '#d2a8ff'];
    g.globalAlpha = 0.9;
    for (let y = 0; y < 20; y++) {
      let x = 8 + ((Math.random() * 4) | 0) * 12;
      const n = (1 + Math.random() * 4) | 0;
      for (let k = 0; k < n && x < 190; k++) {
        const ww = 10 + Math.random() * 44;
        g.fillStyle = pal[(Math.random() * pal.length) | 0];
        g.fillRect(x, y * 10 + 3, ww, 4.5);
        g.fillRect(x, y * 10 + 203, ww, 4.5);
        x += ww + 5;
      }
    }
  });

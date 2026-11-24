// Agent Office: drawing one bot (a small hover-bot in its agent's colour), seen from the front,
// back or side depending on where it's facing. A bot that's turned off is dimmed, eyes shut.
import { R, PI, glow, rr } from './draw';
import type { Bot } from './bots';

type View = 'front' | 'back' | 'left' | 'right';
type Pose = { b: Bot; view: View; shell: CanvasGradient; off: boolean; t: number };

function viewOf(b: Bot): View {
  const fx = Math.sin(b.yaw);
  const fz = Math.cos(b.yaw);
  if (Math.abs(fz) >= Math.abs(fx) * 0.9) return fz > 0 ? 'front' : 'back';
  return fx > 0 ? 'right' : 'left';
}

function arm(p: Pose, x: number, dy: number, h: number) {
  const { ctx } = R;
  ctx.fillStyle = p.shell;
  rr(x - 0.055, -0.52 + dy, 0.11, h, 0.055);
  ctx.fill();
  ctx.fillStyle = p.b.color;
  ctx.beginPath();
  ctx.arc(x, -0.52 + dy + h, 0.055, 0, PI * 2);
  ctx.fill();
}

/** Both arms in front: typing at the desk, swinging while walking, now and then a wave. */
function frontArms(p: Pose, sw: number) {
  const { b, t } = p;
  if (b.state === 'work' && !b.moving) {
    const j = Math.sin(t * 17 + b.ph) * 0.02;
    arm(p, -0.29, -0.06 + j, 0.18);
    arm(p, 0.29, -0.06 - j, 0.18);
    return;
  }
  arm(p, -0.29, sw, 0.3);
  const rest = b.state === 'stay' || b.state === 'idle';
  const wave = !b.moving && rest && Math.sin(t * 0.7 + b.ph) > 0.85;
  if (!wave) return arm(p, 0.29, -sw, 0.3);
  const { ctx } = R;
  ctx.save();
  ctx.translate(0.29, -0.5);
  ctx.rotate(-2.4 + Math.sin(t * 10) * 0.3);
  ctx.translate(-0.29, 0.5);
  arm(p, 0.29, 0, 0.3);
  ctx.restore();
}

function body(p: Pose) {
  const { ctx } = R;
  const { b, view, off } = p;
  const side = view === 'left' || view === 'right';
  ctx.fillStyle = p.shell;
  rr(side ? -0.21 : -0.24, -0.62, side ? 0.42 : 0.48, 0.5, 0.2);
  ctx.fill();
  ctx.fillStyle = b.color;
  ctx.fillRect(side ? -0.21 : -0.24, -0.37, side ? 0.42 : 0.48, 0.04);
  if (view === 'front') {
    ctx.beginPath();
    ctx.arc(0, -0.48, 0.04, 0, PI * 2);
    ctx.fill();
    if (!off) glow(0, -0.48, 0.12, b.color, 0.6);
  }
  if (view === 'back') {
    ctx.fillStyle = 'rgba(0,0,0,.12)';
    ctx.fillRect(-0.1, -0.55, 0.2, 0.02);
    ctx.fillRect(-0.1, -0.5, 0.2, 0.02);
  }
}

function eyes(p: Pose, hy: number) {
  const { ctx } = R;
  const { b, view, off } = p;
  const lid = off ? 0.25 : b.blink < 0.12 ? 0.2 : 1;
  const sg = view === 'left' ? -1 : 1;
  if (view === 'front') {
    ctx.fillStyle = '#0a0d12';
    rr(-0.25 + hy, -0.97, 0.5, 0.31, 0.14);
    ctx.fill();
    ctx.fillStyle = b.color;
    for (const ex of [-0.1, 0.1]) {
      rr(ex - 0.05 + hy, -0.83 - 0.03 * lid, 0.1, 0.06 * lid, 0.03);
      ctx.fill();
    }
    if (!off) glow(hy, -0.82, 0.3, b.color, 0.35, 0.5);
  } else if (view !== 'back') {
    ctx.fillStyle = '#0a0d12';
    rr(sg > 0 ? -0.02 : -0.27, -0.97, 0.29, 0.31, 0.13);
    ctx.fill();
    ctx.fillStyle = b.color;
    rr(0.13 * sg - 0.045, -0.83 - 0.03 * lid, 0.09, 0.06 * lid, 0.03);
    ctx.fill();
  } else {
    ctx.fillStyle = b.color;
    ctx.fillRect(-0.18, -0.72, 0.36, 0.025);
  }
}

function head(p: Pose) {
  const { ctx } = R;
  const { b, view, off, t } = p;
  const hy = b.state === 'stay' && !b.moving && !R.reduce ? Math.sin(t * 0.9 + b.ph) * 0.02 : 0;
  ctx.fillStyle = p.shell;
  rr(-0.31 + hy, -1.04, 0.62, 0.45, 0.2);
  ctx.fill();
  eyes(p, hy);
  ctx.fillStyle = b.color;
  for (const [x, hide] of [
    [-0.31, 'right'],
    [0.31, 'left'],
  ] as const) {
    if (view === hide) continue;
    ctx.beginPath();
    ctx.arc(x, -0.81, 0.055, 0, PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = R.P.metal;
  ctx.lineWidth = 0.025;
  ctx.beginPath();
  ctx.moveTo(0, -1.04);
  ctx.lineTo(0, -1.16);
  ctx.stroke();
  ctx.fillStyle = off ? R.P.metal : b.color;
  ctx.beginPath();
  ctx.arc(0, -1.18, 0.04 + Math.sin(t * 4 + b.ph) * 0.008, 0, PI * 2);
  ctx.fill();
  if (!off) glow(0, -1.18, 0.18, b.color, 0.8);
}

/** A red "!" over a bot whose desk needs attention. */
function flag(p: Pose) {
  const { ctx } = R;
  const y = -1.48 + (R.reduce ? 0 : Math.sin(p.t * 3 + p.b.ph) * 0.03);
  glow(0, y, 0.3, '#ff5a5a', 0.6);
  ctx.fillStyle = '#ff5a5a';
  ctx.beginPath();
  ctx.arc(0, y, 0.13, 0, PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(0, y + 0.075);
  ctx.scale(0.01, 0.01);
  ctx.fillStyle = '#fff';
  ctx.font = '900 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('!', 0, 0);
  ctx.restore();
}

/** A little "z" drifting up from a sleeping bot. */
function snore(p: Pose) {
  if (R.reduce) return;
  const { ctx } = R;
  const k = (p.t * 0.35 + p.b.ph) % 1;
  ctx.save();
  ctx.globalAlpha = 0.8 * (1 - k);
  ctx.translate(0.3 + k * 0.15, -1.15 - k * 0.35);
  ctx.scale(0.01, 0.01);
  ctx.fillStyle = R.night ? '#cfd6df' : '#4a525c';
  ctx.font = '800 24px sans-serif';
  ctx.fillText('z', 0, 0);
  ctx.restore();
}

function ring(b: Bot, sel: boolean, t: number) {
  const { ctx } = R;
  ctx.fillStyle = 'rgba(0,0,0,.38)';
  ctx.beginPath();
  ctx.ellipse(b.x, b.z, 0.32, 0.13, 0, 0, PI * 2);
  ctx.fill();
  ctx.strokeStyle = b.color;
  ctx.globalAlpha = sel ? 0.95 : 0.5;
  ctx.lineWidth = sel ? 0.05 : 0.035;
  ctx.beginPath();
  ctx.ellipse(b.x, b.z, sel ? 0.46 + Math.sin(t * 4) * 0.03 : 0.38, sel ? 0.2 : 0.16, 0, 0, PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function drawBot(b: Bot, sel: boolean) {
  const { ctx } = R;
  const t = R.simT;
  const off = b.state === 'off';
  const view = viewOf(b);
  const bob = R.reduce || off ? 0 : Math.sin(t * 2.2 + b.ph) * 0.035;
  ring(b, sel, t);
  ctx.save();
  ctx.translate(b.x, b.z - (off ? 0.08 : 0.16) + bob);
  if (off) ctx.globalAlpha = 0.6;
  if (b.moving) ctx.rotate((view === 'right' ? 1 : view === 'left' ? -1 : 0) * 0.08);
  if (!off) glow(0, 0.02, 0.26, b.color, 0.7, 0.5);
  const shell = ctx.createLinearGradient(-0.3, -1, 0.3, 0);
  shell.addColorStop(0, '#ffffff');
  shell.addColorStop(1, '#c9d0d8');
  const p: Pose = { b, view, shell, off, t };
  const sw = b.moving ? Math.sin(t * 8) * 0.05 : 0;
  const side = view === 'left' || view === 'right';
  const sg = view === 'left' ? -1 : 1;
  if (side) arm(p, -0.05 * sg, -sw, 0.3);
  else frontArms(p, sw);
  body(p);
  if (side) arm(p, 0.05 * sg, sw, 0.3);
  head(p);
  if (off) snore(p);
  if (b.state === 'alert') flag(p);
  ctx.restore();
}

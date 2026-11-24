// Agent Office: the bots. One per agent, each with its own colour and desk. A bot that's turned
// on works at its desk, now and then walks to a place its phase likes (the board, the meeting
// room, the coffee bar…) and comes back; one that's turned off sleeps at its desk.
import { PI } from './draw';
import { codeCanvas } from './art';
import { type Layout, type Pt, SPOTS, route } from './layout';

const COLORS = [
  '#ffb547',
  '#3ee0ff',
  '#ff6b6b',
  '#9be564',
  '#5b8cff',
  '#ff7ad9',
  '#c79bff',
  '#ffd84d',
  '#4fe3b0',
  '#ff8f5a',
  '#7ad0ff',
  '#f0a8ff',
];

/** Where each phase's agents like to go when they leave their desk. */
const PREFS: Record<string, string[]> = {
  Prepare: ['lounge', 'kanban', 'core'],
  Plan: ['kanban', 'meeting', 'core'],
  Build: ['coffee', 'core', 'servers'],
  Review: ['meeting', 'kanban', 'coffee'],
  Test: ['servers', 'coffee', 'lounge'],
  General: ['core', 'lounge', 'coffee'],
};

const hex = (n: number) =>
  Math.round(n * 255)
    .toString(16)
    .padStart(2, '0');
/** The first 12 agents get the hand-picked colours; the rest spread round the colour wheel. */
function colorFor(i: number) {
  if (i < COLORS.length) return COLORS[i];
  const h = ((i * 137.5) % 360) / 360;
  const s = 0.85;
  const l = 0.64;
  const q = l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return `#${hex(ch(h + 1 / 3))}${hex(ch(h))}${hex(ch(h - 1 / 3))}`;
}

/**
 * What the floor shows for one desk: an agent, a code job… `mode` is how its bot behaves: work
 * (typing at the desk, and wandering off now and then when `wander`), idle (at the desk, resting),
 * alert (at the desk, flagged) or off (asleep). With `live`, the status and progress come from the
 * caller (and change with update()); without it they're made up as the bot goes.
 */
export type FloorItem = {
  id: string;
  name: string;
  group: string;
  team?: string;
  badge?: string;
  tasks: string[];
  mode: 'work' | 'idle' | 'alert' | 'off';
  wander?: boolean;
  live?: { status: string; prog: number | null };
};

const STATUS: Record<string, string> = {
  work: 'At desk · working',
  idle: 'At desk',
  alert: 'Needs attention',
  off: 'Turned off',
};

function makeBot(a: FloorItem, i: number, L: Layout) {
  const d = L.desks[i];
  const color = colorFor(i);
  return {
    id: a.id,
    name: a.name,
    group: a.group,
    team: a.team || '',
    badge: a.badge || '',
    color,
    prefs: PREFS[a.group] || PREFS.General,
    tasks: a.tasks.length ? a.tasks : ['Waiting for work'],
    enabled: a.mode === 'work',
    wander: a.wander !== false,
    live: Boolean(a.live),
    desk: d,
    seat: d.seat,
    home: d.node,
    node: d.node,
    x: d.seat[0],
    z: d.seat[1],
    mode: a.mode as string,
    state: a.mode as string,
    timer: 4 + Math.random() * 12,
    path: [] as Pt[],
    spot: null as string | null,
    dest: 'desk',
    manual: false,
    moving: false,
    yaw: PI,
    face: PI,
    speed: 0,
    ph: Math.random() * 6,
    blink: 2 + Math.random() * 3,
    task: 0,
    prog: (a.live ? a.live.prog : Math.random() * 60) as number | null,
    status: a.live ? a.live.status : STATUS[a.mode],
    code: codeCanvas(color),
    scroll: Math.random(),
  };
}
export type Bot = ReturnType<typeof makeBot>;

export const makeBots = (items: FloorItem[], L: Layout): Bot[] =>
  items.slice(0, L.desks.length).map((a, i) => makeBot(a, i, L));

/** New status for a bot whose item is live (its desk and colour stay). */
export function applyItem(s: Sim, b: Bot, a: FloorItem) {
  if (!a.live) return;
  b.tasks = a.tasks.length ? a.tasks : b.tasks;
  b.task = Math.min(b.task, b.tasks.length - 1);
  b.status = a.live.status;
  b.prog = a.live.prog;
  b.group = a.group;
  b.badge = a.badge || '';
  b.enabled = a.mode === 'work';
  b.mode = a.mode;
  if (b.state === 'walk' || b.state === 'stay') goHome(s, b);
  else b.state = a.mode;
}

/** The floor's moving parts: which spot points are taken, and by whom. */
export type Sim = { L: Layout; taken: Record<string, string> };

function release(s: Sim, b: Bot) {
  if (b.spot) delete s.taken[b.spot];
  b.spot = null;
}

const faceFor = (key: string, p: readonly [number, number, ...unknown[]]) => {
  const S = SPOTS[key];
  return S.face != null ? S.face : Math.atan2(S.look[0] - p[0], S.look[1] - p[1]);
};

/** Send b to a free point of a spot; false when the spot is full (or b is turned off). */
export function goTo(s: Sim, b: Bot, key: string, manual = false) {
  const S = SPOTS[key];
  if (b.state === 'off' || b.state === 'walk' || !S) return false;
  const free = S.pts.map((_, k) => k).filter((k) => !s.taken[key + k]);
  if (!free.length) return false;
  const k = free[(Math.random() * free.length) | 0];
  const p = S.pts[k];
  release(s, b);
  s.taken[key + k] = b.id;
  b.spot = key + k;
  b.path = route(s.L, b.node, p[2]).concat([[p[0], p[1]]]);
  b.node = p[2];
  b.state = 'walk';
  b.dest = key;
  b.manual = manual;
  b.face = faceFor(key, p);
  if (!b.live) b.status = 'Heading to ' + S.chip.toLowerCase();
  return true;
}

export function goHome(s: Sim, b: Bot) {
  if (b.state === 'off' || b.dest === 'desk') return;
  release(s, b);
  b.path = route(s.L, b.node, b.home).concat([b.seat]);
  b.node = b.home;
  b.state = 'walk';
  b.dest = 'desk';
  b.face = PI;
  if (!b.live) b.status = 'Heading back to desk';
}

/** Start b already standing at a spot's first point (when it's free). */
export function place(s: Sim, b: Bot, key: string) {
  const S = SPOTS[key];
  if (b.state !== 'work' || !b.wander || s.taken[key + 0]) return;
  const p = S.pts[0];
  s.taken[key + 0] = b.id;
  b.spot = key + 0;
  b.node = p[2];
  b.x = p[0];
  b.z = p[1];
  b.face = b.yaw = faceFor(key, p);
  b.state = 'stay';
  b.dest = key;
  b.timer = 6 + Math.random() * 6;
  b.status = S.label;
}

const angLerp = (a: number, b: number, t: number) => {
  const d = ((((b - a + PI) % (PI * 2)) + PI * 2) % (PI * 2)) - PI;
  return a + d * t;
};

function arrive(b: Bot) {
  b.speed = 0;
  if (b.dest === 'desk') {
    b.state = b.live ? b.mode : 'work';
    b.timer = 10 + Math.random() * 14;
    if (!b.live) b.status = STATUS.work;
  } else {
    b.state = 'stay';
    b.timer = b.manual ? 16 : 7 + Math.random() * 6;
    if (!b.live) b.status = SPOTS[b.dest].label;
  }
}

function walk(b: Bot, dt: number) {
  const tg = b.path[0];
  if (!tg) return arrive(b);
  const dx = tg[0] - b.x;
  const dz = tg[1] - b.z;
  const dist = Math.hypot(dx, dz);
  b.speed = Math.min(1.7, b.speed + dt * 3);
  const st = b.speed * dt;
  if (dist <= st) {
    b.x = tg[0];
    b.z = tg[1];
    b.path.shift();
    if (!b.path.length) arrive(b);
    return;
  }
  b.x += (dx / dist) * st;
  b.z += (dz / dist) * st;
  b.yaw = angLerp(b.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 12));
  b.moving = true;
}

function work(s: Sim, b: Bot, dt: number) {
  b.scroll += dt * 0.05;
  if (!b.live) {
    b.prog += dt * (1.2 + (b.desk.x + 15) * 0.02);
    if (b.prog >= 100) {
      b.prog = 0;
      b.task = (b.task + 1) % b.tasks.length;
    }
  }
  if (b.wander && b.timer < 0 && !goTo(s, b, b.prefs[(Math.random() * b.prefs.length) | 0]))
    b.timer = 4;
}

export function updateBot(s: Sim, b: Bot, dt: number) {
  b.moving = false;
  b.blink -= dt;
  if (b.blink < 0) b.blink = 2.5 + Math.random() * 3;
  if (b.state === 'off' || b.state === 'idle' || b.state === 'alert') return;
  if (b.state === 'walk') return walk(b, dt);
  b.speed = 0;
  b.yaw = angLerp(b.yaw, b.face, 1 - Math.exp(-dt * 6));
  b.timer -= dt;
  if (b.state === 'work') work(s, b, dt);
  else if (b.state === 'stay' && b.timer < 0) goHome(s, b);
}

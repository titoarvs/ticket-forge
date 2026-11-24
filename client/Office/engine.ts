// Agent Office: the running floor. Makes the canvas inside a stage element, runs the bots, the
// camera (drag to pan, wheel or pinch to zoom, follows the selected bot) and the name tags, and
// gives the React view a small API. destroy() stops everything and removes what it added.
import { R, NIGHT, DAY, mk } from './draw';
import { makeLayout } from './layout';
import {
  makeBots,
  updateBot,
  goTo,
  goHome,
  place,
  applyItem,
  type Bot,
  type Sim,
  type FloorItem,
} from './bots';
import { drawBot } from './bot-draw';
import { drawPhaseBoard, drawTeamBoard, type Boards } from './art';
import { buildWorld, type World } from './world';
import { drawGround, drawWall, drawOverhead } from './scene';
import { createCamera, type Camera } from './camera';
import { makeItems } from './items';
import { createInteract, type ItemHit } from './interact';

export type OfficeOpts = {
  night: boolean;
  boards: Boards;
  /** What clicking a desk's computer does, for its tooltip ("Open terminal"). */
  screenHint: string;
  /** A computer, a board or a full place was clicked. */
  onItem: (hit: ItemHit) => void;
  onSelect: (id: string | null) => void;
  onFollow: (on: boolean) => void;
};
export type BotSnap = {
  id: string;
  color: string;
  status: string;
  task: string;
  prog: number | null;
  state: string;
};

function tagFor(b: Bot, onClick: () => void) {
  const el = document.createElement('div');
  el.className = 'of-tag';
  el.style.setProperty('--c', b.color);
  el.appendChild(document.createElement('i'));
  el.appendChild(document.createTextNode(b.name));
  el.onclick = onClick;
  return el;
}

function tickLeds(w: World) {
  for (let k = 0; k < 12; k++) {
    const r = Math.random();
    w.leds[(Math.random() * w.leds.length) | 0] = r < 0.6 ? 0 : r < 0.82 ? 1 : r < 0.9 ? 2 : 3;
  }
}

function paint(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  w: World,
  sel: Bot | null,
  top: () => void,
) {
  const { W, H, DPR } = cam.size();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const bg = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.8);
  bg.addColorStop(0, R.night ? '#111826' : '#e3e9ef');
  bg.addColorStop(1, R.P.bg);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const s = cam.p * DPR;
  ctx.setTransform(s, 0, 0, s, DPR * (W / 2 - cam.x * cam.p), DPR * (H / 2 - cam.y * cam.p));
  drawGround(w);
  drawWall(w);
  const list = w.props.concat(
    w.bots.map((b) => ({ k: b.z + 0.01, d: () => drawBot(b, b === sel) })),
  );
  list.sort((a, b) => a.k - b.k).forEach((p) => p.d());
  drawOverhead(w);
  top();
}

function placeTags(cam: Camera, bots: Bot[], tags: HTMLElement[]) {
  const { W, H } = cam.size();
  bots.forEach((b, i) => {
    const st = tags[i].style;
    const x = (b.x - cam.x) * cam.p + W / 2;
    const y = (b.z - 1.32 - cam.y) * cam.p + H / 2;
    if (x < -60 || x > W + 60 || y < -30 || y > H + 30 || cam.p < 14) {
      st.display = 'none';
      return;
    }
    st.display = '';
    st.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
  });
}

export function createOffice(
  stage: HTMLElement,
  labels: HTMLElement,
  items: FloorItem[],
  o: OfficeOpts,
) {
  const L = makeLayout(items.length);
  const bots = makeBots(items, L);
  const sim: Sim = { L, taken: {} };
  const kanC = mk(1624, 400, (g, w) => drawPhaseBoard(g, w, bots, o.boards));
  const boardC = mk(810, 300, (g, w) => drawTeamBoard(g, w, bots, o.boards));
  const world = buildWorld(L, bots, kanC, boardC);
  bots.forEach((b, i) => i % 4 === 1 && place(sim, b, b.prefs[0]));
  const st = {
    night: o.night,
    paused: false,
    following: true,
    sel: null as Bot | null,
    simT: 0,
    led: 0,
  };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const cv = document.createElement('canvas');
  stage.appendChild(cv);
  const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
  const setFollow = (v: boolean) => {
    st.following = v;
    o.onFollow(v);
  };
  const deselect = () => {
    st.sel = null;
    tags.forEach((t) => t.classList.remove('on'));
    o.onSelect(null);
  };
  const select = (b: Bot) => {
    st.sel = b;
    tags.forEach((t, i) => t.classList.toggle('on', bots[i] === b));
    setFollow(true);
    cam.zoomIn();
    o.onSelect(b.id);
  };
  const ix = createInteract({
    cv,
    labels,
    bots,
    sim,
    items: makeItems(bots, o.screenHint),
    cam: () => cam,
    sel: () => st.sel,
    select,
    unfollow: () => st.following && setFollow(false),
    onItem: o.onItem,
  });
  const cam = createCamera(cv, stage, {
    selected: () => st.sel,
    onTap: ix.onTap,
    onHover: ix.onHover,
    onUnfollow: () => st.sel && st.following && setFollow(false),
    focusX: (L.xs[0] + L.xs[L.xs.length - 1]) / 2,
  });
  const tags = bots.map((b) => tagFor(b, () => select(b)));
  tags.forEach((t) => labels.appendChild(t));

  let last = performance.now();
  let raf = 0;
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    Object.assign(R, { ctx, P: st.night ? NIGHT : DAY, night: st.night, reduce, simT: st.simT });
    if (!st.paused) {
      st.simT += dt;
      R.simT = st.simT;
      bots.forEach((b) => updateBot(sim, b, dt));
      st.led -= dt;
      if (st.led < 0) {
        st.led = 0.12;
        tickLeds(world);
      }
    }
    if (st.sel && st.following) cam.aim(st.sel.x, st.sel.z - 0.6);
    cam.step(dt);
    paint(ctx, cam, world, st.sel, ix.draw);
    placeTags(cam, bots, tags);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    select: (id: string | null) => {
      const b = bots.find((x) => x.id === id);
      if (b) select(b);
      else deselect();
    },
    sendTo: (key: string) => !!st.sel && goTo(sim, st.sel, key, true),
    goDesk: () => st.sel && st.sel.dest !== 'desk' && goHome(sim, st.sel),
    overview: () => {
      deselect();
      cam.overview(false);
    },
    /** New statuses for live items (same ids; a different set of desks needs a new office). */
    update: (next: FloorItem[], boards: Boards) => {
      for (const a of next) {
        const b = bots.find((x) => x.id === a.id);
        if (b) applyItem(sim, b, a);
      }
      drawPhaseBoard(kanC.getContext('2d'), kanC.width, bots, boards);
      drawTeamBoard(boardC.getContext('2d'), boardC.width, bots, boards);
    },
    /** Outline the computer of the desk whose panel (terminal…) is open. */
    setActiveScreen: (id: string | null) => ix.setActive(id),
    setNight: (v: boolean) => (st.night = v),
    setPaused: (v: boolean) => (st.paused = v),
    setFollow: (v: boolean) => (st.following = v),
    snapshot: (): BotSnap[] =>
      bots.map((b) => ({
        id: b.id,
        color: b.color,
        status: b.status,
        task: b.tasks[b.task],
        prog: b.prog,
        state: b.state,
      })),
    destroy: () => {
      cancelAnimationFrame(raf);
      cam.destroy();
      ix.destroy();
      cv.remove();
      tags.forEach((t) => t.remove());
    },
  };
}
export type OfficeApi = ReturnType<typeof createOffice>;

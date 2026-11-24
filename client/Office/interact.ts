// Agent Office: pointing at and clicking things on the floor. A bot under the pointer is picked
// first; otherwise the item there (a desk's computer, a board, a place). Hovering outlines the item
// and shows what a click does; clicking acts: a computer opens its desk (the page decides what
// that means, e.g. the job's terminal), a board opens the desk list, and a place takes the
// selected bot there (when it can wander) or brings the camera to it.
import { goTo, type Bot, type Sim } from './bots';
import { SPOTS } from './layout';
import { type Item, itemAt, drawOutline } from './items';
import type { Camera } from './camera';

/** What the page is told about a click: a computer (with its desk), a board, or a full place. */
export type ItemHit = { kind: string; desk?: string; label?: string };

type Ctx = {
  cv: HTMLCanvasElement;
  labels: HTMLElement;
  bots: Bot[];
  sim: Sim;
  items: Item[];
  cam: () => Camera;
  sel: () => Bot | null;
  select: (b: Bot) => void;
  unfollow: () => void;
  onItem: (hit: ItemHit) => void;
};

function botAt(bots: Bot[], wx: number, wy: number) {
  let best: Bot | null = null;
  for (const b of bots)
    if (Math.abs(wx - b.x) < 0.4 && wy > b.z - 1.3 && wy < b.z + 0.15 && (!best || b.z > best.z))
      best = b;
  return best;
}

export function createInteract(c: Ctx) {
  let hover: Item | null = null;
  let active: string | null = null;
  const tip = document.createElement('div');
  tip.className = 'of-tip';
  tip.hidden = true;
  c.labels.appendChild(tip);

  /** The selected bot, when it can be sent to this place. */
  const sendable = (it: Item) => {
    const b = c.sel();
    return b && b.wander && b.state !== 'off' && SPOTS[it.kind] ? b : null;
  };
  const labelOf = (it: Item) => {
    const b = sendable(it);
    return b ? `Send ${b.name} to ${SPOTS[it.kind].chip.toLowerCase()}` : it.label;
  };

  const onHover = (w: [number, number] | null, sx: number, sy: number) => {
    const bot = w && botAt(c.bots, w[0], w[1]);
    hover = w && !bot ? itemAt(c.items, w[0], w[1]) : null;
    c.cv.style.cursor = bot || hover ? 'pointer' : '';
    tip.hidden = !hover;
    if (!hover) return;
    tip.textContent = labelOf(hover);
    tip.style.transform = `translate(${Math.round(sx + 14)}px,${Math.round(sy + 16)}px)`;
  };

  const onTap = (wx: number, wy: number) => {
    tip.hidden = true;
    hover = null;
    const bot = botAt(c.bots, wx, wy);
    if (bot) return c.select(bot);
    const it = itemAt(c.items, wx, wy);
    if (!it) return;
    if (it.kind === 'screen') {
      const b = c.bots.find((x) => x.id === it.desk);
      if (b) c.select(b);
      return c.onItem({ kind: 'screen', desk: it.desk });
    }
    if (it.kind === 'board' || it.kind === 'teams') return c.onItem({ kind: it.kind });
    const b = sendable(it);
    if (b) {
      if (!goTo(c.sim, b, it.kind, true)) c.onItem({ kind: 'full', label: SPOTS[it.kind].chip });
      return;
    }
    c.unfollow();
    c.cam().focus(it.focus[0], it.focus[1] - 0.6, 60);
  };

  /** The outlines: the item under the pointer, and the computer whose desk is open. */
  const draw = () => {
    if (active) {
      const it = c.items.find((x) => x.desk === active);
      const b = c.bots.find((x) => x.id === active);
      if (it && b) drawOutline(it, b.color, true);
    }
    if (hover) drawOutline(hover, '#3ee0ff');
  };

  return {
    onHover,
    onTap,
    draw,
    setActive: (id: string | null) => (active = id),
    destroy: () => tip.remove(),
  };
}

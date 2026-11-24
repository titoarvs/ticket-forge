// Agent Office: the things on the floor you can point at and click. Each item is a rectangle in
// drawn (screen-plane) world units: a desk's computer, the two wall boards, and the places bots go
// (servers, meeting room, coffee bar, lounge, core). The engine highlights the one under the
// pointer, shows its label, and acts on a click.
import { R, K, glow, rr } from './draw';
import { CORE, type Pt } from './layout';
import type { Bot } from './bots';

export type Item = {
  kind: 'screen' | 'board' | 'teams' | 'meeting' | 'servers' | 'coffee' | 'lounge' | 'core';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  label: string;
  /** Where the camera looks when the item is clicked with nothing to do. */
  focus: Pt;
  desk?: string;
};

const PLACES: Omit<Item, 'label'>[] = [
  { kind: 'board', x0: -8.9, y0: -10 - 3.15 * K, x1: -3.1, y1: -10 - 0.7 * K, focus: [-6, -9.4] },
  { kind: 'teams', x0: 8.45, y0: -10 - 2.75 * K, x1: 11.15, y1: -10 - 1.05 * K, focus: [9.8, -9] },
  { kind: 'servers', x0: -14.75, y0: -9.95 - 2.1 * K, x1: -11.85, y1: -9.05, focus: [-13.3, -9] },
  { kind: 'meeting', x0: 8.4, y0: -8.1 - 0.77 * K, x1: 11.1, y1: -5.75, focus: [9.75, -6.9] },
  { kind: 'coffee', x0: 13.3, y0: -1.45 - 1.46 * K, x1: 14.5, y1: 1.85, focus: [13.2, 0.2] },
  { kind: 'lounge', x0: 7.55, y0: 4.85 - 0.92 * K, x1: 11.65, y1: 7.45, focus: [9.6, 6.4] },
  {
    kind: 'core',
    x0: CORE[0] - 0.95,
    y0: CORE[1] - 2.4 * K,
    x1: CORE[0] + 0.95,
    y1: CORE[1] + 0.9,
    focus: CORE,
  },
];

const NAMES: Record<string, string> = {
  board: 'Big board · see every desk',
  teams: 'Team board · see desks by team',
  servers: 'Server racks',
  meeting: 'Meeting room',
  coffee: 'Coffee bar',
  lounge: 'Lounge',
  core: 'Orchestrator core',
};

/** screenHint: what clicking a desk's computer does ("Open terminal", "Open details"). */
export function makeItems(bots: Bot[], screenHint: string): Item[] {
  const screens: Item[] = bots.map((b) => {
    const { x, z } = b.desk;
    return {
      kind: 'screen',
      x0: x - 0.56,
      y0: z - 0.36 - 1.48 * K,
      x1: x + 0.56,
      y1: z - 0.3 - 0.8 * K,
      label: `${b.name} · ${screenHint}`,
      focus: [x, z],
      desk: b.id,
    };
  });
  return [...screens, ...PLACES.map((p) => ({ ...p, label: NAMES[p.kind] }))];
}

export const itemAt = (items: Item[], x: number, y: number) =>
  items.find((it) => x >= it.x0 && x <= it.x1 && y >= it.y0 && y <= it.y1) || null;

/** An outline round an item: bright while pointed at, a slow pulse for the open terminal's screen. */
export function drawOutline(it: Item, color: string, pulse = false) {
  const { ctx } = R;
  const pad = it.kind === 'screen' ? 0.05 : 0.1;
  const a = pulse ? 0.55 + Math.sin(R.simT * 4) * 0.35 : 0.95;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.strokeStyle = color;
  ctx.lineWidth = it.kind === 'screen' ? 0.04 : 0.06;
  rr(it.x0 - pad, it.y0 - pad, it.x1 - it.x0 + pad * 2, it.y1 - it.y0 + pad * 2, 0.12);
  ctx.stroke();
  ctx.restore();
  const cx = (it.x0 + it.x1) / 2;
  const cy = (it.y0 + it.y1) / 2;
  glow(cx, cy, Math.max(it.x1 - it.x0, it.y1 - it.y0) * 0.7, color, pulse ? 0.18 : 0.25, 0.6);
}

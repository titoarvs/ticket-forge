// Agent Office: where things are on the floor. The desks are laid out for however many agents
// there are (up to MAX_DESKS), with an aisle behind each row; the aisles, the side corridors and
// the rooms on the right form the walkway graph the bots route along.
import { PI } from './draw';

export type Pt = [number, number];
type SpotPt = [number, number, string];
export type Spot = { label: string; chip: string; face?: number; look?: Pt; pts: SpotPt[] };
export type Desk = { x: number; z: number; seat: Pt; node: string };
export type Layout = {
  desks: Desk[];
  rows: number[];
  xs: number[];
  N: Record<string, Pt>;
  E: Record<string, string[]>;
};

export const MAX_DESKS = 25;
export const CORE: Pt = [3.2, 6.6];
const X0 = -12.6;
const X1 = -2.6;
const Z0 = -5;
const Z1 = 7.4;
const ZT = -6.9;
const AISLE = 1.85;

/** The places a bot can go when it leaves its desk; each point names the walkway node it's reached from. */
export const SPOTS: Record<string, Spot> = {
  kanban: {
    label: 'Reading the phase board',
    chip: 'Board',
    face: PI,
    pts: [
      [-7.6, -8.5, 'KB'],
      [-6, -8.5, 'KB'],
      [-4.4, -8.5, 'KB'],
    ],
  },
  meeting: {
    label: 'Sync in the meeting room',
    chip: 'Meeting',
    look: [9.75, -6.9],
    pts: [
      [9.75, -5.4, 'M1'],
      [8.25, -6.9, 'M1'],
      [11.25, -6.9, 'M2'],
    ],
  },
  servers: {
    label: 'Checking the runners',
    chip: 'Servers',
    face: PI,
    pts: [
      [-13.3, -8.1, 'S0'],
      [-11.9, -8.1, 'S0'],
    ],
  },
  coffee: {
    label: 'Recharging at the coffee bar',
    chip: 'Coffee',
    face: PI / 2,
    pts: [
      [12.5, -0.5, 'R0'],
      [12.5, 0.9, 'R0'],
    ],
  },
  lounge: {
    label: 'Thinking it over in the lounge',
    chip: 'Lounge',
    look: [9.6, 7],
    pts: [
      [11, 8.3, 'L1'],
      [9.6, 8.6, 'L1'],
      [8.2, 8.3, 'L1'],
    ],
  },
  core: {
    label: 'Reporting to the orchestrator',
    chip: 'Core',
    look: CORE,
    pts: [
      [CORE[0], 5.3, 'C0'],
      [CORE[0] - 1.3, 5.7, 'C0'],
      [CORE[0] + 1.3, 5.7, 'C0'],
    ],
  },
};

/** n positions centred between a and b, at most max apart. */
function spread(n: number, a: number, b: number, max: number) {
  if (n <= 1) return [(a + b) / 2];
  const step = Math.min(max, (b - a) / (n - 1));
  const start = (a + b) / 2 - (step * (n - 1)) / 2;
  return Array.from({ length: n }, (_, i) => start + i * step);
}

function graph(xs: number[], zs: number[]) {
  const N: Record<string, Pt> = {};
  const E: Record<string, string[]> = {};
  const link = (a: string, b: string) => {
    (E[a] ||= []).push(b);
    (E[b] ||= []).push(a);
  };
  const chain = (ids: string[]) => ids.forEach((id, i) => i && link(ids[i - 1], id));
  const xL = xs[0] - 1.6;
  const xR = xs[xs.length - 1] + 1.6;
  Object.assign(N, { TL: [xL, ZT], S0: [-12.6, ZT], KB: [-6, ZT], TR: [xR, ZT] });
  chain(['TL', 'S0', 'KB', 'TR'].sort((a, b) => N[a][0] - N[b][0]));
  const left = ['TL'];
  const right = ['TR', 'P1', 'Q1'];
  zs.forEach((z, r) => {
    const row = [`R${r}L`, ...xs.map((_, c) => `R${r}C${c}`), `R${r}R`];
    row.forEach(
      (id, k) => (N[id] = [k === 0 ? xL : k === row.length - 1 ? xR : xs[k - 1], z + AISLE]),
    );
    chain(row);
    left.push(row[0]);
    right.push(row[row.length - 1]);
  });
  Object.assign(N, {
    P1: [xR, -2.4],
    Q1: [xR, 2.8],
    P2: [5.6, -2.4],
    A7: [8.7, -2.4],
    M1: [8.7, -5],
    M2: [11.3, -5],
    R0: [11.2, 0.2],
    QC: [CORE[0], 2.8],
    Q2: [5.6, 2.8],
    B7: [9.6, 2.8],
    L0: [12.9, 3.6],
    L1: [12.9, 8.4],
    C0: [CORE[0], 4.5],
  });
  chain(left);
  chain(right.sort((a, b) => N[a][1] - N[b][1]));
  chain(['P1', 'P2', 'A7', 'M1', 'M2']);
  chain(['Q1', 'QC', 'Q2', 'B7', 'L0', 'L1']);
  link('A7', 'R0');
  link('R0', 'B7');
  link('P2', 'Q2');
  link('QC', 'C0');
  return { N, E };
}

export function makeLayout(n: number): Layout {
  const count = Math.max(1, Math.min(n, MAX_DESKS));
  const nr = Math.min(5, Math.ceil(count / 4));
  const nc = Math.ceil(count / nr);
  const xs = spread(nc, X0, X1, 3.4);
  const rs = nr > 1 ? Math.min(3.6, (Z1 - Z0) / (nr - 1)) : 0;
  const zs = Array.from({ length: nr }, (_, r) => Z0 + r * rs);
  const desks: Desk[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / nc);
    const c = i % nc;
    desks.push({ x: xs[c], z: zs[r], seat: [xs[c], zs[r] + 1.1], node: `R${r}C${c}` });
  }
  return { desks, rows: zs, xs, ...graph(xs, zs) };
}

/** The shortest walk from node a to node b, as points. */
export function route(L: Layout, a: string, b: string): Pt[] {
  const dist: Record<string, number> = {};
  const prev: Record<string, string> = {};
  const Q = new Set(Object.keys(L.N));
  for (const k of Q) dist[k] = Infinity;
  dist[a] = 0;
  while (Q.size) {
    let u: string | null = null;
    for (const k of Q) if (u === null || dist[k] < dist[u]) u = k;
    Q.delete(u);
    if (u === b || dist[u] === Infinity) break;
    for (const v of L.E[u] || []) {
      const d = dist[u] + Math.hypot(L.N[u][0] - L.N[v][0], L.N[u][1] - L.N[v][1]);
      if (d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  const p: Pt[] = [];
  let c: string | undefined = b;
  while (c) {
    p.unshift(L.N[c]);
    if (c === a) break;
    c = prev[c];
  }
  return p;
}

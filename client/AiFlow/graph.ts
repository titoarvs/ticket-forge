'use client';
// The AI flow as a graph: where each node starts out, the wires between them and what each node's
// status badge says. Plain functions of the AI settings, no React state.
import { useMemo } from 'react';
import type { Any } from '../core';
import { type FNode, type State, GW, ROW, HEAD, TW, TH, CW, CH, RW, RH, PW, PH } from './model';
import { TIER, stateOf } from './model';

export type Graph = {
  tasks: Any[];
  tiers: string[];
  configs: Any[];
  apis: Any[];
  localMode: boolean;
  nodes: FNode[];
  byId: Record<string, FNode>;
  /** The AIs in priority order: the first available one answers. */
  chain: string[];
};
export type Edge = {
  id: string;
  kind: 'route' | 'tier' | 'config' | 'gw' | 'fallback';
  from: string;
  to: string;
  color?: string;
  task?: string;
};
export type WireStart = { kind: 'task' | 'prov'; node: string; row?: string };

type Inputs = Pick<Graph, 'tasks' | 'tiers' | 'configs' | 'apis' | 'localMode'> & {
  copilot: boolean;
};

/** One node per task group, stacked in the first column. */
function taskGroupNodes(tasks: Any[]) {
  const list: FNode[] = [];
  let y = 0;
  for (const group of new Set(tasks.map((t) => t.group))) {
    const rows = tasks.filter((t) => t.group === group);
    const h = HEAD + rows.length * ROW + 10;
    list.push({
      id: `g:${group}`,
      kind: 'group',
      w: GW,
      h,
      def: { x: 0, y },
      rows,
      data: { group },
    });
    y += h + 18;
  }
  return { list, height: Math.max(y - 18, 300) };
}

/** The local AIs (when opened on this computer) and then the API providers. */
function chainMembers({ apis, localMode, copilot }: Inputs) {
  const members: Any[] = [];
  if (localMode) {
    members.push({ id: 'a:claude', kind: 'local', data: { which: 'claude' } });
    if (copilot) members.push({ id: 'a:copilot', kind: 'local', data: { which: 'copilot' } });
  }
  for (const x of apis) members.push({ id: `p:${x.entryId}`, kind: 'provider', data: x });
  return members;
}

/** Columns from left to right: task groups → tiers and configurations → router → providers. */
function layoutNodes(input: Inputs) {
  const { tiers, configs } = input;
  const { list, height } = taskGroupNodes(input.tasks);
  const tierX = GW + 170;
  const tierBlock = tiers.length * TH + (tiers.length - 1) * 28;
  const tierTop = Math.max(0, height / 2 - tierBlock / 2 - 20);
  tiers.forEach((tier, i) =>
    list.push({
      id: `t:${tier}`,
      kind: 'tier',
      w: TW,
      h: TH,
      def: { x: tierX, y: tierTop + i * (TH + 28) },
      data: { tier },
    }),
  );
  configs.forEach((cf, i) =>
    list.push({
      id: `c:${cf.id}`,
      kind: 'config',
      w: CW,
      h: CH,
      def: { x: tierX, y: tierTop + tierBlock + 40 + i * (CH + 14) },
      data: cf,
    }),
  );
  const routerX = tierX + TW + 130;
  list.push({
    id: 'gw',
    kind: 'gateway',
    w: RW,
    h: RH,
    def: { x: routerX, y: tierTop + tierBlock / 2 - RH / 2 },
    data: {},
  });
  const members = chainMembers(input);
  const chainX = routerX + RW + 150;
  const chainH = members.length * PH + Math.max(0, members.length - 1) * 44;
  const top = Math.max(0, height / 2 - chainH / 2 - 20);
  members.forEach((m, i) =>
    list.push({ ...m, w: PW, h: PH, def: { x: chainX, y: top + i * (PH + 44) } }),
  );
  list.push({
    id: 'add',
    kind: 'add',
    w: PW,
    h: 64,
    def: { x: chainX, y: top + members.length * (PH + 44) },
  });
  return { nodes: list, chain: members.map((m) => m.id) as string[] };
}

/** The graph for the current AI settings. */
export function useFlowGraph(c: Any): Graph {
  const tasks: Any[] = c.tasks || [];
  const tiers: string[] = c.tiers || ['high', 'standard', 'light'];
  const configs: Any[] = (c.settings?.configs || []).filter((x: Any) => x.enabled !== false);
  const apis: Any[] = (c.apis || []).filter((x: Any) => x.entryId);
  const localMode = c.mode === 'account';
  const copilot = Boolean(c.copilot?.available);
  // The layout is rebuilt only when nodes come or go (this key), not when what they show changes.
  const layoutKey = JSON.stringify([
    tasks.map((t) => [t.id, t.group]),
    tiers,
    configs.map((x) => x.id),
    apis.map((x) => x.entryId),
    localMode,
    copilot,
  ]);
  const { nodes: baseNodes, chain } = useMemo(
    () => layoutNodes({ tasks, tiers, configs, apis, localMode, copilot }),
    [layoutKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // What each node shows is read fresh on every render.
  const nodes = baseNodes.map((n) =>
    n.kind === 'provider'
      ? { ...n, data: apis.find((x) => `p:${x.entryId}` === n.id) || n.data }
      : n.kind === 'config'
        ? { ...n, data: configs.find((x) => `c:${x.id}` === n.id) || n.data }
        : n,
  );
  const byId: Record<string, FNode> = Object.fromEntries(nodes.map((n) => [n.id, n]));
  return { tasks, tiers, configs, apis, localMode, nodes, byId, chain };
}

/** What a task runs on: its own choice, or its default tier. */
export const targetOf = (r: Any, task: Any): string => r.tiers?.[task.id] || task.tier;
export const tierCount = (g: Graph, r: Any, tier: string) =>
  g.tasks.filter((t) => targetOf(r, t) === tier).length;
export const configCount = (g: Graph, r: Any, id: string) =>
  g.tasks.filter((t) => r.tiers?.[t.id] === `cfg:${id}`).length;

function routeEdges(g: Graph, r: Any): Edge[] {
  return g.tasks.map((t) => {
    const target = targetOf(r, t);
    const to = /^cfg:/.test(target) ? `c:${target.slice(4)}` : `t:${target}`;
    const dest = g.byId[to] ? to : `t:${t.tier}`;
    const color = g.byId[dest]?.kind === 'tier' ? TIER[g.byId[dest].data.tier]?.color : '#8b5cf6';
    return { id: `task:${t.id}`, kind: 'route', task: t.id, from: `g:${t.group}`, to: dest, color };
  });
}

function configEdges(g: Graph): Edge[] {
  const out: Edge[] = [];
  for (const cf of g.configs) {
    const dest =
      cf.engine === 'api'
        ? `p:${cf.providerId}`
        : cf.engine === 'copilot'
          ? 'a:copilot'
          : 'a:claude';
    if (g.byId[dest])
      out.push({
        id: `cp:${cf.id}`,
        kind: 'config',
        from: `c:${cf.id}`,
        to: dest,
        color: '#8b5cf6',
      });
  }
  return out;
}

const usable = (n: FNode) => n.kind === 'local' || (n.data.enabled && n.data.configured);

/** The router to the first usable AI, then each AI to the next one as its fallback. */
function chainEdges(g: Graph): Edge[] {
  const out: Edge[] = [];
  const first = g.chain.find((id) => usable(g.byId[id])) || g.chain[0];
  if (first) out.push({ id: 'gw:first', kind: 'gw', from: 'gw', to: first, color: 'var(--brand)' });
  g.chain.forEach((id, i) => {
    if (i < g.chain.length - 1)
      out.push({
        id: `fb:${id}`,
        kind: 'fallback',
        from: id,
        to: g.chain[i + 1],
        color: '#e2a400',
      });
  });
  return out;
}

export function buildEdges(g: Graph, r: Any): Edge[] {
  if (!r) return [];
  const tierEdges: Edge[] = g.tiers.map((k) => ({
    id: `tg:${k}`,
    kind: 'tier',
    from: `t:${k}`,
    to: 'gw',
    color: TIER[k]?.color,
  }));
  return [...routeEdges(g, r), ...tierEdges, ...configEdges(g), ...chainEdges(g)];
}

/** Whether a wire dragged from `from` may end on node `id`. */
export function canWire(g: Graph, from: WireStart, id: string) {
  const n = g.byId[id];
  if (!n) return false;
  if (from.kind === 'task') return n.kind === 'tier' || n.kind === 'config';
  return n.kind === 'provider' && id !== from.node;
}

function localState(c: Any, which: string): State {
  if (which === 'claude')
    return c.account?.cooldown
      ? { k: 'warn', label: 'Limited' }
      : c.account?.signedIn
        ? { k: 'ok', label: 'Signed in' }
        : { k: 'bad', label: 'Not signed in' };
  if (c.copilot?.cooldown) return { k: 'warn', label: 'Limited' };
  if (!c.copilot?.available) return { k: 'off', label: 'Not installed' };
  const inUse = c.localEngine === 'copilot';
  return { k: inUse ? 'ok' : 'idle', label: inUse ? 'Local AI' : 'Backup' };
}

/** The status badge of a node. */
export function nodeState(c: Any, n: FNode): State {
  if (n.kind === 'provider') return stateOf(n.data);
  if (n.kind === 'local') return localState(c, n.data.which);
  return { k: 'idle', label: '' };
}

/** The name screen readers announce for a node. */
export function nodeLabel(n: FNode) {
  if (n.kind === 'group') return `${n.data.group} tasks`;
  if (n.kind === 'tier') return `${TIER[n.data.tier].label} tier`;
  if (n.kind === 'gateway') return 'Router';
  if (n.kind === 'add') return 'Add a provider';
  return n.data.label || n.data.name || n.id;
}

/** The display name of an AI in the chain. */
export const aiName = (n: FNode) =>
  n.kind === 'local'
    ? n.data.which === 'claude'
      ? 'Claude account'
      : 'GitHub Copilot'
    : n.data.label;

/** What a configuration runs on, in words. */
export function engineName(g: Graph, cf: Any, apiFallback: string) {
  if (cf.engine === 'api')
    return g.apis.find((x) => x.entryId === cf.providerId)?.label || apiFallback;
  return cf.engine === 'copilot' ? 'GitHub Copilot' : 'Claude account';
}

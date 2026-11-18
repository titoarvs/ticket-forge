'use client';
// Administration → AI → AI flow: the AI settings as a canvas of nodes you wire together, like n8n.
//
//   tasks (grouped)  ──►  tiers (High · Standard · Light)  ──►  router  ──►  provider ──fallback──► provider ──► …
//
//  · Drag from a task's dot onto a tier (or an AI configuration) to choose what that task runs on.
//  · Drag a provider's bottom dot onto another provider to make that one the next fallback (the priority order).
//  · Click a node for its details: status, test, the model it uses for each tier, switches.
//  · Drag nodes to arrange them, drag the background to pan, Ctrl/⌘ + scroll or pinch to zoom.
// Every change is saved straight away through the same settings the other AI sections use.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, toast, type Any } from './core';
import { Ico, I, Spinner } from './ui';
import { SF, MenuItem, PeopleF } from './fields';

export type FlowActions = {
  onSaved: (st: Any) => void;
  add: () => void;
  edit: (entry: Any) => void;
  remove: (entry: Any) => void;
  goto: (section: string) => void;
};

type Pt = { x: number; y: number };
type FNode = {
  id: string;
  kind: 'group' | 'tier' | 'config' | 'gateway' | 'provider' | 'local' | 'add';
  w: number;
  h: number;
  def: Pt;
  rows?: Any[];
  data?: Any;
};

const GW = 252,
  ROW = 30,
  HEAD = 40; // task group node
const TW = 214,
  TH = 112; // tier node
const CW = 214,
  CH = 76; // configuration node
const RW = 176,
  RH = 96; // router node
const PW = 256,
  PH = 108; // provider node
const TIER: Record<string, { label: string; hint: string; color: string }> = {
  high: { label: 'High', hint: 'Best quality, most usage', color: '#8b5cf6' },
  standard: { label: 'Standard', hint: 'Good quality, moderate usage', color: '#2f7bf5' },
  light: { label: 'Light', hint: 'Fast and cheap', color: '#1f9d6b' },
};
const GROUP_COLOR: Record<string, string> = {
  Planning: '#2f7bf5',
  Documents: '#e0526b',
  Testing: '#e2a400',
  Code: '#1f9d6b',
  Helpers: '#7c8aa0',
};
const CLAUDE_OPTIONS = ['opus', 'sonnet', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'];
const LS = 'tf.aiflow.v1';
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const hue = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};

type State = { k: 'ok' | 'idle' | 'warn' | 'bad' | 'off'; label: string; title?: string };
function stateOf(x: Any): State {
  if (!x.enabled) return { k: 'off', label: 'Off' };
  if (!x.configured) return { k: 'bad', label: 'Incomplete', title: x.error || '' };
  if (x.cooldown)
    return {
      k: 'warn',
      label: x.cooldown.kind === 'credits' ? 'Out of credits' : x.cooldown.kind === 'auth' ? 'Key rejected' : 'Limited',
      title: x.cooldown.message,
    };
  if (x.active) return { k: 'ok', label: 'In use' };
  return { k: 'idle', label: 'Backup' };
}

export function AiFlow({ c, actions }: { c: Any; actions: FlowActions }) {
  const saved = c.settings?.routing;
  const [r, setR] = useState<Any>(saved);
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setR(JSON.parse(savedKey || 'null'));
  }, [savedKey]);
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState<Record<string, Any>>({});
  const [busy, setBusy] = useState('');
  const [sel, setSel] = useState<{ type: 'node' | 'edge'; id: string } | null>(null);
  const [conn, setConn] = useState<Any>(null);
  const [full, setFull] = useState(false);
  const stored = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(LS) || '{}');
    } catch {
      return {};
    }
  }, []);
  const [pos, setPos] = useState<Record<string, Pt>>(stored.pos || {});
  const [view, setView] = useState<{ x: number; y: number; k: number }>(stored.view || { x: 24, y: 24, k: 0.8 });
  const [fitted, setFitted] = useState(Boolean(stored.view));
  const vp = useRef<HTMLDivElement>(null);
  const drag = useRef<Any>(null);
  const pts = useRef(new Map<number, Pt>());
  const viewRef = useRef(view);
  viewRef.current = view;
  const touched = useRef(Boolean(stored.view)); // once you pan or zoom yourself, the canvas stops re-fitting on resize
  const persist = (p = pos, v = view) => {
    try {
      localStorage.setItem(LS, JSON.stringify({ pos: p, view: v }));
    } catch {
      /* private mode */
    }
  };

  const tasks: Any[] = c.tasks || [];
  const tiers: string[] = c.tiers || ['high', 'standard', 'light'];
  const configs: Any[] = (c.settings?.configs || []).filter((x: Any) => x.enabled !== false);
  const apis: Any[] = (c.apis || []).filter((x: Any) => x.entryId);
  const localMode = c.mode === 'account';
  const routingOn = r?.enabled !== false;

  // ---- the nodes and where they start out
  const { nodes: baseNodes, chain } = useMemo(() => {
    const list: FNode[] = [];
    const groups = [...new Set(tasks.map((t) => t.group))];
    let y = 0;
    for (const g of groups) {
      const rows = tasks.filter((t) => t.group === g);
      const h = HEAD + rows.length * ROW + 10;
      list.push({ id: `g:${g}`, kind: 'group', w: GW, h, def: { x: 0, y }, rows, data: { group: g } });
      y += h + 18;
    }
    const colH = Math.max(y - 18, 300);
    const TX = GW + 170;
    const tierBlock = tiers.length * TH + (tiers.length - 1) * 28;
    const tierTop = Math.max(0, colH / 2 - tierBlock / 2 - 20);
    tiers.forEach((k, i) =>
      list.push({ id: `t:${k}`, kind: 'tier', w: TW, h: TH, def: { x: TX, y: tierTop + i * (TH + 28) }, data: { tier: k } }),
    );
    configs.forEach((cf, i) =>
      list.push({ id: `c:${cf.id}`, kind: 'config', w: CW, h: CH, def: { x: TX, y: tierTop + tierBlock + 40 + i * (CH + 14) }, data: cf }),
    );
    const WX = TX + TW + 130;
    list.push({ id: 'gw', kind: 'gateway', w: RW, h: RH, def: { x: WX, y: tierTop + tierBlock / 2 - RH / 2 }, data: {} });
    const members: Any[] = [];
    if (localMode) {
      members.push({ id: 'a:claude', kind: 'local', data: { which: 'claude' } });
      if (c.copilot?.available) members.push({ id: 'a:copilot', kind: 'local', data: { which: 'copilot' } });
    }
    for (const x of apis) members.push({ id: `p:${x.entryId}`, kind: 'provider', data: x });
    const PX = WX + RW + 150;
    const chainH = members.length * PH + Math.max(0, members.length - 1) * 44;
    const top = Math.max(0, colH / 2 - chainH / 2 - 20);
    members.forEach((m, i) => list.push({ ...m, w: PW, h: PH, def: { x: PX, y: top + i * (PH + 44) } }));
    list.push({ id: 'add', kind: 'add', w: PW, h: 64, def: { x: PX, y: top + members.length * (PH + 44) } });
    return { nodes: list, chain: members.map((m) => m.id) as string[] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(tasks.map((t) => [t.id, t.group])),
    tiers.join(),
    JSON.stringify(configs.map((x) => x.id)),
    apis.map((x) => x.entryId).join(),
    localMode,
    c.copilot?.available,
  ]);
  // The layout is rebuilt only when nodes come or go; what each node shows is read fresh on every render.
  const nodes = baseNodes.map((n) =>
    n.kind === 'provider'
      ? { ...n, data: apis.find((x) => `p:${x.entryId}` === n.id) || n.data }
      : n.kind === 'config'
        ? { ...n, data: configs.find((x) => `c:${x.id}` === n.id) || n.data }
        : n,
  );
  const byId: Record<string, FNode> = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const at = (id: string): Pt => pos[id] || byId[id]?.def || { x: 0, y: 0 };

  // ---- ports and wires
  const outP = (id: string, row?: string): Pt => {
    const n = byId[id];
    const p = at(id);
    if (n.kind === 'group') {
      const i = Math.max(
        0,
        (n.rows || []).findIndex((t) => t.id === row),
      );
      return { x: p.x + n.w, y: p.y + HEAD + i * ROW + ROW / 2 };
    }
    return { x: p.x + n.w, y: p.y + n.h / 2 };
  };
  const inP = (id: string): Pt => {
    const p = at(id);
    return { x: p.x, y: p.y + byId[id].h / 2 };
  };
  const botP = (id: string): Pt => {
    const p = at(id);
    return { x: p.x + byId[id].w / 2, y: p.y + byId[id].h };
  };
  const topP = (id: string): Pt => {
    const p = at(id);
    return { x: p.x + byId[id].w / 2, y: p.y };
  };
  const hpath = (a: Pt, b: Pt) => {
    const d = Math.max(50, Math.abs(b.x - a.x) / 2);
    return `M${a.x},${a.y} C${a.x + d},${a.y} ${b.x - d},${b.y} ${b.x},${b.y}`;
  };
  const vpath = (a: Pt, b: Pt) => {
    const d = Math.max(24, Math.abs(b.y - a.y) / 2);
    return `M${a.x},${a.y} C${a.x},${a.y + d} ${b.x},${b.y - d} ${b.x},${b.y}`;
  };

  const usable = (id: string) => {
    const n = byId[id];
    if (n.kind === 'local') return true;
    const x = n.data;
    return x.enabled && x.configured;
  };
  const firstUsable = chain.find(usable) || chain[0];
  const edges = (() => {
    if (!r) return [] as Any[];
    const out: Any[] = [];
    for (const t of tasks) {
      const tgt = r.tiers?.[t.id] || t.tier;
      const to = /^cfg:/.test(tgt) ? `c:${tgt.slice(4)}` : `t:${tgt}`;
      const dest = byId[to] ? to : `t:${t.tier}`;
      out.push({
        id: `task:${t.id}`,
        kind: 'route',
        task: t.id,
        from: `g:${t.group}`,
        to: dest,
        color: byId[dest]?.kind === 'tier' ? TIER[byId[dest].data.tier]?.color : '#8b5cf6',
      });
    }
    for (const k of tiers) out.push({ id: `tg:${k}`, kind: 'tier', from: `t:${k}`, to: 'gw', color: TIER[k]?.color });
    for (const cf of configs) {
      const dest = cf.engine === 'api' ? `p:${cf.providerId}` : cf.engine === 'copilot' ? 'a:copilot' : 'a:claude';
      if (byId[dest]) out.push({ id: `cp:${cf.id}`, kind: 'config', from: `c:${cf.id}`, to: dest, color: '#8b5cf6' });
    }
    if (firstUsable) out.push({ id: 'gw:first', kind: 'gw', from: 'gw', to: firstUsable, color: 'var(--brand)' });
    chain.forEach((id, i) => {
      if (i < chain.length - 1) out.push({ id: `fb:${id}`, kind: 'fallback', from: id, to: chain[i + 1], color: '#e2a400' });
    });
    return out;
  })();
  const pathOf = (e: Any) => {
    if (e.kind === 'fallback') return vpath(botP(e.from), topP(e.to));
    return hpath(e.kind === 'route' ? outP(e.from, e.task) : outP(e.from), inP(e.to));
  };

  // ---- saving
  const patchRouting = async (next: Any, msg?: string) => {
    const prev = r;
    setR(next);
    setSaving(true);
    try {
      const st = await api('/api/admin/ai', { method: 'PATCH', body: { routing: next } });
      actions.onSaved(st);
      if (msg) toast(msg);
    } catch (e: Any) {
      setR(prev);
      toast(e.message, 'err');
    } finally {
      setSaving(false);
    }
  };
  const patch = async (b: Any) => {
    setSaving(true);
    try {
      actions.onSaved(await api('/api/admin/ai', { method: 'PATCH', body: b }));
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setSaving(false);
    }
  };
  const setTaskTier = (taskId: string, target: string) => {
    if ((r.tiers?.[taskId] || tasks.find((t) => t.id === taskId)?.tier) === target) return;
    const label = tasks.find((t) => t.id === taskId)?.label;
    const name = /^cfg:/.test(target) ? configs.find((x) => `cfg:${x.id}` === target)?.name : TIER[target]?.label;
    patchRouting({ ...r, tiers: { ...r.tiers, [taskId]: target } }, `${label} now runs on ${name}`);
  };
  const resetTask = (taskId: string) => {
    const t = tasks.find((x) => x.id === taskId);
    if (t) setTaskTier(taskId, t.tier);
  };
  const panelIds = apis.filter((x) => x.source === 'panel').map((x) => x.entryId);
  const setFallback = async (fromId: string, toId: string) => {
    const b = byId[toId];
    if (b.kind !== 'provider' || b.data.source !== 'panel') {
      toast(
        b.kind === 'local'
          ? 'Your own AI always goes first.'
          : 'Providers set with environment variables always come after the ones set up here.',
      );
      return;
    }
    const a = byId[fromId];
    const ids = panelIds.filter((x) => x !== b.data.entryId);
    let at2 = 0;
    if (a.kind === 'provider' && a.data.source === 'panel') at2 = ids.indexOf(a.data.entryId) + 1;
    else if (a.kind === 'provider') at2 = ids.length;
    ids.splice(at2, 0, b.data.entryId);
    await patch({ order: ids });
    toast(`${b.data.label} now follows ${a.kind === 'local' ? 'your own AI' : a.data.label}`);
  };
  const toggleProvider = async (x: Any, on: boolean) => {
    setBusy(`on:${x.entryId}`);
    await patch({ id: x.entryId, enabled: on });
    setBusy('');
  };
  const testNode = async (id: string) => {
    const n = byId[id];
    const key = id;
    setBusy(`test:${key}`);
    setTests((t) => ({ ...t, [key]: { running: true } }));
    try {
      const res = await api('/api/admin/ai', {
        method: 'POST',
        body: n.kind === 'provider' ? { action: 'test', id: n.data.entryId } : { action: 'test' },
      });
      setTests((t) => ({ ...t, [key]: res }));
      actions.onSaved(await api('/api/admin/ai'));
    } catch (e: Any) {
      setTests((t) => ({ ...t, [key]: { ok: false, error: e.message } }));
    } finally {
      setBusy('');
    }
  };
  const retry = async (x: Any) => {
    setBusy(`retry:${x.entryId}`);
    try {
      actions.onSaved(await api('/api/admin/ai', { method: 'POST', body: { action: 'reset', id: x.entryId } }));
    } catch (e: Any) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  };
  const dirty = Boolean(r) && JSON.stringify(r) !== savedKey;

  // ---- the canvas: pan, zoom, drag nodes, draw wires
  const rectOf = () => vp.current!.getBoundingClientRect();
  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const b = rectOf(),
      v = viewRef.current;
    return { x: (e.clientX - b.left - v.x) / v.k, y: (e.clientY - b.top - v.y) / v.k };
  };
  const nodeAt = (e: { clientX: number; clientY: number }) =>
    (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-node]')?.dataset.node || '';
  const zoomAt = (cx: number, cy: number, k2: number) => {
    touched.current = true;
    zoomTo(cx, cy, k2);
  };
  const zoomTo = (cx: number, cy: number, k2: number) =>
    setView((v) => {
      const k = clamp(k2, 0.2, 1.6);
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    });
  const fit = () => {
    if (!vp.current || !nodes.length) return;
    const b = rectOf();
    const xs = nodes.flatMap((n) => [at(n.id).x, at(n.id).x + n.w]),
      ys = nodes.flatMap((n) => [at(n.id).y, at(n.id).y + n.h]);
    const x0 = Math.min(...xs),
      x1 = Math.max(...xs),
      y0 = Math.min(...ys),
      y1 = Math.max(...ys);
    // Leave room for the toolbar on top (taller when it wraps on narrow screens) and the zoom controls below.
    const top = b.width < 720 ? 96 : 76,
      bottom = 56;
    const k = clamp(Math.min((b.width - 48) / (x1 - x0), (b.height - top - bottom) / (y1 - y0)), 0.2, 1);
    const v = { k, x: (b.width - (x1 - x0) * k) / 2 - x0 * k, y: top + (b.height - top - bottom - (y1 - y0) * k) / 2 - y0 * k };
    setView(v);
    persist(pos, v);
  };
  const refit = () => {
    touched.current = false;
    fit();
  };
  useEffect(() => {
    if (!fitted && vp.current && nodes.length) {
      fit();
      setFitted(true);
    }
  }, [nodes.length, fitted]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = vp.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (!touched.current) fit();
      }, 80);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  });
  useEffect(() => {
    if (fitted) {
      const t = setTimeout(() => fit(), 60);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = vp.current;
    if (!el) return undefined;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || full)) return; // plain scrolling keeps scrolling the page, unless the canvas is full screen
      e.preventDefault();
      const b = el.getBoundingClientRect();
      zoomAt(e.clientX - b.left, e.clientY - b.top, viewRef.current.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!full) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [full]);

  // Opening a node's details: glide the canvas so that node isn't hidden under the panel (wide screens).
  const [smooth, setSmooth] = useState(false);
  useEffect(() => {
    if (sel?.type !== 'node' || !vp.current || !byId[sel.id] || byId[sel.id].kind === 'add') return;
    const b = rectOf();
    if (b.width < 720) return;
    const n = byId[sel.id],
      p = at(sel.id),
      v = viewRef.current;
    const left = v.x + p.x * v.k,
      right = left + n.w * v.k,
      panel = b.width - 364;
    let dx = 0;
    if (right > panel - 8) dx = panel - 8 - right;
    if (left + dx < 12) dx = 12 - left;
    if (Math.abs(dx) < 2) return;
    touched.current = true;
    setSmooth(true);
    setView((x) => ({ ...x, x: x.x + dx }));
    const t = setTimeout(() => setSmooth(false), 360);
    return () => clearTimeout(t);
  }, [sel?.type === 'node' ? sel.id : '']); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = (from: Any, id: string) => {
    const n = byId[id];
    if (!n) return false;
    if (from.kind === 'task') return n.kind === 'tier' || n.kind === 'config';
    return n.kind === 'provider' && id !== from.node;
  };
  const capture = (e: React.PointerEvent) => {
    try {
      vp.current?.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone: the gesture still works without capture */
    }
  };
  const down = (e: React.PointerEvent) => {
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      drag.current = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), k0: viewRef.current.k };
      return;
    }
    const t = e.target as HTMLElement;
    if (t.closest('.flow-ui')) return;
    const port = t.closest<HTMLElement>('[data-port="out"]');
    const nodeEl = t.closest<HTMLElement>('[data-node]');
    if (port) {
      capture(e);
      const from = port.dataset.row
        ? { kind: 'task', node: port.dataset.node!, row: port.dataset.row }
        : { kind: 'prov', node: port.dataset.node! };
      drag.current = { type: 'conn', from, sx: e.clientX, sy: e.clientY, moved: false };
      setConn({ from, cur: toWorld(e), over: '' });
      e.preventDefault();
    } else if (nodeEl && !t.closest('button, input, select, textarea, a, [data-nodrag]')) {
      capture(e);
      const w = toWorld(e),
        p = at(nodeEl.dataset.node!);
      drag.current = { type: 'node', id: nodeEl.dataset.node!, ox: w.x - p.x, oy: w.y - p.y, sx: e.clientX, sy: e.clientY, moved: false };
    } else if (!nodeEl && !t.closest('[data-edge], .flow-edge-x')) {
      capture(e);
      drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y, moved: false };
    }
  };
  const move = (e: React.PointerEvent) => {
    if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (!d) return;
    if (d.type === 'pinch' && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()];
      const bb = rectOf();
      zoomAt((a.x + b.x) / 2 - bb.left, (a.y + b.y) / 2 - bb.top, d.k0 * (Math.hypot(a.x - b.x, a.y - b.y) / d.d0));
      return;
    }
    const dist = Math.hypot(e.clientX - d.sx, e.clientY - d.sy);
    if (dist > 4) d.moved = true;
    if (d.type === 'pan') {
      if (d.moved) touched.current = true;
      setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
    } else if (d.type === 'node' && d.moved) {
      const w = toWorld(e);
      setPos((p) => ({ ...p, [d.id]: { x: Math.round(w.x - d.ox), y: Math.round(w.y - d.oy) } }));
    } else if (d.type === 'conn') setConn((cn: Any) => cn && { ...cn, cur: toWorld(e), over: nodeAt(e) });
  };
  const up = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    const d = drag.current;
    if (d?.type === 'pinch') {
      if (pts.current.size < 2) {
        drag.current = null;
        persist();
      }
      return;
    }
    drag.current = null;
    if (!d) return;
    try {
      vp.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    if (d.type === 'conn') {
      const target = nodeAt(e);
      setConn(null);
      if (d.moved && target && valid(d.from, target)) {
        if (d.from.kind === 'task')
          setTaskTier(d.from.row, byId[target].kind === 'tier' ? byId[target].data.tier : `cfg:${byId[target].data.id}`);
        else setFallback(d.from.node, target);
      } else if (!d.moved) setSel({ type: 'node', id: d.from.node });
    } else if (d.type === 'node') {
      if (!d.moved) setSel({ type: 'node', id: d.id });
      else persist();
    } else if (d.type === 'pan') {
      if (!d.moved) setSel(null);
      else persist();
    }
  };

  if (!r)
    return (
      <div className="card">
        <p className="muted small">The AI settings couldn’t be loaded.</p>
      </div>
    );
  const zoomBy = (f: number) => {
    const b = rectOf();
    zoomAt(b.width / 2, b.height / 2, view.k * f);
  };
  const resetLayout = () => {
    setPos({});
    touched.current = false;
    persist({}, view);
    setFitted(false);
  };
  const selNode = sel?.type === 'node' ? byId[sel.id] : null;
  const selEdge = sel?.type === 'edge' ? edges.find((e) => e.id === sel.id) : null;
  const overOk = conn && conn.over && valid(conn.from, conn.over) ? conn.over : '';
  const ghost = conn ? (conn.from.kind === 'task' ? outP(conn.from.node, conn.from.row) : botP(conn.from.node)) : null;
  const ghostPath = conn && ghost ? (conn.from.kind === 'task' ? hpath(ghost, conn.cur) : vpath(ghost, conn.cur)) : '';

  // ---- node faces
  const state = (n: FNode): State => {
    if (n.kind === 'provider') return stateOf(n.data);
    if (n.kind === 'local') {
      if (n.data.which === 'claude')
        return c.account?.cooldown
          ? { k: 'warn', label: 'Limited' }
          : c.account?.signedIn
            ? { k: 'ok', label: 'Signed in' }
            : { k: 'bad', label: 'Not signed in' };
      return c.copilot?.cooldown
        ? { k: 'warn', label: 'Limited' }
        : c.copilot?.available
          ? { k: c.localEngine === 'copilot' ? 'ok' : 'idle', label: c.localEngine === 'copilot' ? 'Local AI' : 'Backup' }
          : { k: 'off', label: 'Not installed' };
    }
    return { k: 'idle', label: '' };
  };
  const tierCount = (k: string) => tasks.filter((t) => (r.tiers?.[t.id] || t.tier) === k).length;
  const cfgCount = (id: string) => tasks.filter((t) => r.tiers?.[t.id] === `cfg:${id}`).length;

  const face = (n: FNode) => {
    const st = state(n);
    const test = tests[n.id];
    if (n.kind === 'group') {
      const color = GROUP_COLOR[n.data.group] || '#7c8aa0';
      return (
        <>
          <div className="fn-h" style={{ ['--c' as string]: color }}>
            <i aria-hidden />
            <b>{n.data.group}</b>
            <span>{(n.rows || []).length} tasks</span>
          </div>
          <div className="fn-rows">
            {(n.rows || []).map((t) => {
              const tgt = r.tiers?.[t.id] || t.tier;
              const isCfg = /^cfg:/.test(tgt);
              const cf = isCfg ? configs.find((x) => `cfg:${x.id}` === tgt) : null;
              const col = isCfg ? '#8b5cf6' : TIER[tgt]?.color;
              return (
                <div
                  key={t.id}
                  className={`fn-row ${sel?.type === 'edge' && sel.id === `task:${t.id}` ? 'on' : ''}`}
                  title={`${t.label}: ${t.desc}`}
                >
                  <span className="fn-row-l">{t.label}</span>
                  <em style={{ ['--c' as string]: col } as React.CSSProperties}>{isCfg ? cf?.name || 'Config' : TIER[tgt]?.label}</em>
                  <span
                    className="fn-port out"
                    data-port="out"
                    data-node={n.id}
                    data-row={t.id}
                    style={{ ['--c' as string]: col } as React.CSSProperties}
                    title={`Drag to a tier to choose what “${t.label}” runs on`}
                  />
                </div>
              );
            })}
          </div>
        </>
      );
    }
    if (n.kind === 'tier') {
      const k = n.data.tier;
      const m = TIER[k];
      return (
        <>
          <span className="fn-port in" data-port="in" />
          <div
            className="fn-tier-h"
            style={{ background: `linear-gradient(135deg, ${m.color}, color-mix(in srgb, ${m.color} 55%, #000))` }}
          >
            <b>{m.label}</b>
            <span>{m.hint}</span>
          </div>
          <div className="fn-tier-b">
            <b>{tierCount(k)}</b> task{tierCount(k) === 1 ? '' : 's'} run here
            <small>{routingOn ? 'on the first AI that’s available' : 'Routing is off'}</small>
          </div>
          <span className="fn-port out" data-port="none" />
        </>
      );
    }
    if (n.kind === 'config') {
      const cf = n.data;
      return (
        <>
          <span className="fn-port in" data-port="in" />
          <div className="fn-cfg">
            <span className="fn-cfg-i" aria-hidden>
              ⚙
            </span>
            <div>
              <b>{cf.name}</b>
              <small>
                {cf.engine === 'api'
                  ? apis.find((x) => x.entryId === cf.providerId)?.label || 'API'
                  : cf.engine === 'copilot'
                    ? 'GitHub Copilot'
                    : 'Claude account'}
                {cf.model ? ` · ${cf.model}` : ''}
              </small>
            </div>
          </div>
          <div className="fn-foot">
            <small>
              {cfgCount(cf.id)} task{cfgCount(cf.id) === 1 ? '' : 's'} routed here
            </small>
          </div>
          <span className="fn-port out" data-port="none" />
        </>
      );
    }
    if (n.kind === 'gateway') {
      const active = apis.find((x) => x.active);
      return (
        <>
          <span className="fn-port in" data-port="in" />
          <div className="fn-gw">
            <span className={`fn-gw-i ${routingOn ? 'live' : ''}`} aria-hidden>
              ⇢
            </span>
            <b>Router</b>
            <small>{routingOn ? 'Picks the first available AI' : 'Routing off'}</small>
            {(active || localMode) && (
              <small className="fn-now">
                Now: <b>{localMode && !c.switched ? 'Claude account' : active?.label || '—'}</b>
              </small>
            )}
          </div>
          <span className="fn-port out" data-port="none" />
        </>
      );
    }
    if (n.kind === 'add')
      return (
        <button type="button" className="fn-add" onClick={actions.add} data-nodrag>
          <Ico svg={I.plus} />
          Add provider
        </button>
      );
    // provider / local
    const x = n.data;
    const isLocal = n.kind === 'local';
    const label = isLocal ? (x.which === 'claude' ? 'Claude account' : 'GitHub Copilot') : x.label;
    const model = isLocal
      ? x.which === 'claude'
        ? 'Claude Code on this computer'
        : `Copilot${c.copilotModel ? ` · ${c.copilotModel}` : ''}`
      : x.model || '';
    const idx = chain.indexOf(n.id);
    return (
      <>
        {idx > 0 ? <span className="fn-port top" data-port="in" /> : <span className="fn-port in" data-port="in" />}
        <div className="fn-p">
          <span className="fn-av" style={{ background: `hsl(${hue(isLocal ? x.which : x.id)} 55% 42%)` }} aria-hidden>
            {isLocal ? (x.which === 'claude' ? 'C' : 'G') : String(label).slice(0, 1).toUpperCase()}
          </span>
          <div className="fn-pt">
            <b>{label}</b>
            {model && <code>{model}</code>}
          </div>
          <span className={`fn-st s-${st.k}`} title={st.title}>
            {st.label}
          </span>
        </div>
        <div className="fn-pf" data-nodrag>
          <span className="fn-n" title="Priority: the first available AI answers">
            #{idx + 1}
          </span>
          {!isLocal && (
            <label className="fn-sw" title={x.enabled ? 'Turn off' : 'Turn on'}>
              <input
                type="checkbox"
                checked={x.enabled}
                disabled={x.source !== 'panel' || busy === `on:${x.entryId}`}
                onChange={(e) => toggleProvider(x, e.target.checked)}
              />
              <i />
            </label>
          )}
          <button
            type="button"
            className="fn-btn"
            disabled={!!busy || (!isLocal && !x.configured)}
            onClick={() => testNode(n.id)}
            title="Test the connection"
          >
            {test?.running ? (
              <Spinner />
            ) : test?.ok === true ? (
              <span className="ok">✓</span>
            ) : test?.ok === false ? (
              <span className="bad">✕</span>
            ) : (
              <Ico svg={I.play} />
            )}
            {test?.running ? 'Testing' : test?.ok === true ? `${(test.ms / 1000).toFixed(1)}s` : test?.ok === false ? 'Failed' : 'Test'}
          </button>
          <button type="button" className="fn-btn ghost" onClick={() => setSel({ type: 'node', id: n.id })} aria-label={`${label} details`}>
            Details
          </button>
        </div>
        <span
          className="fn-port out bottom"
          data-port="out"
          data-node={n.id}
          title="Drag to another provider to try it next, after this one"
        />
        <span className="fn-port out right" data-port="none" />
      </>
    );
  };

  // ---- the details panel
  const tierRow = (k: string, node: Any) => {
    const placeholder =
      node.kind === 'local'
        ? node.data.which === 'claude'
          ? c.claudeTiers?.[k]
          : 'Same as Local AI'
        : node.data.model || c.tierHints?.[node.data.id]?.[k] || 'Provider’s model';
    if (node.kind === 'local' && node.data.which === 'copilot') {
      return (
        <SF value={r.copilot?.[k] || ''} onChange={(e) => setR((x: Any) => ({ ...x, copilot: { ...x.copilot, [k]: e.target.value } }))}>
          {(c.copilot?.models || ['']).map((m: string) => (
            <MenuItem key={m || 'd'} value={m}>
              {m || 'Same as Local AI'}
            </MenuItem>
          ))}
        </SF>
      );
    }
    if (node.kind === 'local')
      return (
        <PeopleF
          avatars={false}
          value={r.claude?.[k] || ''}
          onChange={(v) => setR((x: Any) => ({ ...x, claude: { ...x.claude, [k]: v.trim() } }))}
          options={CLAUDE_OPTIONS}
          placeholder={placeholder}
        />
      );
    const opts = [...new Set([c.tierHints?.[node.data.id]?.[k], node.data.model].filter(Boolean))] as string[];
    return (
      <PeopleF
        avatars={false}
        value={r.api?.[node.data.entryId]?.[k] || ''}
        onChange={(v) =>
          setR((x: Any) => ({
            ...x,
            api: {
              ...x.api,
              [node.data.entryId]: { high: '', standard: '', light: '', ...(x.api?.[node.data.entryId] || {}), [k]: v.trim() },
            },
          }))
        }
        options={opts}
        placeholder={placeholder}
      />
    );
  };
  const modelBar = dirty && (
    <div className="fi-save">
      <span>Unsaved model changes</span>
      <button type="button" className="btn sm" onClick={() => setR(JSON.parse(savedKey))}>
        Discard
      </button>
      <button
        type="button"
        className="btn sm primary"
        disabled={saving}
        onClick={() => patchRouting(r, 'Models saved. New AI work uses them right away.')}
      >
        {saving ? <Spinner /> : 'Save'}
      </button>
    </div>
  );
  const inspector = () => {
    if (selEdge) {
      if (selEdge.kind === 'route') {
        const t = tasks.find((x) => x.id === selEdge.task);
        return (
          <>
            <h4>Route: {t?.label}</h4>
            <p className="muted small">{t?.desc}</p>
            <label className="field">
              <span>Runs on</span>
              <SF value={r.tiers?.[t.id] || t.tier} onChange={(e) => setTaskTier(t.id, String(e.target.value))}>
                {tiers.map((k) => (
                  <MenuItem key={k} value={k}>
                    {TIER[k].label} · {TIER[k].hint}
                  </MenuItem>
                ))}
                {configs.map((x) => (
                  <MenuItem key={x.id} value={`cfg:${x.id}`}>
                    Configuration: {x.name}
                  </MenuItem>
                ))}
              </SF>
            </label>
            <button type="button" className="btn sm" onClick={() => resetTask(t.id)}>
              Disconnect: back to the default ({TIER[t.tier].label})
            </button>
          </>
        );
      }
      return (
        <>
          <h4>{selEdge.kind === 'fallback' ? 'Fallback' : 'Connection'}</h4>
          <p className="muted small">
            {selEdge.kind === 'fallback'
              ? 'If the provider above is limited, out of credits or failing, TicketForge tries this one, and tries the first again later. Drag a provider’s bottom dot onto another to change the order.'
              : 'Every tier goes to the router, which picks the first AI that’s available.'}
          </p>
        </>
      );
    }
    if (!selNode) return null;
    const n = selNode;
    if (n.kind === 'group') {
      return (
        <>
          <h4>{n.data.group}</h4>
          <p className="muted small">Choose what each task runs on. You can also drag from a task’s dot to a tier.</p>
          <div className="fi-list">
            {(n.rows || []).map((t) => (
              <label key={t.id} className="fi-task">
                <span>
                  <b>{t.label}</b>
                  <small>{t.desc}</small>
                </span>
                <SF value={r.tiers?.[t.id] || t.tier} onChange={(e) => setTaskTier(t.id, String(e.target.value))}>
                  {tiers.map((k) => (
                    <MenuItem key={k} value={k}>
                      {TIER[k].label}
                    </MenuItem>
                  ))}
                  {configs.map((x) => (
                    <MenuItem key={x.id} value={`cfg:${x.id}`}>
                      Config: {x.name}
                    </MenuItem>
                  ))}
                </SF>
              </label>
            ))}
          </div>
        </>
      );
    }
    if (n.kind === 'tier') {
      const k = n.data.tier;
      return (
        <>
          <h4>
            <i className="fi-dot" style={{ background: TIER[k].color }} />
            {TIER[k].label} tier
          </h4>
          <p className="muted small">
            {TIER[k].hint}. {tierCount(k)} task{tierCount(k) === 1 ? '' : 's'} run here.
          </p>
          <div className="fi-chips">
            {tasks
              .filter((t) => (r.tiers?.[t.id] || t.tier) === k)
              .map((t) => (
                <span key={t.id}>{t.label}</span>
              ))}
          </div>
          <h5>Model on each AI</h5>
          {chain.map((id) => (
            <label key={id} className="field">
              <span>{id.startsWith('a:') ? (id === 'a:claude' ? 'Claude account' : 'GitHub Copilot') : byId[id].data.label}</span>
              {tierRow(k, byId[id])}
            </label>
          ))}
          {!chain.length && <p className="muted small">Add a provider first.</p>}
          {modelBar}
        </>
      );
    }
    if (n.kind === 'config') {
      const cf = n.data;
      return (
        <>
          <h4>{cf.name}</h4>
          <p className="muted small">A named AI setup. Tasks you wire here run on it, and people can pick it on any AI button.</p>
          <table className="fi-kv">
            <tbody>
              <tr>
                <td>Runs on</td>
                <td>
                  {cf.engine === 'api'
                    ? apis.find((x) => x.entryId === cf.providerId)?.label || 'An AI API'
                    : cf.engine === 'copilot'
                      ? 'GitHub Copilot'
                      : 'Claude account'}
                </td>
              </tr>
              <tr>
                <td>Model</td>
                <td>{cf.model || 'Default'}</td>
              </tr>
              <tr>
                <td>Reasoning</td>
                <td>{cf.reasoning || 'Default'}</td>
              </tr>
            </tbody>
          </table>
          <button type="button" className="btn sm" onClick={() => actions.goto('configs')}>
            Edit in Configurations
          </button>
        </>
      );
    }
    if (n.kind === 'gateway') {
      return (
        <>
          <h4>Router</h4>
          <p className="muted small">
            Every request arrives here from its tier and goes to the first AI that’s available. If it’s limited or failing, the next one is
            tried, and the first again later.
          </p>
          <label className="fi-sw">
            <input
              type="checkbox"
              checked={routingOn}
              disabled={saving}
              onChange={(e) =>
                patchRouting({ ...r, enabled: e.target.checked }, e.target.checked ? 'Model routing is on' : 'Model routing is off')
              }
            />
            <span>
              <b>Model routing</b>
              <small>Each task uses its tier’s model. Off: every task uses the AI’s own model.</small>
            </span>
          </label>
          {localMode && (
            <label className="fi-sw">
              <input
                type="checkbox"
                checked={c.accountFallback !== false}
                disabled={saving}
                onChange={(e) => patch({ accountFallback: e.target.checked })}
              />
              <span>
                <b>Use the providers when the local AI can’t</b>
                <small>Not installed, not signed in, or limit reached.</small>
              </span>
            </label>
          )}
          {(c.apis || []).some((x: Any) => x.cooldown) && (
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                setBusy('reset');
                try {
                  actions.onSaved(await api('/api/admin/ai', { method: 'POST', body: { action: 'reset' } }));
                } finally {
                  setBusy('');
                }
              }}
            >
              Clear all cooldowns
            </button>
          )}
        </>
      );
    }
    if (n.kind === 'add') return null;
    const x = n.data;
    const isLocal = n.kind === 'local';
    const st = state(n);
    const test = tests[n.id];
    const label = isLocal ? (x.which === 'claude' ? 'Claude account' : 'GitHub Copilot') : x.label;
    return (
      <>
        <h4>
          {label}
          <span className={`fn-st s-${st.k}`} title={st.title}>
            {st.label}
          </span>
        </h4>
        {!isLocal && (
          <table className="fi-kv">
            <tbody>
              <tr>
                <td>Model</td>
                <td>{x.model || 'Provider’s default'}</td>
              </tr>
              {x.kind === 'openai' && x.baseUrl && (
                <tr>
                  <td>Endpoint</td>
                  <td>{x.baseUrl}</td>
                </tr>
              )}
              <tr>
                <td>Set up</td>
                <td>{x.source === 'panel' ? 'In this panel' : 'With environment variables'}</td>
              </tr>
              <tr>
                <td>Key</td>
                <td>
                  {c.settings?.providers?.find((y: Any) => y.id === x.entryId)?.keyHint
                    ? `ends with ${c.settings.providers.find((y: Any) => y.id === x.entryId).keyHint}`
                    : x.keySet
                      ? 'saved'
                      : 'none'}
                </td>
              </tr>
            </tbody>
          </table>
        )}
        {isLocal && x.which === 'claude' && (
          <p className="muted small">
            Claude Code on this computer, with your own subscription.{' '}
            {c.account?.subscriptionType ? `Plan: ${c.account.subscriptionType}.` : ''}
          </p>
        )}
        {!isLocal && x.cooldown && (
          <div className="warn-banner">
            <Ico svg={I.warn} />
            <span>
              {x.cooldown.message || x.cooldown.reason}{' '}
              <button type="button" className="link-btn" onClick={() => retry(x)}>
                Retry now
              </button>
            </span>
          </div>
        )}
        {test &&
          !test.running &&
          (test.ok ? (
            <div className="ok-banner">
              <Ico svg={I.check} />
              <span>Connected. The AI replied in {(test.ms / 1000).toFixed(1)} s.</span>
            </div>
          ) : (
            <div className="warn-banner danger">
              <Ico svg={I.warn} />
              <span>{test.error}</span>
            </div>
          ))}
        <div className="row" style={{ gap: 8, margin: '10px 0' }}>
          <button type="button" className="btn sm" disabled={!!busy} onClick={() => testNode(n.id)}>
            {test?.running ? (
              <>
                <Spinner />
                Testing
              </>
            ) : (
              'Test connection'
            )}
          </button>
          {!isLocal && x.source === 'panel' && (
            <button type="button" className="btn sm subtle" onClick={() => actions.edit(x)}>
              Edit
            </button>
          )}
          {!isLocal && x.source === 'panel' && (
            <button type="button" className="btn sm subtle" onClick={() => actions.remove(x)}>
              Remove
            </button>
          )}
        </div>
        <h5>Model for each tier</h5>
        <p className="muted small" style={{ marginTop: 0 }}>
          Blank uses the provider’s own model.
        </p>
        {tiers.map((k) => (
          <label key={k} className="field">
            <span>
              <i className="fi-dot" style={{ background: TIER[k].color }} />
              {TIER[k].label}
            </span>
            {tierRow(k, n)}
          </label>
        ))}
        {modelBar}
      </>
    );
  };

  const showInspector = Boolean(selNode?.kind !== 'add' && (selNode || selEdge));
  return (
    <div
      className={`flow ${full ? 'full' : ''} ${conn ? 'wiring' : ''} ${showInspector ? 'has-insp' : ''}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selEdge?.kind === 'route') {
          e.preventDefault();
          resetTask(selEdge.task);
        } else if (e.key === 'Escape') setSel(null);
      }}
    >
      <div className="flow-ui flow-top">
        <button type="button" className="btn sm primary" onClick={actions.add}>
          <Ico svg={I.plus} />
          Add provider
        </button>
        <label className="fi-sw inline" title="When off, every task uses the AI’s own model">
          <input
            type="checkbox"
            checked={routingOn}
            disabled={saving}
            onChange={(e) =>
              patchRouting({ ...r, enabled: e.target.checked }, e.target.checked ? 'Model routing is on' : 'Model routing is off')
            }
          />
          <span>Model routing</span>
        </label>
        <span className="flow-status" role="status">
          {saving ? (
            <>
              <Spinner />
              Saving…
            </>
          ) : dirty ? (
            'Unsaved model changes'
          ) : (
            'Saved'
          )}
        </span>
        <span className="flow-hint">
          Drag a task’s dot onto a tier · drag a provider’s bottom dot onto another to set the fallback order
        </span>
      </div>
      <div className="flow-ui flow-zoom">
        <button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom out">
          −
        </button>
        <span>{Math.round(view.k * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={refit} aria-label="Fit everything" title="Fit everything">
          ⤢
        </button>
        <button type="button" className="flow-reset" onClick={resetLayout} title="Put the nodes back where they started">
          Reset layout
        </button>
        <button
          type="button"
          onClick={() => setFull(!full)}
          aria-label={full ? 'Exit full screen' : 'Full screen'}
          title={full ? 'Exit full screen (Esc)' : 'Full screen'}
        >
          {full ? '⤡' : '⛶'}
        </button>
      </div>

      <div
        className="flow-vp"
        ref={vp}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{ backgroundSize: `${22 * view.k}px ${22 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      >
        <div
          className={`flow-world ${smooth ? 'smooth' : ''}`}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
        >
          <svg className="flow-wires" width="1" height="1" aria-hidden>
            {edges.map((e) => {
              const d = pathOf(e);
              const on = sel?.type === 'edge' && sel.id === e.id;
              return (
                <g
                  key={e.id}
                  className={`fw ${e.kind} ${on ? 'on' : ''} ${(e.kind === 'route' || e.kind === 'tier') && !routingOn ? 'dim' : ''}`}
                  style={{ ['--c' as string]: e.color } as React.CSSProperties}
                >
                  <path className="fw-line" d={d} />
                  <path className="fw-hit" d={d} data-edge={e.id} onClick={() => setSel({ type: 'edge', id: e.id })} />
                </g>
              );
            })}
            {conn && ghost && <path className={`fw-ghost ${overOk ? 'ok' : ''}`} d={ghostPath} />}
          </svg>
          {nodes.map((n) => {
            const p = at(n.id);
            const st = state(n);
            const cls = [
              'fn',
              `k-${n.kind}`,
              sel?.type === 'node' && sel.id === n.id ? 'sel' : '',
              st.k ? `s-${st.k}` : '',
              conn && valid(conn.from, n.id) ? 'drop-ok' : '',
              overOk === n.id ? 'drop-over' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div
                key={n.id}
                className={cls}
                data-node={n.id}
                role="group"
                aria-label={
                  n.kind === 'group'
                    ? `${n.data.group} tasks`
                    : n.kind === 'tier'
                      ? `${TIER[n.data.tier].label} tier`
                      : n.kind === 'gateway'
                        ? 'Router'
                        : n.kind === 'add'
                          ? 'Add a provider'
                          : n.data.label || n.data.name || n.id
                }
                tabIndex={n.kind === 'add' ? -1 : 0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && n.kind !== 'add' && e.target === e.currentTarget) setSel({ type: 'node', id: n.id });
                }}
                style={{ left: p.x, top: p.y, width: n.w, height: n.kind === 'group' ? undefined : n.h, minHeight: n.h }}
              >
                {face(n)}
              </div>
            );
          })}
          {selEdge?.kind === 'route' &&
            (() => {
              const a = outP(selEdge.from, selEdge.task),
                b = inP(selEdge.to);
              return (
                <button
                  type="button"
                  className="flow-edge-x"
                  style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 }}
                  onClick={() => resetTask(selEdge.task)}
                  aria-label="Disconnect: back to the default"
                  title="Disconnect: back to the default"
                >
                  ×
                </button>
              );
            })()}
        </div>
      </div>

      {showInspector && (
        <aside className="flow-ui flow-insp" aria-label="Details">
          <button type="button" className="icon-btn flow-insp-x" onClick={() => setSel(null)} aria-label="Close details">
            <Ico svg={I.close} />
          </button>
          {inspector()}
        </aside>
      )}
      {!nodes.some((n) => n.kind === 'provider' || n.kind === 'local') && (
        <div className="flow-ui flow-empty">
          <b>No AI providers yet</b>
          <span>Add one, then wire your tasks to it.</span>
          <button type="button" className="btn sm primary" onClick={actions.add}>
            <Ico svg={I.plus} />
            Add provider
          </button>
        </div>
      )}
    </div>
  );
}

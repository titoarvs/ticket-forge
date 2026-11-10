'use client';
// Client state, data model helpers, history, undo, saving and sync.
// State lives in one mutable object `S`; any change calls emit(), and components re-render via useStore().
import { useSyncExternalStore, type ReactNode } from 'react';

export type Any = any;

export const uid = () => (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 8);
export const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
export const nowIso = () => new Date().toISOString();
export const store = {
  get(k: string, d: Any) { try { return JSON.parse(localStorage.getItem(k) as string) ?? d; } catch { return d; } },
  set(k: string, v: Any) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
export function ago(iso?: string) {
  if (!iso) return '';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
export const fmtDate = (d: Any) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
export const dateInput = (d: Any) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export const TYPES = ['Story', 'Task', 'Bug', 'Spike'];
export const PRIORITIES = ['Highest', 'High', 'Medium', 'Low'];
export const TC_TYPES = ['Functional', 'Negative', 'Edge', 'UI', 'Integration', 'Security', 'Performance', 'Accessibility'];
export const TC_STATUS = ['Not run', 'Pass', 'Fail', 'Blocked'];
export const CATEGORIES: [string, string][] = [['todo', 'To do'], ['inprogress', 'In progress'], ['done', 'Done']];
export const COLORS = ['#6e5dc6', '#0c66e4', '#1f845a', '#e06c00', '#c9372c', '#206a83', '#943d73', '#5b7f24', '#b65c02', '#626f86'];
export const AVATAR_COLORS = ['#0c66e4', '#1f845a', '#6e5dc6', '#c9372c', '#a54800', '#206a83', '#943d73', '#5e4db2'];
export const LINK_TYPES: Record<string, string> = { blocks: 'is blocked by', 'is blocked by': 'blocks', 'relates to': 'relates to', duplicates: 'is duplicated by', 'is duplicated by': 'duplicates', clones: 'is cloned by', 'is cloned by': 'clones' };
export const DEFAULT_WORKFLOW = [
  { id: 'todo', name: 'To Do', category: 'todo' },
  { id: 'inprogress', name: 'In Progress', category: 'inprogress' },
  { id: 'inreview', name: 'In Review', category: 'inprogress' },
  { id: 'done', name: 'Done', category: 'done' },
];
export const EMPTY_FILTER = () => ({ q: '', type: '', priority: '', status: '', epic: '', assignee: '' });

// ---------------------------------------------------------------- state
export const S: Any = {
  ready: false,
  user: null, auth: null, people: [], base: null, saving: false,
  status: null, engine: null,
  settings: { provider: '', model: '' },
  projects: [], projectQuery: '',
  project: null, loadingProject: null,
  drawer: null, full: false,
  filter: EMPTY_FILTER(), tcFilter: { q: '', status: '', type: '' },
  groupBy: 'sprint', boardAll: false, boardGroup: 'none',
  collapsed: new Set<string>(), detailsOpen: true, actTab: 'comments', sideCollapsed: false, autoTab: 'results', drawerW: null as number | null, tlZoom: 'months', tlOpen: new Set<string>(), boardCollapsed: new Set<string>(), sourceDoc: null as string | null, setTab: 'details',
  inlineCreate: null, subForm: false, linkForm: false, prForm: false, cmtEdit: null,
  checked: new Set<string>(), openTc: new Set<string>(),
  // testsPerTicket: null = the team default (Administration → Generation)
  doc: null, genOpts: { projectKey: '', granularity: 'balanced', includeTests: true, testsPerTicket: null, instructions: '' }, gen: null,
  busy: null, autoRun: null, autoScope: 'all', autoRegen: false,
  undo: [] as string[], redo: [] as string[], lastSnap: { tag: '', at: 0 },
  saveTimer: null, saveText: '',
  menu: null, modal: null as ReactNode, toasts: [] as Any[],
  notifs: { items: [] as Any[], unread: 0 },
  nav: (href: string) => { location.href = href; },
};

let tick = 0;
const listeners = new Set<() => void>();
export function emit() { tick += 1; listeners.forEach((l) => l()); }
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
/** Re-render the calling component whenever state changes. */
export function useStore() { useSyncExternalStore(subscribe, () => tick, () => 0); return S; }

export function loadPrefs() {
  const ui = store.get('tf.ui', {});
  Object.assign(S, {
    settings: store.get('tf.settings', { provider: '', model: '' }),
    // Older saves stored the old fixed default (4); only a number the user picked on purpose is kept.
    genOpts: (({ testsPerTicket, testsPicked, ...g }: Any) => ({ ...S.genOpts, ...g, testsPerTicket: testsPicked ? testsPerTicket : null, testsPicked: Boolean(testsPicked) }))(store.get('tf.genOpts', S.genOpts)),
    groupBy: ui.groupBy || 'sprint', boardGroup: ui.boardGroup || 'none',
    collapsed: new Set(ui.collapsed || []), detailsOpen: ui.detailsOpen ?? true, actTab: ui.actTab || 'comments', sideCollapsed: Boolean(ui.sideCollapsed), autoTab: ui.autoTab || 'results', drawerW: Number(ui.drawerW) || null, tlZoom: ui.tlZoom || 'months', tlOpen: new Set(ui.tlOpen || []), boardCollapsed: new Set(ui.boardCollapsed || []), setTab: ui.setTab || 'details',
  });
}
export const saveUi = () => store.set('tf.ui', { groupBy: S.groupBy, boardGroup: S.boardGroup, collapsed: [...S.collapsed], detailsOpen: S.detailsOpen, actTab: S.actTab, sideCollapsed: S.sideCollapsed, autoTab: S.autoTab, drawerW: S.drawerW, tlZoom: S.tlZoom, tlOpen: [...S.tlOpen], boardCollapsed: [...S.boardCollapsed], setTab: S.setTab });
/** Collapses the project sidebar to an icon rail, or expands it again (remembered per browser). */
export function toggleSidebar(force?: boolean) { S.sideCollapsed = force ?? !S.sideCollapsed; saveUi(); emit(); }

// ---------------------------------------------------------------- api & feedback
export async function api(url: string, { method = 'GET', body, raw, signal }: { method?: string; body?: Any; raw?: boolean; signal?: AbortSignal } = {}): Promise<Any> {
  const opts: RequestInit = { method, headers: {}, signal };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); (opts.headers as Any)['Content-Type'] = 'application/json'; }
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    if (res.status === 401 && S.user && !url.startsWith('/api/auth/')) { S.user = null; emit(); S.nav('/login'); }
    const err: Any = new Error(msg); err.status = res.status;
    throw err;
  }
  return raw ? res : res.json();
}
/** PDF and Word originals are kept so the Source documents page can show them as written. */
export const keepsOriginal = (f?: File | null) => Boolean(f && /\.(pdf|docx)$/i.test(f.name));
export async function uploadOriginal(projectId: string, file: File, target?: 'original') {
  const fd = new FormData();
  fd.append('file', file);
  if (target) fd.append('target', target);
  return api(`/api/projects/${projectId}/files`, { method: 'POST', body: fd });
}
export const aiBody = (b: Any) => ({ ...b, provider: S.settings.provider || undefined, model: S.settings.model || undefined, project: b.project && slimProject(b.project) });
export function slimProject(p: Any) {
  return {
    ...p, sourceText: undefined, sources: undefined,
    tickets: p.tickets.map((t: Any) => ({ ...t, history: undefined, comments: undefined, testCases: t.testCases.map((tc: Any) => ({ ...tc, script: undefined, lastRun: undefined })) })),
  };
}
export async function readNdjson(res: Response, onEvent: (ev: Any) => void | Promise<void>) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) { const ev = JSON.parse(line); if (ev.type !== 'ping') await onEvent(ev); }
    }
  }
}

/**
 * Saves a file from the server. Checks the response really is the file (a JSON error becomes a readable message),
 * clicks a link attached to the page (some browsers ignore detached links) and keeps the blob URL alive long enough
 * for Safari and Firefox to finish saving (revoking it after a moment cancels big downloads there).
 */
export async function downloadFrom(url: string, { method = 'POST', body, fallbackName = 'download' }: { method?: string; body?: Any; fallbackName?: string } = {}) {
  const res = await api(url, { method, body, raw: true });
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    let msg = 'The server didn’t send a file.';
    try { msg = (await res.json()).error || msg; } catch { /* keep the message */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error('The server sent an empty file. Try again.');
  const cd = res.headers.get('content-disposition') || '';
  const name = decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || cd.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName);
  saveBlob(blob, name);
  return name;
}
/** Saves a blob made in the browser (e.g. Markdown) under a file name. */
export function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

export function toast(msg: string, kind: 'ok' | 'err' = 'ok') {
  const t = { id: uid(), msg, kind };
  S.toasts = [...S.toasts, t];
  emit();
  setTimeout(() => { S.toasts = S.toasts.filter((x: Any) => x.id !== t.id); emit(); }, kind === 'err' ? 8000 : 3500);
}
export async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  if (S.busy) { toast('Claude is still working on the previous request.', 'err'); return null; }
  S.busy = label; emit();
  try { return await fn(); }
  catch (e: Any) { toast(`Claude: ${e.message}`, 'err'); return null; }
  finally { S.busy = null; emit(); }
}
export function setBusy(label: string | null) { S.busy = label; emit(); }
export function openModal(node: ReactNode) { S.modal = node; emit(); }
export function closeModal() { S.modal = null; emit(); }
export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  catch { toast('Copy failed — select the link and copy it manually.', 'err'); }
}
export function setMenu(m: string | null) { S.menu = S.menu === m ? null : m; emit(); }

// ---------------------------------------------------------------- model helpers
export const P = () => S.project;
export const ticket = (id: string) => P()?.tickets.find((t: Any) => t.id === id);
export const epic = (id: string) => P()?.epics.find((e: Any) => e.id === id);
export const sprint = (id: string) => P()?.sprints.find((s: Any) => s.id === id);
export const isSub = (t: Any) => t?.type === 'Sub-task';
export const childrenOf = (t: Any) => P().tickets.filter((x: Any) => x.parentId === t.id);
export const epicTickets = (eid: string) => P().tickets.filter((t: Any) => t.epicId === eid && !isSub(t));
export const noEpic = () => P().tickets.filter((t: Any) => !isSub(t) && !epic(t.epicId));
export const activeSprint = () => P().sprints.find((s: Any) => s.state === 'active');
export const openSprints = () => P().sprints.filter((s: Any) => s.state !== 'closed');
export const tcKey = (t: Any, i: number) => `TC-${t.key}-${String(i + 1).padStart(2, '0')}`;
export const spSum = (list: Any[]) => list.reduce((s, t) => s + (Number(t.storyPoints) || 0), 0);
export const statusNames = (): string[] => P().workflow.map((w: Any) => w.name);
export const catOf = (status: string) => P()?.workflow.find((w: Any) => w.name === status)?.category || 'todo';

// ---- workflow transitions (Project settings → Workflow). flowMode 'free' (default): any status to any status.
// 'custom': each status lists the statuses it can move to (next: [ids]); fromAny lets every status move to it.
export const statusOf = (name: string) => P()?.workflow.find((w: Any) => w.name === name);
export const customFlow = () => P()?.flowMode === 'custom';
/** Whether an issue may move from its status to `to` under the project's workflow. */
export function canMove(t: Any, to: string): boolean {
  if (!t || t.status === to || !customFlow()) return true;
  const from = statusOf(t.status), dest = statusOf(to);
  if (!from || !dest) return true;
  return Boolean(dest.fromAny) || (from.next || []).includes(dest.id);
}
/** Statuses this issue can move to now, in workflow order (its current status first). */
export const allowedStatuses = (t: Any): string[] => P().workflow.map((w: Any) => w.name).filter((n: string) => n === t.status || canMove(t, n));
export const moveError = (t: Any, to: string) => {
  const ok = allowedStatuses(t).filter((n) => n !== t.status);
  return `${t.key} can’t move from “${t.status}” to “${to}” in this project’s workflow.${ok.length ? ` It can move to ${ok.map((n) => `“${n}”`).join(', ')}.` : ''}`;
};
export const isDone = (t: Any) => catOf(t.status) === 'done';
/** A status's own colour (Project settings → Workflow), if it has one. Only #rrggbb is accepted. */
export const statusColor = (w: Any): string => (typeof w?.color === 'string' && /^#[0-9a-f]{6}$/i.test(w.color) ? w.color : '');
const scId = (w: Any) => String(w.id).replace(/[^\w-]/g, '');
/** Class for a status: its category colours, plus its own colour when set (see statusColorCss). */
export const sCls = (status: string) => { const w = statusOf(status); return `s-${catOf(status)}${w && statusColor(w) ? ` sc sc-${scId(w)}` : ''}`; };
/** Class for a workflow entry (by object, for settings and board columns). */
export const wCls = (w: Any) => `s-${w.category}${statusColor(w) ? ` sc sc-${scId(w)}` : ''}`;
/** CSS giving each coloured status its colour variable. */
export const statusColorCss = () => (P()?.workflow || []).filter(statusColor).map((w: Any) => `.sc-${scId(w)}{--sc:${statusColor(w)}}`).join('');
/** Black or white, whichever reads better on this background. */
export function readableOn(hex: string) {
  const n = parseInt(hex.slice(1), 16), [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#172b4d' : '#ffffff';
}
export const tCls = (s: string) => `t-${String(s).toLowerCase().replace(/\s/g, '')}`;
export const openIssue = () => (S.drawer?.kind === 'issue' ? ticket(S.drawer.id) : null);
export const openEpic = () => (S.drawer?.kind === 'epic' ? epic(S.drawer.id) : null);
export const me = () => S.user?.name || 'You';
export const can = (perm: string) => Boolean(S.user && (S.user.isOwner || S.user.permissions.includes(perm)));
export const peopleNames = (): string[] => [...new Set([...S.people.map((u: Any) => u.name), ...(P()?.members || []).map((m: Any) => m.name)])].filter(Boolean) as string[];
export const keyOf = (id: string) => ticket(id)?.key || '';
export const isBlocked = (t: Any) => t.links.some((l: Any) => l.type === 'is blocked by' && ticket(l.targetId) && !isDone(ticket(l.targetId)));
export function initials(name: string) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '') + (w[1]?.[0] || '')).toUpperCase() || '?';
}
export function hashColor(s: string, list = AVATAR_COLORS) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return list[Math.abs(h) % list.length]; }

export function nextTicketKey() {
  const p = P();
  const re = new RegExp(`^${p.key}-(\\d+)$`);
  const max = p.tickets.reduce((m: number, t: Any) => Math.max(m, Number(t.key?.match(re)?.[1] || 0)), 0);
  return `${p.key}-${max + 1}`;
}
export function nextEpicKey() {
  const max = P().epics.reduce((m: number, e: Any) => Math.max(m, Number(e.key?.match(/-E(\d+)$/)?.[1] || 0)), 0);
  return `${P().key}-E${max + 1}`;
}
export function newTicket(fields: Any = {}) {
  const t: Any = {
    id: uid(), key: nextTicketKey(), epicId: null, sprintId: null, parentId: null, title: 'New issue', type: 'Story', priority: 'Medium', storyPoints: null,
    labels: [], userStory: '', description: '', acceptanceCriteria: [], dependencies: [], testCases: [], status: statusNames()[0], assignee: '', reporter: me(),
    links: [], prs: [], comments: [], history: [], createdAt: nowIso(), updatedAt: nowIso(), ...fields,
  };
  t.history.push({ id: uid(), at: t.createdAt, author: me(), field: 'created', text: 'created the issue' });
  return t;
}
export const newTest = () => ({ id: uid(), title: 'New test case', type: 'Functional', priority: 'Medium', preconditions: '', steps: [], expected: '', acRef: [], status: 'Not run', script: '', lastRun: null });
export const withIds = (list: Any[]) => (list || []).map((tc) => ({ script: '', lastRun: null, ...tc, id: tc.id || uid() }));
const AI_FIELDS = ['title', 'type', 'priority', 'storyPoints', 'labels', 'userStory', 'description', 'acceptanceCriteria', 'dependencies'];
export function applyAi(base: Any, ai: Any) {
  const out = { ...base };
  for (const f of AI_FIELDS) if (ai[f] !== undefined) out[f] = ai[f];
  if (isSub(base)) out.type = 'Sub-task';
  out.testCases = withIds(ai.testCases ?? base.testCases);
  return out;
}
export function ensureProject(p: Any) {
  p.members ??= [];
  p.workflow = p.workflow?.length ? p.workflow : clone(DEFAULT_WORKFLOW);
  for (const w of p.workflow) w.id ??= uid();
  p.flowMode ??= 'free';
  const ids = new Set(p.workflow.map((w: Any) => w.id));
  for (const w of p.workflow) if (w.next) w.next = w.next.filter((id: string) => ids.has(id) && id !== w.id);
  p.sprints ??= [];
  p.automation ??= { baseUrl: '' };
  const names = new Set(p.workflow.map((w: Any) => w.name));
  for (const t of p.tickets) {
    t.comments ??= []; t.history ??= []; t.links ??= []; t.prs ??= [];
    t.sprintId ??= null; t.parentId ??= null; t.reporter ??= ''; t.assignee ??= '';
    t.createdAt ??= p.createdAt; t.updatedAt ??= t.createdAt;
    if (!names.has(t.status)) t.status = p.workflow[0].name;
    t.testCases = withIds(t.testCases);
  }
  for (const n of new Set(p.tickets.flatMap((t: Any) => [t.assignee, t.reporter]).filter(Boolean))) {
    if (!p.members.some((m: Any) => m.name === n)) p.members.push({ id: uid(), name: n, email: '', role: '' });
  }
  return p;
}
export function addMember(name: string) {
  const n = String(name || '').trim();
  if (n && !peopleNames().some((x) => x.toLowerCase() === n.toLowerCase())) P().members.push({ id: uid(), name: n, email: '', role: '' });
}

// ---------------------------------------------------------------- history
export const FIELD_LABEL: Record<string, string> = {
  title: 'Summary', status: 'Status', priority: 'Priority', assignee: 'Assignee', reporter: 'Reporter', storyPoints: 'Story points',
  epicId: 'Epic', sprintId: 'Sprint', parentId: 'Parent', type: 'Issue type', labels: 'Labels', description: 'Description',
  userStory: 'User story', acceptanceCriteria: 'Acceptance criteria', testCases: 'Test cases', dependencies: 'Dependencies',
};
const TEXT_FIELDS = new Set(['description', 'userStory', 'acceptanceCriteria', 'testCases', 'dependencies', 'title']);
export function fmtField(field: string, v: Any) {
  if (field === 'epicId') return epic(v)?.title || 'None';
  if (field === 'sprintId') return sprint(v)?.name || 'None';
  if (field === 'parentId') return keyOf(v) || 'None';
  if (field === 'labels') return (v || []).join(', ') || 'None';
  if (field === 'assignee') return v || 'Unassigned';
  if (v === null || v === undefined || v === '') return 'None';
  return String(v);
}
export function historyText(h: Any) {
  if (h.text) return h.text;
  const label = FIELD_LABEL[h.field] || h.field;
  return h.from !== undefined ? `changed ${label}` : `updated ${label}`;
}
export function logChange(t: Any, field: string, from: Any, to: Any, author = me()) {
  if (!t || JSON.stringify(from) === JSON.stringify(to)) return;
  const at = nowIso();
  t.updatedAt = at;
  const last = t.history[t.history.length - 1];
  if (last && last.field === field && last.author === author && Date.now() - Date.parse(last.at) < 120000) {
    last.at = at;
    if (!TEXT_FIELDS.has(field)) last.to = fmtField(field, to);
    if (!TEXT_FIELDS.has(field) && last.from === last.to) t.history.pop();
    return;
  }
  t.history.push(TEXT_FIELDS.has(field) ? { id: uid(), at, author, field } : { id: uid(), at, author, field, from: fmtField(field, from), to: fmtField(field, to) });
}
export function logEvent(t: Any, text: string, author = me()) {
  if (!t) return;
  t.updatedAt = nowIso();
  t.history.push({ id: uid(), at: t.updatedAt, author, field: 'event', text });
}
export function setField(t: Any, field: string, value: Any, author?: string) {
  const from = t[field];
  t[field] = value;
  logChange(t, field, from, value, author);
  if ((field === 'sprintId' || field === 'epicId') && !isSub(t)) {
    for (const c of childrenOf(t)) if (c[field] !== value) { const f2 = c[field]; c[field] = value; logChange(c, field, f2, value, author); }
  }
}

// ---------------------------------------------------------------- links & deletes
export function addLink(a: Any, type: string, b: Any) {
  if (!a || !b || a.id === b.id || a.links.some((l: Any) => l.type === type && l.targetId === b.id)) return false;
  a.links.push({ id: uid(), type, targetId: b.id });
  b.links.push({ id: uid(), type: LINK_TYPES[type], targetId: a.id });
  logEvent(a, `linked ${b.key} (${type})`);
  logEvent(b, `linked ${a.key} (${LINK_TYPES[type]})`);
  return true;
}
export function removeLink(a: Any, linkId: string) {
  const l = a.links.find((x: Any) => x.id === linkId);
  if (!l) return;
  a.links = a.links.filter((x: Any) => x.id !== linkId);
  const b = ticket(l.targetId);
  if (b) b.links = b.links.filter((x: Any) => !(x.targetId === a.id && x.type === LINK_TYPES[l.type]));
  logEvent(a, `removed link to ${b?.key || 'an issue'}`);
}
export function deleteIssues(ids: string[]) {
  const p = P();
  const all = new Set(ids);
  for (const t of p.tickets) if (all.has(t.parentId)) all.add(t.id);
  p.tickets = p.tickets.filter((t: Any) => !all.has(t.id));
  for (const t of p.tickets) t.links = t.links.filter((l: Any) => !all.has(l.targetId));
  return all.size;
}

// ---------------------------------------------------------------- filters
export function filtered(list: Any[]) {
  const { q, type, priority, status, epic: ep, assignee } = S.filter;
  const qq = q.trim().toLowerCase();
  return list.filter((t) => (!type || t.type === type) && (!priority || t.priority === priority) && (!status || t.status === status)
    && (!ep || (ep === 'none' ? !epic(t.epicId) : t.epicId === ep)) && (!assignee || (assignee === 'none' ? !t.assignee : t.assignee === assignee))
    && (!qq || [t.key, t.title, t.userStory, t.description, t.assignee, ...t.labels, ...t.acceptanceCriteria].join(' ').toLowerCase().includes(qq)));
}
export const filtersActive = () => Object.values(S.filter).some(Boolean);

// ---------------------------------------------------------------- undo / mutate
function snapshot(tag = '') {
  const now = Date.now();
  if (tag && tag === S.lastSnap.tag && now - S.lastSnap.at < 1500) { S.lastSnap.at = now; return; }
  S.lastSnap = { tag, at: now };
  S.undo.push(JSON.stringify(P()));
  if (S.undo.length > 100) S.undo.shift();
  S.redo = [];
}
/** Change the project: records undo, schedules a save and re-renders. */
export function mutate(fn: (p: Any) => void, { tag = '' }: { tag?: string; render?: string } = {}) {
  snapshot(tag);
  fn(P());
  scheduleSave();
  emit();
}
function restore(json: string) {
  const version = P().version;
  S.project = JSON.parse(json);
  S.project.version = version;
  S.lastSnap = { tag: '', at: 0 };
  if (S.drawer && !(openIssue() || openEpic())) S.drawer = null;
  scheduleSave(); emit();
}
export function undo() { if (!S.undo.length) return; S.redo.push(JSON.stringify(P())); restore(S.undo.pop()); }
export function redo() { if (!S.redo.length) return; S.undo.push(JSON.stringify(P())); restore(S.redo.pop()); }

// ---------------------------------------------------------------- saving & sync (patches)
const META_SKIP = new Set(['tickets', 'version', 'updatedAt', 'id']);
function snapshotOf(p: Any) {
  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) if (!META_SKIP.has(k)) meta[k] = JSON.stringify(v);
  return { meta, tickets: new Map<string, string>(p.tickets.map((t: Any) => [t.id, JSON.stringify(t)])), order: JSON.stringify(p.tickets.map((t: Any) => t.id)) };
}
export function setBase(p = P()) { S.base = p ? snapshotOf(p) : null; }
function diff(snap: Any) {
  const b = S.base;
  if (!b) return null;
  const patch: Any = { meta: {}, upsert: [], remove: [] };
  for (const [k, v] of Object.entries(snap.meta)) if (b.meta[k] !== v) patch.meta[k] = JSON.parse(v as string);
  for (const [id, v] of snap.tickets) if (b.tickets.get(id) !== v) patch.upsert.push(JSON.parse(v));
  for (const id of b.tickets.keys()) if (!snap.tickets.has(id)) patch.remove.push(id);
  if (b.order !== snap.order) patch.order = JSON.parse(snap.order);
  const empty = !Object.keys(patch.meta).length && !patch.upsert.length && !patch.remove.length && !patch.order;
  return empty ? null : patch;
}
export const hasLocalChanges = () => Boolean(P() && diff(snapshotOf(P())));
export function setSaveText(t: string) { S.saveText = t; emit(); }
export function scheduleSave() { clearTimeout(S.saveTimer); S.saveText = 'Saving…'; S.saveTimer = setTimeout(saveNow, 700); }
export async function saveNow() {
  clearTimeout(S.saveTimer); S.saveTimer = null;
  const p = P();
  if (!p || S.saving) { if (p) S.saveTimer = setTimeout(saveNow, 400); return; }
  const snap = snapshotOf(p);
  const patch = diff(snap);
  if (!patch) { setSaveText('Saved'); return; }
  S.saving = true;
  const before = p.version;
  try {
    const res = await api(`/api/projects/${p.id}`, { method: 'PATCH', body: patch });
    if (P() !== p) return;
    S.base = snap;
    p.version = res.version;
    setSaveText('Saved');
    if (res.version !== before + 1) await pullRemote({ quiet: true });
  } catch (e: Any) {
    setSaveText('Save failed');
    toast(`Not saved: ${e.message}`, 'err');
    if (/permission/i.test(e.message)) await pullRemote({ force: true });
  } finally { S.saving = false; }
}
export async function pullRemote({ force = false, quiet = false } = {}) {
  const p = P();
  if (!p) return;
  if (!force && hasLocalChanges()) return;
  try {
    const fresh = await api(`/api/projects/${p.id}`);
    if (P() !== p || (!force && hasLocalChanges())) return;
    S.project = ensureProject(fresh);
    setBase();
    S.undo = []; S.redo = [];
    if (S.drawer && !(openIssue() || openEpic())) S.drawer = null;
    if (!quiet) S.saveText = 'Updated with teammates’ changes';
    emit();
  } catch (e: Any) { if (force) toast(e.message, 'err'); }
}
let syncStarted = false;
export function startSync() {
  if (syncStarted) return;
  syncStarted = true;
  setInterval(async () => {
    const p = P();
    if (!p || S.saving || S.saveTimer || document.visibilityState !== 'visible') return;
    try {
      const { version } = await api(`/api/projects/${p.id}/version`);
      if (P() === p && version > p.version) await pullRemote();
    } catch { /* offline or signed out */ }
  }, 10000);
}

/** Notifications for the signed-in user (bell in the top bar). */
export async function loadNotifs() {
  if (!S.user) return;
  try { S.notifs = await api('/api/notifications'); S.notifsLoaded = true; S.notifsError = null; emit(); }
  catch (e: Any) { if (!S.notifsLoaded) { S.notifsError = e; emit(); } /* else keep the last list (offline for a moment) */ }
}
export async function markNotifsRead(ids?: string[]) {
  await api('/api/notifications/read', { method: 'POST', body: { ids } }).catch(() => {});
  await loadNotifs();
}

/** Load a project (once) for the workspace. */
export async function openProject(id: string) {
  if (S.project?.id === id || S.loadingProject === id) return;
  if (P()) await saveNow();
  S.loadingProject = id; S.projectError = null; emit();
  try {
    const p = ensureProject(await api(`/api/projects/${id}`));
    Object.assign(S, { project: p, undo: [], redo: [], drawer: null, full: false, inlineCreate: null, filter: EMPTY_FILTER(), boardAll: false });
    S.checked.clear(); S.openTc.clear();
    setBase();
    S.people = await api(`/api/projects/${id}/people`).catch(() => []);
  } catch (e: Any) { S.projectError = { id, status: e.status, message: e.message }; }
  finally { S.loadingProject = null; emit(); }
}
export async function closeProject() {
  if (P()) await saveNow();
  Object.assign(S, { project: null, drawer: null, people: [] });
  emit();
}

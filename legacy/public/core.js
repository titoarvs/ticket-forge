// Shared state, data model helpers, history, undo and persistence.
import { I } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 8);
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const nowIso = () => new Date().toISOString();
export const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
export function ago(iso) {
  if (!iso) return '';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
export const dateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export const TYPES = ['Story', 'Task', 'Bug', 'Spike'];
export const PRIORITIES = ['Highest', 'High', 'Medium', 'Low'];
export const TC_TYPES = ['Functional', 'Negative', 'Edge', 'UI', 'Integration', 'Security', 'Performance', 'Accessibility'];
export const TC_STATUS = ['Not run', 'Pass', 'Fail', 'Blocked'];
export const CATEGORIES = [['todo', 'To do'], ['inprogress', 'In progress'], ['done', 'Done']];
export const COLORS = ['#6e5dc6', '#0c66e4', '#1f845a', '#e06c00', '#c9372c', '#206a83', '#943d73', '#5b7f24', '#b65c02', '#626f86'];
export const AVATAR_COLORS = ['#0c66e4', '#1f845a', '#6e5dc6', '#c9372c', '#a54800', '#206a83', '#943d73', '#5e4db2'];
export const LINK_TYPES = { blocks: 'is blocked by', 'is blocked by': 'blocks', 'relates to': 'relates to', duplicates: 'is duplicated by', 'is duplicated by': 'duplicates', clones: 'is cloned by', 'is cloned by': 'clones' };
export const DEFAULT_WORKFLOW = [
  { id: 'todo', name: 'To Do', category: 'todo' },
  { id: 'inprogress', name: 'In Progress', category: 'inprogress' },
  { id: 'inreview', name: 'In Review', category: 'inprogress' },
  { id: 'done', name: 'Done', category: 'done' },
];
export const EMPTY_FILTER = () => ({ q: '', type: '', priority: '', status: '', epic: '', assignee: '' });

const ui = store.get('tf.ui', {});
export const S = {
  user: null,
  auth: null,
  people: [],
  base: null,
  saving: false,
  status: null,
  engine: null,
  settings: store.get('tf.settings', { provider: '', model: '' }),
  route: { name: 'projects' },
  projects: [],
  projectQuery: '',
  project: null,
  view: 'backlog',
  drawer: null, // { kind: 'issue' | 'epic', id }
  full: false,
  filter: EMPTY_FILTER(),
  tcFilter: { q: '', status: '', type: '' },
  groupBy: ui.groupBy || 'sprint',
  boardAll: false,
  boardGroup: ui.boardGroup || 'none',
  collapsed: new Set(ui.collapsed || []),
  detailsOpen: ui.detailsOpen ?? true,
  actTab: ui.actTab || 'comments',
  inlineCreate: null,
  subForm: false, linkForm: false, prForm: false, cmtEdit: null,
  checked: new Set(),
  openTc: new Set(),
  doc: null,
  genOpts: store.get('tf.genOpts', { projectKey: '', granularity: 'balanced', includeTests: true, testsPerTicket: 4, instructions: '' }),
  gen: null,
  busy: null,
  autoRun: null,
  autoScope: 'all', autoRegen: false,
  undo: [], redo: [], lastSnap: { tag: '', at: 0 },
  saveTimer: null, saveText: '',
  menu: null,
};
export const saveUi = () => store.set('tf.ui', { groupBy: S.groupBy, boardGroup: S.boardGroup, collapsed: [...S.collapsed], detailsOpen: S.detailsOpen, actTab: S.actTab });

/** Render functions are registered by app.js (avoids circular imports). */
export const hooks = {};

// ---------------------------------------------------------------- api & feedback
export async function api(url, { method = 'GET', body, raw, signal } = {}) {
  const opts = { method, headers: {}, signal };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).error || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return raw ? res : res.json();
}
export const aiBody = (b) => ({ ...b, provider: S.settings.provider || undefined, model: S.settings.model || undefined, project: b.project && slimProject(b.project) });
export function slimProject(p) {
  return {
    ...p, sourceText: undefined,
    tickets: p.tickets.map((t) => ({ ...t, history: undefined, comments: undefined, testCases: t.testCases.map((tc) => ({ ...tc, script: undefined, lastRun: undefined })) })),
  };
}

/** Reads an NDJSON response stream, calling onEvent for each object. */
export async function readNdjson(res, onEvent) {
  const reader = res.body.getReader();
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

export function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${kind === 'err' ? `<span style="color:var(--danger)">${I.warn}</span>` : `<span style="color:#22a06b">${I.check}</span>`}<span>${esc(msg)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 8000 : 3500);
}
export function renderBusy() {
  const el = $('#busy');
  el.hidden = !S.busy;
  if (S.busy) el.innerHTML = `<span class="spinner"></span>${esc(S.busy)}`;
}
export async function withBusy(label, fn) {
  if (S.busy) { toast('Claude is still working on the previous request.', 'err'); return null; }
  S.busy = label; renderBusy();
  try { return await fn(); }
  catch (e) { toast(`Claude: ${e.message}`, 'err'); return null; }
  finally { S.busy = null; renderBusy(); }
}

// ---------------------------------------------------------------- model helpers
export const P = () => S.project;
export const ticket = (id) => P()?.tickets.find((t) => t.id === id);
export const epic = (id) => P()?.epics.find((e) => e.id === id);
export const sprint = (id) => P()?.sprints.find((s) => s.id === id);
export const isSub = (t) => t?.type === 'Sub-task';
export const childrenOf = (t) => P().tickets.filter((x) => x.parentId === t.id);
export const epicTickets = (eid) => P().tickets.filter((t) => t.epicId === eid && !isSub(t));
export const noEpic = () => P().tickets.filter((t) => !isSub(t) && !epic(t.epicId));
export const activeSprint = () => P().sprints.find((s) => s.state === 'active');
export const openSprints = () => P().sprints.filter((s) => s.state !== 'closed');
export const tcKey = (t, i) => `TC-${t.key}-${String(i + 1).padStart(2, '0')}`;
export const spSum = (list) => list.reduce((s, t) => s + (Number(t.storyPoints) || 0), 0);
export const statusNames = () => P().workflow.map((w) => w.name);
export const catOf = (status) => P()?.workflow.find((w) => w.name === status)?.category || 'todo';
export const isDone = (t) => catOf(t.status) === 'done';
export const sCls = (status) => `s-${catOf(status)}`;
export const tCls = (s) => `t-${String(s).toLowerCase().replace(/\s/g, '')}`;
export const openIssue = () => (S.drawer?.kind === 'issue' ? ticket(S.drawer.id) : null);
export const openEpic = () => (S.drawer?.kind === 'epic' ? epic(S.drawer.id) : null);
export const me = () => S.user?.name || 'You';
/** Does the signed-in user have this permission? */
export const can = (perm) => Boolean(S.user && (S.user.isOwner || S.user.permissions.includes(perm)));
/** Everyone who can be assigned: users with access to the project plus people added without an account. */
export const peopleNames = () => [...new Set([...S.people.map((u) => u.name), ...(P()?.members || []).map((m) => m.name)])].filter(Boolean);
export const keyOf = (id) => ticket(id)?.key || '';
export const isBlocked = (t) => t.links.some((l) => l.type === 'is blocked by' && ticket(l.targetId) && !isDone(ticket(l.targetId)));

export function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '') + (w[1]?.[0] || '')).toUpperCase() || '?';
}
export function hashColor(s, list = AVATAR_COLORS) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return list[Math.abs(h) % list.length]; }
export const avatar = (name, size = 24) => (name
  ? `<span class="avatar" style="background:${hashColor(name)};width:${size}px;height:${size}px;font-size:${size < 24 ? 9 : 10}px" title="${esc(name)}">${esc(initials(name))}</span>`
  : `<span class="avatar none" style="width:${size}px;height:${size}px" title="Unassigned">${I.user}</span>`);
export const eloz = (e) => (e ? `<span class="eloz" style="--ec:${esc(e.color)}" title="${esc(e.title)}">${esc(e.title)}</span>` : '');
export const statusLoz = (s) => `<span class="loz ${sCls(s)}">${esc(s)}</span>`;
export const opts = (list, cur) => list.map((x) => `<option ${x === cur ? 'selected' : ''}>${esc(x)}</option>`).join('');

export function nextTicketKey() {
  const p = P();
  const re = new RegExp(`^${p.key}-(\\d+)$`);
  const max = p.tickets.reduce((m, t) => Math.max(m, Number(t.key?.match(re)?.[1] || 0)), 0);
  return `${p.key}-${max + 1}`;
}
export function nextEpicKey() {
  const max = P().epics.reduce((m, e) => Math.max(m, Number(e.key?.match(/-E(\d+)$/)?.[1] || 0)), 0);
  return `${P().key}-E${max + 1}`;
}
export function newTicket(fields = {}) {
  const t = {
    id: uid(), key: nextTicketKey(), epicId: null, sprintId: null, parentId: null, title: 'New issue', type: 'Story', priority: 'Medium', storyPoints: null,
    labels: [], userStory: '', description: '', acceptanceCriteria: [], dependencies: [], testCases: [], status: statusNames()[0], assignee: '', reporter: me(),
    links: [], prs: [], comments: [], history: [], createdAt: nowIso(), updatedAt: nowIso(), ...fields,
  };
  t.history.push({ id: uid(), at: t.createdAt, author: me(), field: 'created', text: 'created the issue' });
  return t;
}
export const newTest = () => ({ id: uid(), title: 'New test case', type: 'Functional', priority: 'Medium', preconditions: '', steps: [], expected: '', acRef: [], status: 'Not run', script: '', lastRun: null });
export const withIds = (list) => (list || []).map((tc) => ({ script: '', lastRun: null, ...tc, id: tc.id || uid() }));
const AI_FIELDS = ['title', 'type', 'priority', 'storyPoints', 'labels', 'userStory', 'description', 'acceptanceCriteria', 'dependencies'];
/** Merge Claude's content into an issue, keeping identity, workflow, links, comments and history. */
export function applyAi(base, ai) {
  const out = { ...base };
  for (const f of AI_FIELDS) if (ai[f] !== undefined) out[f] = ai[f];
  if (isSub(base)) out.type = 'Sub-task';
  out.testCases = withIds(ai.testCases ?? base.testCases);
  return out;
}

/** Fill in fields added in newer versions so older projects keep working. */
export function ensureProject(p) {
  p.members ??= [];
  p.workflow = p.workflow?.length ? p.workflow : clone(DEFAULT_WORKFLOW);
  p.sprints ??= [];
  p.automation ??= { baseUrl: '' };
  const names = new Set(p.workflow.map((w) => w.name));
  for (const t of p.tickets) {
    t.comments ??= []; t.history ??= []; t.links ??= []; t.prs ??= [];
    t.sprintId ??= null; t.parentId ??= null; t.reporter ??= ''; t.assignee ??= '';
    t.createdAt ??= p.createdAt; t.updatedAt ??= t.createdAt;
    if (!names.has(t.status)) t.status = p.workflow[0].name;
    t.testCases = withIds(t.testCases);
  }
  for (const n of new Set(p.tickets.flatMap((t) => [t.assignee, t.reporter]).filter(Boolean))) {
    if (!p.members.some((m) => m.name === n)) p.members.push({ id: uid(), name: n, email: '', role: '' });
  }
  return p;
}
export function addMember(name) {
  const n = String(name || '').trim();
  if (n && !P().members.some((m) => m.name.toLowerCase() === n.toLowerCase())) P().members.push({ id: uid(), name: n, email: '', role: '' });
}

// ---------------------------------------------------------------- history
const FIELD_LABEL = {
  title: 'Summary', status: 'Status', priority: 'Priority', assignee: 'Assignee', reporter: 'Reporter', storyPoints: 'Story points',
  epicId: 'Epic', sprintId: 'Sprint', parentId: 'Parent', type: 'Issue type', labels: 'Labels', description: 'Description',
  userStory: 'User story', acceptanceCriteria: 'Acceptance criteria', testCases: 'Test cases', dependencies: 'Dependencies',
};
const TEXT_FIELDS = new Set(['description', 'userStory', 'acceptanceCriteria', 'testCases', 'dependencies', 'title']);
export function fmtField(field, v) {
  if (field === 'epicId') return epic(v)?.title || 'None';
  if (field === 'sprintId') return sprint(v)?.name || 'None';
  if (field === 'parentId') return keyOf(v) || 'None';
  if (field === 'labels') return (v || []).join(', ') || 'None';
  if (field === 'assignee') return v || 'Unassigned';
  if (v === null || v === undefined || v === '') return 'None';
  return String(v);
}
export const fieldLabel = (f) => FIELD_LABEL[f] || f;
/** Records a field change in the issue's history (text edits within 2 minutes are merged). */
export function logChange(t, field, from, to, author = me()) {
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
  t.history.push(TEXT_FIELDS.has(field)
    ? { id: uid(), at, author, field }
    : { id: uid(), at, author, field, from: fmtField(field, from), to: fmtField(field, to) });
}
export function logEvent(t, text, author = me()) {
  if (!t) return;
  t.updatedAt = nowIso();
  t.history.push({ id: uid(), at: t.updatedAt, author, field: 'event', text });
}
/** Set a field, log it, and keep sub-tasks in step with their parent's epic and sprint. */
export function setField(t, field, value, author) {
  const from = t[field];
  t[field] = value;
  logChange(t, field, from, value, author);
  if ((field === 'sprintId' || field === 'epicId') && !isSub(t)) {
    for (const c of childrenOf(t)) { if (c[field] !== value) { const f2 = c[field]; c[field] = value; logChange(c, field, f2, value, author); } }
  }
}

// ---------------------------------------------------------------- links
export function addLink(a, type, b) {
  if (!a || !b || a.id === b.id || a.links.some((l) => l.type === type && l.targetId === b.id)) return false;
  a.links.push({ id: uid(), type, targetId: b.id });
  b.links.push({ id: uid(), type: LINK_TYPES[type], targetId: a.id });
  logEvent(a, `linked ${b.key} (${type})`);
  logEvent(b, `linked ${a.key} (${LINK_TYPES[type]})`);
  return true;
}
export function removeLink(a, linkId) {
  const l = a.links.find((x) => x.id === linkId);
  if (!l) return;
  a.links = a.links.filter((x) => x.id !== linkId);
  const b = ticket(l.targetId);
  if (b) b.links = b.links.filter((x) => !(x.targetId === a.id && x.type === LINK_TYPES[l.type]));
  logEvent(a, `removed link to ${b?.key || 'an issue'}`);
}
/** Remove issues and every reference to them (links, children). */
export function deleteIssues(ids) {
  const p = P();
  const all = new Set(ids);
  for (const t of p.tickets) if (all.has(t.parentId)) all.add(t.id);
  p.tickets = p.tickets.filter((t) => !all.has(t.id));
  for (const t of p.tickets) t.links = t.links.filter((l) => !all.has(l.targetId));
  return all.size;
}

// ---------------------------------------------------------------- filters
export function filtered(list) {
  const { q, type, priority, status, epic: ep, assignee } = S.filter;
  const qq = q.trim().toLowerCase();
  return list.filter((t) => (!type || t.type === type) && (!priority || t.priority === priority) && (!status || t.status === status)
    && (!ep || (ep === 'none' ? !epic(t.epicId) : t.epicId === ep)) && (!assignee || (assignee === 'none' ? !t.assignee : t.assignee === assignee))
    && (!qq || [t.key, t.title, t.userStory, t.description, t.assignee, ...t.labels, ...t.acceptanceCriteria].join(' ').toLowerCase().includes(qq)));
}
export const filtersActive = () => Object.values(S.filter).some(Boolean);

// ---------------------------------------------------------------- undo / save
function snapshot(tag = '') {
  const now = Date.now();
  if (tag && tag === S.lastSnap.tag && now - S.lastSnap.at < 1500) { S.lastSnap.at = now; return; }
  S.lastSnap = { tag, at: now };
  S.undo.push(JSON.stringify(P()));
  if (S.undo.length > 100) S.undo.shift();
  S.redo = [];
}
/** render: 'all' | 'view' (sidebar + view, keeps the drawer and its focus) | 'side' | 'none' */
export function mutate(fn, { tag = '', render = 'all' } = {}) {
  snapshot(tag);
  fn(P());
  scheduleSave();
  if (render === 'all') { hooks.renderSidebar(); hooks.renderView(); hooks.renderDrawer(); }
  else if (render === 'view') { hooks.renderSidebar(); hooks.renderView(); }
  else if (render === 'side') hooks.renderSidebar();
  updateTopState();
}
function restore(json) {
  const version = P().version;
  S.project = JSON.parse(json);
  S.project.version = version;
  S.lastSnap = { tag: '', at: 0 };
  if (S.drawer && !(openIssue() || openEpic())) S.drawer = null;
  scheduleSave(); hooks.renderAll();
}
export function undo() { if (!S.undo.length) return; S.redo.push(JSON.stringify(P())); restore(S.undo.pop()); }
export function redo() { if (!S.redo.length) return; S.undo.push(JSON.stringify(P())); restore(S.redo.pop()); }

// ---------------------------------------------------------------- saving & sync
// The server stores each issue separately. We send only what changed since the last save
// (a patch), so teammates' edits to other issues are never overwritten.
const META_SKIP = new Set(['tickets', 'version', 'updatedAt', 'id']);
function snapshotOf(p) {
  const meta = {};
  for (const [k, v] of Object.entries(p)) if (!META_SKIP.has(k)) meta[k] = JSON.stringify(v);
  return { meta, tickets: new Map(p.tickets.map((t) => [t.id, JSON.stringify(t)])), order: JSON.stringify(p.tickets.map((t) => t.id)) };
}
export function setBase(p = P()) { S.base = p ? snapshotOf(p) : null; }
function diff(snap) {
  const b = S.base;
  if (!b) return null;
  const patch = { meta: {}, upsert: [], remove: [] };
  for (const [k, v] of Object.entries(snap.meta)) if (b.meta[k] !== v) patch.meta[k] = JSON.parse(v);
  for (const [id, v] of snap.tickets) if (b.tickets.get(id) !== v) patch.upsert.push(JSON.parse(v));
  for (const id of b.tickets.keys()) if (!snap.tickets.has(id)) patch.remove.push(id);
  if (b.order !== snap.order) patch.order = JSON.parse(snap.order);
  const empty = !Object.keys(patch.meta).length && !patch.upsert.length && !patch.remove.length && !patch.order;
  return empty ? null : patch;
}
export const hasLocalChanges = () => Boolean(P() && diff(snapshotOf(P())));

export function scheduleSave() { clearTimeout(S.saveTimer); setSaveText('Saving…'); S.saveTimer = setTimeout(saveNow, 700); }
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
  } catch (e) {
    setSaveText('Save failed');
    toast(`Not saved: ${e.message}`, 'err');
    if (/permission/i.test(e.message)) await pullRemote({ force: true });
  } finally { S.saving = false; }
}
/** Bring in teammates' changes. Skips while you have unsaved edits unless forced. */
export async function pullRemote({ force = false, quiet = false } = {}) {
  const p = P();
  if (!p) return;
  if (!force && hasLocalChanges()) return;
  try {
    const fresh = await api(`/api/projects/${p.id}`);
    if (P() !== p || (!force && hasLocalChanges())) return;
    S.project = hooks.ensure(fresh);
    setBase();
    S.undo = []; S.redo = [];
    if (S.drawer && !(openIssue() || openEpic())) S.drawer = null;
    hooks.refresh();
    if (!quiet) setSaveText('Updated with teammates’ changes');
  } catch (e) { if (force) toast(e.message, 'err'); }
}
export function startSync() {
  setInterval(async () => {
    const p = P();
    if (!p || S.saving || S.saveTimer || document.visibilityState !== 'visible') return;
    try {
      const { version } = await api(`/api/projects/${p.id}/version`);
      if (P() === p && version > p.version) await pullRemote();
    } catch { /* offline or signed out */ }
  }, 10000);
}
export function setSaveText(t) { S.saveText = t; const el = $('#saveState'); if (el) el.textContent = t; }
export function updateTopState() {
  const u = $('#undoBtn'), r = $('#redoBtn');
  if (u) u.disabled = !S.undo.length;
  if (r) r.disabled = !S.redo.length;
}

// ---------------------------------------------------------------- dialogs (shared)
export function openModal({ title, body, actions = [], onOpen, wide, left = '' }) {
  $('#modalRoot').innerHTML = `<div class="modal-back" id="mBack"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h3>${esc(title)}</h3><button class="icon-btn" data-action="modal-close" aria-label="Close">${I.close}</button></header>
    <div class="mb">${body}</div>
    <footer>${left ? `<div class="left">${left}</div>` : ''}${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : a.danger ? 'danger' : a.ai ? 'ai' : 'subtle'}" ${a.id ? `id="${a.id}"` : ''} ${a.action ? `data-action="${a.action}"` : `data-mi="${i}"`}>${esc(a.label)}</button>`).join('')}</footer>
  </div></div>`;
  const back = $('#mBack');
  back.addEventListener('mousedown', (e) => { if (e.target === back) closeModal(); });
  $$('[data-mi]', back).forEach((b) => b.addEventListener('click', () => actions[Number(b.dataset.mi)].onClick()));
  onOpen?.(back);
}
export function closeModal() { $('#modalRoot').innerHTML = ''; }
export function confirmModal(title, html, label, onYes) {
  openModal({ title, body: `<p style="margin-top:0">${html}</p>`, actions: [{ label: 'Cancel', action: 'modal-close' }, { label, danger: true, onClick: async () => { closeModal(); await onYes(); } }] });
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  catch { toast('Copy failed — select the link and copy it manually.', 'err'); }
}

// ---------------------------------------------------------------- permission gating (UI)
// The server enforces every permission; this only hides or disables controls the user can't use.
const ACTION_PERMS = {
  'ic-open': 'issue.create', 'sub-open': 'issue.create', 'dup-issue': 'issue.create', 'ai-new': 'ai.use',
  'del-issue': 'issue.delete', 'bulk-delete': 'issue.delete',
  'ac-add': 'issue.edit', 'ac-add-gwt': 'issue.edit', 'ac-del': 'issue.edit', 'ac-move': 'issue.edit', 'tc-add': 'issue.edit', 'tc-dup': 'issue.edit', 'tc-del': 'issue.edit',
  'link-open': 'issue.edit', 'link-del': 'issue.edit', 'pr-open': 'issue.edit', 'pr-del': 'issue.edit', 'pr-refresh': 'issue.edit', 'assign-me': 'issue.edit', 'convert-sub': 'issue.edit',
  'cmt-save': 'issue.comment',
  'sprint-create': 'sprint.manage', 'sprint-start': 'sprint.manage', 'sprint-edit': 'sprint.manage', 'sprint-complete': 'sprint.manage', 'sprint-delete': 'sprint.manage',
  'add-epic': 'epic.manage', 'epic-color': 'epic.manage', 'del-epic': 'epic.manage', regroup: 'epic.manage',
  ai: 'ai.use', 'ai-ask': 'ai.use', 'bulk-tests': 'ai.use', generate: 'ai.use',
  'auto-run': 'test.run', 'run-tc': 'test.run', 'run-issue-tests': 'test.run', 'run-filtered': 'test.run', 'bulk-run': 'test.run',
  'install-browser': 'users.manage',
  'member-add': 'project.settings', 'member-del': 'project.settings', 'wf-add': 'project.settings', 'wf-move': 'project.settings', 'wf-del': 'project.settings',
  'delete-project': 'project.delete', 'blank-project': 'project.create', 'import-json': 'project.create',
};
const BIND_PERMS = { t: 'issue.edit', ac: 'issue.edit', tc: 'issue.edit', e: 'epic.manage', p: 'project.settings', auto: 'project.settings' };
const MENU_PERMS = { export: 'export', ai: 'ai.use' };
const drop = (el) => el.parentNode?.removeChild(el);
export function applyPerms(root = document) {
  if (!S.user) return;
  for (const el of $$('[data-action]', root)) {
    const need = ACTION_PERMS[el.dataset.action] || (el.dataset.action === 'menu' && MENU_PERMS[el.dataset.menu]);
    if (need && !can(need)) drop(el);
  }
  for (const el of $$('[data-bind]', root)) {
    const [scope, , field] = el.dataset.bind.split('.');
    let ok = can(BIND_PERMS[scope] || 'issue.edit');
    if (el.dataset.bind === 't.sprintId') ok = ok || can('sprint.manage');
    if (el.dataset.bind === 't.epicId') ok = ok || can('epic.manage');
    if (scope === 'tc' && (field === 'status' || field === 'script')) ok = ok || can('test.run');
    if (!ok) { el.disabled = true; el.title = 'You don’t have permission to change this'; }
  }
  for (const el of $$('[data-to="#/new"]', root)) if (!can('project.create')) drop(el);
  for (const el of $$('[data-tcstatus]', root)) if (!can('test.run') && !can('issue.edit')) el.disabled = true;
  for (const el of $$('[draggable="true"]', root)) if (!can('issue.edit') && !can('sprint.manage')) el.removeAttribute('draggable');
  for (const el of $$('[data-wf], [data-member]', root)) if (!can('project.settings')) el.disabled = true;
  for (const el of $$('.irow .cb', root)) if (!can('issue.edit') && !can('issue.delete') && !can('sprint.manage') && !can('test.run')) drop(el);
}

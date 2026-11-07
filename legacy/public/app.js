// TicketForge — Jira-style workspace. Routing, rendering and interactions.
import { typeIcon, priorityIcon, I } from './icons.js';
import {
  $, $$, esc, uid, clone, store, nowIso, dateInput, S, hooks, saveUi, api, aiBody, readNdjson, toast, renderBusy, withBusy,
  P, ticket, epic, sprint, isSub, childrenOf, epicTickets, activeSprint, openSprints, tcKey, spSum, isDone, me,
  initials, hashColor, COLORS, TYPES, PRIORITIES, EMPTY_FILTER, nextTicketKey, nextEpicKey, newTicket, newTest, withIds, applyAi, ensureProject,
  addMember, logChange, logEvent, setField, addLink, removeLink, deleteIssues, mutate, undo, redo, scheduleSave, saveNow, updateTopState, opts,
} from './core.js';
import {
  VIEWS, viewSummary, viewBacklog, viewBoard, viewEpics, viewTests, viewReports, viewAutomation, viewSource, viewSettings,
  automationItems, testRows,
} from './views.js';
import { issueDrawer, epicDrawer } from './drawer.js';
import { setBase, startSync, applyPerms, can } from './core.js';
import { renderAdmin, openAccount } from './admin.js';
import { renderAuth } from './auth.js';

const EXPORTS = [
  ['xlsx', 'Excel workbook', '.xlsx'], ['docx', 'Word document', '.docx'], ['pdf', 'PDF report', '.pdf'], ['html', 'HTML report', '.html'],
  null,
  ['csv', 'CSV — issues', '.csv'], ['csv-tests', 'CSV — test cases', '.csv'], ['csv-jira', 'CSV — Jira import', '.csv'],
  null,
  ['json', 'Project backup', '.json'],
];
const openIssue = () => (S.drawer?.kind === 'issue' ? ticket(S.drawer.id) : null);
const openEpic = () => (S.drawer?.kind === 'epic' ? epic(S.drawer.id) : null);
const findTc = (tid, tcid) => { const t = ticket(tid); return { t, tc: t?.testCases.find((x) => x.id === tcid) }; };

// ---------------------------------------------------------------- routing
window.addEventListener('hashchange', route);
function parseRoute() {
  const a = location.hash.match(/^#\/(login|forgot|reset|invite)(?:\/([\w-]+))?/);
  if (a) return { name: a[1], token: a[2] };
  const m = location.hash.match(/^#\/p\/([\w-]+)(?:\/(\w+))?/);
  if (m) return { name: 'project', id: m[1], view: VIEWS[m[2]] ? m[2] : 'backlog' };
  if (location.hash.startsWith('#/new')) return { name: 'new' };
  const ad = location.hash.match(/^#\/admin(?:\/(\w+))?/);
  if (ad) return { name: 'admin', tab: ad[1] || 'users' };
  return { name: 'projects' };
}
async function route() {
  const r = parseRoute();
  S.route = r; S.menu = null;
  if (S.auth?.setupRequired && !S.user) return renderAuth({ name: 'setup' });
  if (['invite', 'reset', 'forgot'].includes(r.name) || !S.user) return renderAuth(S.user ? r : (['invite', 'reset', 'forgot'].includes(r.name) ? r : { name: 'login' }));
  if (r.name === 'project') {
    if (P()?.id !== r.id) {
      if (P()) await saveNow();
      try {
        S.project = ensureProject(await api(`/api/projects/${r.id}`));
        Object.assign(S, { undo: [], redo: [], drawer: null, full: false, inlineCreate: null, filter: EMPTY_FILTER(), boardAll: false });
        S.checked.clear(); S.openTc.clear();
        setBase();
        S.people = await api(`/api/projects/${r.id}/people`).catch(() => []);
      } catch (e) { toast(`Could not open project: ${e.message}`, 'err'); location.hash = '#/'; return; }
    }
    S.view = r.view;
  } else {
    if (r.name === 'admin' && !can('users.manage')) { toast('Only administrators can open Administration.', 'err'); location.hash = '#/'; return; }
    if (r.name === 'new' && !can('project.create')) { toast('Your role can’t create projects. Ask an administrator.', 'err'); location.hash = '#/'; return; }
    if (P()) await saveNow();
    S.project = null; S.drawer = null;
    if (r.name === 'projects') S.projects = await api('/api/projects').catch(() => []);
  }
  renderAll();
}
async function logout() {
  if (P()) await saveNow();
  await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  Object.assign(S, { user: null, project: null, drawer: null, menu: null, people: [] });
  location.hash = '#/login';
  route();
}
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
async function loadEngine() {
  try { S.engine = await api('/api/automation/status'); } catch { S.engine = { installed: false, browser: false }; }
  if (S.view === 'automation' && P()) renderView();
}

// ---------------------------------------------------------------- top navigation
function renderAll() {
  renderTop();
  if (S.route.name === 'project' && P()) renderShell();
  else if (S.route.name === 'new') renderCreate();
  else if (S.route.name === 'admin') renderAdmin(S.route.tab);
  else renderProjects();
  renderBusy(); renderRunPill();
}
hooks.renderAll = renderAll;

function connInfo() {
  const st = S.status;
  const provider = S.settings.provider || st?.defaultProvider;
  const ok = provider === 'cli' ? st?.cli?.available : provider === 'api' ? st?.api : false;
  const label = provider === 'cli' ? 'Claude account' : provider === 'api' ? 'Anthropic API' : 'Not connected';
  const model = S.settings.model || (provider === 'api' ? st?.defaultModels?.api : st?.defaultModels?.cli) || '';
  return { ok, label, model };
}
const avatarHtml = (n) => `<span class="avatar" style="background:${hashColor(n)}">${esc(initials(n))}</span>`;

function renderTop() {
  const p = P();
  const c = connInfo();
  const inProject = S.route.name === 'project' && p;
  $('#topnav').innerHTML = `
    <button class="brand" data-action="go" data-to="#/" title="All projects"><span class="brand-mark">${I.logo}</span>TicketForge</button>
    <button class="navlink ${!inProject && S.route.name !== 'admin' ? 'active' : ''}" data-action="go" data-to="#/">Projects</button>
    ${inProject ? `<button class="navlink active hide-sm" data-action="go" data-to="#/p/${esc(p.id)}/backlog">${esc(p.name)}</button>` : ''}
    ${can('users.manage') ? `<button class="navlink hide-sm ${S.route.name === 'admin' ? 'active' : ''}" data-action="go" data-to="#/admin/users">Administration</button>` : ''}
    ${(inProject ? can('issue.create') : can('project.create')) ? `<button class="btn primary" data-action="create" style="margin-left:8px" title="${inProject ? 'Create issue (C)' : 'Create project'}">${I.plus}Create</button>` : ''}
    <div class="spacer"></div>
    ${inProject ? `
      <span class="save-state" id="saveState">${esc(S.saveText)}</span>
      <button class="icon-btn" data-action="undo" id="undoBtn" title="Undo (⌘Z)">${I.undo}</button>
      <button class="icon-btn" data-action="redo" id="redoBtn" title="Redo (⇧⌘Z)">${I.redo}</button>
      <div class="menu-wrap" style="margin:0 4px">
        <button class="btn" data-action="menu" data-menu="export">${I.download}Export</button>
        ${S.menu === 'export' ? `<div class="menu"><div class="mh">Download as</div>${EXPORTS.map((x) => (x ? `<button data-action="export" data-fmt="${x[0]}">${esc(x[1])}<small>${x[2]}</small></button>` : '<hr>')).join('')}</div>` : ''}
      </div>` : ''}
    <button class="conn" data-action="settings" title="Claude connection settings"><span class="dot ${S.status ? (c.ok ? 'ok' : 'bad') : ''}"></span>${esc(c.label)}${c.model ? ` · ${esc(c.model)}` : ''}</button>
    ${S.user ? `<div class="menu-wrap"><button class="me-chip" data-action="menu" data-menu="account" title="${esc(S.user.name)} — account" aria-label="Account menu">${avatarHtml(S.user.name)}</button>
      ${S.menu === 'account' ? `<div class="menu"><div class="acct"><b>${esc(S.user.name)}</b><span class="muted small">${esc(S.user.email)}</span><span class="label-chip">${esc(S.user.roleName)}${S.user.isOwner ? ' · Owner' : ''}</span></div><hr>
        ${can('users.manage') ? `<button data-action="go" data-to="#/admin/users">${I.people}Administration</button><button data-action="go" data-to="#/admin/invites">${I.plus}Invite people</button>` : ''}
        <button data-action="account">${I.settings}Your account &amp; password</button><hr><button data-action="logout">${I.external}Log out</button></div>` : ''}</div>` : ''}`;
  updateTopState();
}
hooks.renderTop = renderTop;

function renderRunPill() {
  const el = $('#runPill');
  const r = S.autoRun;
  el.hidden = !r?.running;
  if (r?.running) el.innerHTML = `<span class="spinner"></span><button class="link-btn" data-action="view" data-view="automation">Running tests ${r.done}/${r.total} · ${r.pass} passed · ${r.fail} failed</button><button class="btn sm" data-action="auto-stop">${I.stop}Stop</button>`;
}

// ---------------------------------------------------------------- projects page
function renderProjects() {
  const q = S.projectQuery.toLowerCase();
  const list = S.projects.filter((p) => !q || `${p.name} ${p.key}`.toLowerCase().includes(q));
  $('#app').innerHTML = `
  <div class="page"><div class="page-inner">
    <div class="page-h"><h1>Projects</h1><div class="spacer"></div>
      <button class="btn" data-action="import-json">${I.upload}Import backup</button><input type="file" id="jsonInput" hidden accept=".json">
      <button class="btn primary" data-action="go" data-to="#/new">Create project</button></div>
    ${S.projects.length ? `
      <div class="toolbar"><div class="search"><span>${I.search}</span><input id="pq" placeholder="Search projects" value="${esc(S.projectQuery)}"></div></div>
      <table class="tbl"><thead><tr><th>Name</th><th>Key</th><th class="num">Epics</th><th class="num">Issues</th><th>Last updated</th><th></th></tr></thead><tbody>
        ${list.map((p) => `<tr class="click" data-action="go" data-to="#/p/${esc(p.id)}/summary">
          <td><span class="row" style="flex-wrap:nowrap"><span class="proj-avatar" style="width:24px;height:24px;font-size:10px;background:${hashColor(p.key, COLORS)}">${esc(p.key.slice(0, 2))}</span><a>${esc(p.name)}</a></span></td>
          <td>${esc(p.key)}</td><td class="num">${p.epics}</td><td class="num">${p.tickets}</td>
          <td class="muted">${new Date(p.updatedAt).toLocaleString()}</td>
          <td style="text-align:right"><button class="icon-btn" data-action="delete-project" data-id="${esc(p.id)}" title="Delete project">${I.trash}</button></td></tr>`).join('')}
      </tbody></table>
      ${!list.length ? '<div class="empty">No projects match your search.</div>' : ''}` : `
      <div class="empty" style="padding:80px 20px">
        <div style="color:var(--brand)">${I.folder.replace('width="16" height="16"', 'width="56" height="56"')}</div>
        <h3>Create your first project</h3>
        <p>Upload a requirements document and Claude turns it into epics, issues, acceptance criteria and test cases.</p>
        <div class="row" style="justify-content:center;margin-top:16px"><button class="btn primary" data-action="go" data-to="#/new">Create project from a document</button><button class="btn" data-action="blank-project">Blank project</button></div>
      </div>`}
  </div></div>`;
  $('#jsonInput')?.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) importJson(f); });
}

// ---------------------------------------------------------------- create project page
function renderCreate() {
  const g = S.gen, o = S.genOpts, st = S.status;
  const providerOk = st && (st.cli.available || st.api);
  const c = connInfo();
  $('#app').innerHTML = `
  <div class="page"><div class="page-inner">
    <div class="crumbs"><a href="#/">Projects</a><span>/</span><span>Create project</span></div>
    <div class="page-h"><h1>Create a project from a document</h1></div>
    <div class="create-grid">
      <div>
        ${!providerOk && st ? `<div class="warn-banner">${I.warn}<span>No Claude connection found. Install Claude Code and run <code>claude</code> once to sign in, or start the server with <code>ANTHROPIC_API_KEY</code>.</span></div>` : ''}
        <div class="dropzone" id="drop" data-action="pick-file">
          <div style="color:var(--brand)">${I.upload.replace('width="16" height="16"', 'width="32" height="32"')}</div>
          <div style="margin-top:8px"><b>Choose a file</b> or drag and drop it here</div>
          <div class="muted small" style="margin-top:4px">PDF, Word (.docx), Markdown, text, HTML, Excel or CSV — up to 50 MB</div>
          <input type="file" id="fileInput" hidden accept="${esc((st?.supported || []).join(','))}">
        </div>
        ${S.doc ? `
          <div class="filebar">${I.doc}<span class="name">${esc(S.doc.filename)}</span><span class="muted small">${S.doc.text.split(/\s+/).length.toLocaleString()} words</span><button class="btn sm subtle" data-action="clear-doc">Remove</button></div>
          <details><summary class="small muted" style="cursor:pointer">Review or edit the extracted text</summary>
            <textarea class="textarea" id="docText" style="min-height:220px;margin-top:8px;font:12.5px/1.5 var(--mono)">${esc(S.doc.text)}</textarea></details>` : `
          <div class="or">or paste the requirements</div>
          <textarea class="textarea" id="pasteText" placeholder="Paste a PRD, BRD, feature brief or meeting notes…" style="min-height:120px"></textarea>`}
        <div style="margin-top:24px" class="grid2">
          <label class="field"><span>Project key</span><input class="input" id="oKey" maxlength="8" placeholder="Auto, e.g. SHOP" value="${esc(o.projectKey)}"></label>
          <label class="field"><span>Issue size</span><select class="select" id="oGran">
            <option value="coarse" ${o.granularity === 'coarse' ? 'selected' : ''}>Fewer, larger issues</option>
            <option value="balanced" ${o.granularity === 'balanced' ? 'selected' : ''}>Balanced</option>
            <option value="fine" ${o.granularity === 'fine' ? 'selected' : ''}>Many small issues</option></select></label>
          <label class="field"><span>Test cases</span><label class="check" style="min-height:32px"><input type="checkbox" class="cb" id="oTests" ${o.includeTests ? 'checked' : ''}> Write test cases for every issue</label></label>
          <label class="field"><span>Test cases per issue (approx.)</span><input class="input" id="oTpt" type="number" min="1" max="15" value="${esc(o.testsPerTicket)}"></label>
        </div>
        <label class="field"><span>Instructions for Claude (optional)</span>
          <textarea class="textarea" id="oInstr" placeholder="e.g. We use React + Node. Label issues frontend/backend. Add an epic for analytics.">${esc(o.instructions)}</textarea></label>
        <div class="row">
          <button class="btn primary" data-action="generate" ${g?.running ? 'disabled' : ''}>${I.sparkle}Generate backlog</button>
          ${g?.running ? '<button class="btn" data-action="cancel-gen">Cancel</button>' : '<button class="btn subtle" data-action="blank-project">Create a blank project instead</button>'}
        </div>
        <div id="progress">${progressHtml()}</div>
      </div>
      <aside class="info">
        <h4>How it works</h4>
        <div class="step">${typeIcon('Epic')}<div><b>Epics</b>Claude reads the document and groups the work into epics by capability.</div></div>
        <div class="step">${typeIcon('Story')}<div><b>Issues</b>Stories, tasks, spikes and bugs with user stories, estimates and labels.</div></div>
        <div class="step">${typeIcon('Task')}<div><b>Acceptance criteria</b>Testable Given / When / Then criteria for every issue.</div></div>
        <div class="step">${typeIcon('Test')}<div><b>Test cases</b>Steps and expected results that cover each criterion, ready to automate.</div></div>
        <p class="small muted" style="margin:16px 0 0">Using <b>${esc(c.label)}</b>${c.model ? ` (${esc(c.model)})` : ''}. Large documents take a few minutes. <a href="#" data-action="settings">Change</a></p>
      </aside>
    </div>
  </div></div>`;
  bindDrop();
}

function progressHtml() {
  const g = S.gen;
  if (!g) return '';
  return `<div class="progress-box">
    ${g.running ? '<div class="pbar"><i></i></div>' : ''}
    <ul class="log">${g.log.map((l) => `<li class="${l.level || ''}">${l.level === 'err' || l.level === 'warn' ? I.warn : l.done ? `<span class="ok">${I.check}</span>` : '<span class="spinner" style="color:var(--brand)"></span>'}<span>${esc(l.message)}</span></li>`).join('')}
    ${g.running && g.chars ? `<li class="muted small">Claude has written ${g.chars.toLocaleString()} characters…</li>` : ''}</ul></div>`;
}

function bindDrop() {
  const dz = $('#drop');
  if (!dz) return;
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files?.[0]; if (f) uploadDoc(f); });
  $('#fileInput').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) uploadDoc(f); });
}

async function uploadDoc(file) {
  readGenOpts();
  const fd = new FormData();
  fd.append('file', file);
  $('#drop').innerHTML = '<div class="row" style="justify-content:center"><span class="spinner" style="color:var(--brand)"></span> Reading document…</div>';
  try { const r = await api('/api/parse', { method: 'POST', body: fd }); S.doc = { filename: r.filename, text: r.text }; }
  catch (e) { toast(e.message, 'err'); }
  renderCreate();
}

function readGenOpts() {
  if (!$('#oKey')) return;
  S.genOpts = {
    projectKey: $('#oKey').value.trim().replace(/[^a-z0-9]/gi, '').toUpperCase(),
    granularity: $('#oGran').value,
    includeTests: $('#oTests').checked,
    testsPerTicket: Number($('#oTpt').value) || 4,
    instructions: $('#oInstr').value.trim(),
  };
  store.set('tf.genOpts', { ...S.genOpts, projectKey: '' });
  if (S.doc && $('#docText')) S.doc.text = $('#docText').value;
}

async function generate() {
  readGenOpts();
  const text = S.doc ? S.doc.text : $('#pasteText')?.value || '';
  const sourceName = S.doc ? S.doc.filename : 'Pasted requirements';
  if (text.trim().length < 20) return toast('Add a document or paste some requirements first.', 'err');
  if (!S.doc) S.doc = { filename: sourceName, text };
  const ctrl = new AbortController();
  S.gen = { running: true, ctrl, chars: 0, log: [{ message: `Sending “${sourceName}” to Claude…` }] };
  renderCreate();
  const upd = () => { const el = $('#progress'); if (el) el.innerHTML = progressHtml(); };
  const push = (message, level) => { S.gen.log.forEach((l) => { l.done = true; }); S.gen.log.push({ message, level }); upd(); };
  try {
    const res = await api('/api/generate', {
      method: 'POST', raw: true, signal: ctrl.signal,
      body: { text, sourceName, options: { ...S.genOpts, provider: S.settings.provider || undefined, model: S.settings.model || undefined } },
    });
    let project = null;
    await readNdjson(res, (ev) => {
      if (ev.type === 'progress') {
        if (ev.progressChars) { S.gen.chars = ev.progressChars; upd(); }
        if (ev.message) { S.gen.chars = 0; push(ev.message, ev.level); }
      } else if (ev.type === 'done') project = ev.project;
      else if (ev.type === 'error') throw new Error(ev.error);
    });
    if (!project) throw new Error('Generation ended without a result.');
    S.gen = null; S.doc = null;
    toast(`Created ${project.epics.length} epics and ${project.tickets.length} issues`);
    go(`#/p/${project.id}/backlog`);
  } catch (e) {
    if (e.name === 'AbortError') { S.gen = null; renderCreate(); return toast('Generation cancelled'); }
    S.gen.running = false;
    S.gen.log.forEach((l) => { l.done = true; });
    S.gen.log.push({ message: `Generation failed: ${e.message}`, level: 'err' });
    renderCreate();
  }
}

async function importJson(file) {
  try {
    const p = JSON.parse(await file.text());
    if (!Array.isArray(p.tickets) || !Array.isArray(p.epics)) throw new Error('Not a TicketForge project file');
    p.id = uid();
    p.name = p.name || file.name.replace(/\.json$/, '');
    await api('/api/projects', { method: 'POST', body: p });
    go(`#/p/${p.id}/summary`);
  } catch (e) { toast(`Import failed: ${e.message}`, 'err'); }
}

function blankProject() {
  openModal({
    title: 'Create a blank project',
    body: `<label class="field"><span>Name <span class="req">*</span></span><input class="input" id="bpName" placeholder="e.g. Mobile app relaunch"></label>
      <label class="field"><span>Key <span class="req">*</span></span><input class="input" id="bpKey" maxlength="8" placeholder="e.g. MAR"></label>`,
    actions: [{ label: 'Cancel', action: 'modal-close' }, { label: 'Create', primary: true, onClick: async () => {
      const name = $('#bpName').value.trim();
      const key = ($('#bpKey').value || initials(name) || 'PRJ').replace(/[^a-z0-9]/gi, '').toUpperCase();
      if (!name) return $('#bpName').focus();
      const id = uid(), now = nowIso();
      const p = { id, name, key, summary: '', assumptions: [], openQuestions: [], sourceName: '', sourceText: '', epics: [], tickets: [], createdAt: now, updatedAt: now, members: [{ id: uid(), name: me(), email: '', role: '' }] };
      await api('/api/projects', { method: 'POST', body: p });
      closeModal(); go(`#/p/${id}/backlog`);
    } }],
    onOpen: (m) => {
      const n = $('#bpName', m), k = $('#bpKey', m);
      n.addEventListener('input', () => { if (!k.dataset.touched) k.value = n.value.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 4).toUpperCase(); });
      k.addEventListener('input', () => { k.dataset.touched = '1'; });
      n.focus();
    },
  });
}

// ---------------------------------------------------------------- project shell
function renderShell() {
  if (!$('#shell')) {
    $('#app').innerHTML = `<div class="shell" id="shell"><nav class="sidebar" id="sidebar" aria-label="Project"></nav>
      <div class="main"><section class="view" id="view"></section><div class="drawer-blanket" id="blanket" hidden data-action="close-drawer"></div><aside class="drawer" id="drawer" hidden></aside></div></div>`;
  }
  renderSidebar(); renderView(); renderDrawer();
}

function renderSidebar() {
  const p = P();
  if (!$('#sidebar') || !p) return;
  const tests = p.tickets.reduce((s, t) => s + t.testCases.length, 0);
  const act = activeSprint();
  const item = (v, icon, label, n = '') => `<button class="side-item ${S.view === v ? 'active' : ''}" data-action="view" data-view="${v}">${icon}<span>${label}</span>${n !== '' ? `<span class="n">${n}</span>` : ''}</button>`;
  $('#sidebar').innerHTML = `
    <div class="proj-head"><span class="proj-avatar" style="background:${hashColor(p.key, COLORS)}">${esc(p.key.slice(0, 2))}</span><div style="min-width:0"><b title="${esc(p.name)}">${esc(p.name)}</b><span>Software project</span></div></div>
    <div class="side-label">Planning</div>
    ${item('summary', I.summary, 'Summary')}
    ${item('backlog', I.backlog, 'Backlog', p.tickets.filter((t) => !isSub(t)).length)}
    ${item('board', I.board, act ? 'Active sprint' : 'Board')}
    ${item('epics', I.epic, 'Epics', p.epics.length)}
    ${item('reports', I.chart, 'Reports')}
    <div class="side-label">Quality</div>
    ${item('tests', I.test, 'Test cases', tests)}
    ${item('automation', I.bot, 'Test automation')}
    <div class="side-label">Requirements</div>
    ${item('source', I.doc, 'Source document')}
    <div class="side-foot">${item('settings', I.settings, 'Project settings')}</div>`;
}
hooks.renderSidebar = renderSidebar;

function renderView() {
  const el = $('#view');
  if (!el || !P()) return;
  const ae = document.activeElement;
  const focusId = ae && el.contains(ae) ? ae.id : null;
  const caret = focusId ? ae.selectionStart : null;
  const scroll = el.scrollTop;
  const fn = { summary: viewSummary, backlog: viewBacklog, board: viewBoard, epics: viewEpics, tests: viewTests, reports: viewReports, automation: viewAutomation, source: viewSource, settings: viewSettings }[S.view] || viewBacklog;
  el.innerHTML = fn();
  el.scrollTop = scroll;
  if (focusId) { const f = document.getElementById(focusId); if (f) { f.focus(); try { f.setSelectionRange(caret, caret); } catch { /* not text */ } } }
  $$('textarea', el).forEach(autosize);
  bindDnD();
}
hooks.renderView = renderView;

function renderDrawer() {
  const dr = $('#drawer');
  if (!dr) return;
  const t = openIssue(), e = openEpic();
  if (!t && !e) { S.drawer = null; dr.hidden = true; $('#blanket').hidden = true; dr.innerHTML = ''; return; }
  const sc = $('.dr-scroll', dr);
  const keep = sc && dr.dataset.for === S.drawer.id ? sc.scrollTop : 0;
  const draft = $('#cmtText', dr)?.value;
  dr.hidden = false;
  dr.dataset.for = S.drawer.id;
  dr.classList.toggle('full', S.full);
  $('#blanket').hidden = !S.full;
  dr.innerHTML = t ? issueDrawer(t) : epicDrawer(e);
  $$('textarea', dr).forEach(autosize);
  const s2 = $('.dr-scroll', dr);
  if (s2) s2.scrollTop = keep;
  if (draft && $('#cmtText', dr)) $('#cmtText', dr).value = draft;
  $('details.details', dr)?.addEventListener('toggle', (ev) => { S.detailsOpen = ev.target.open; saveUi(); });
}
hooks.renderDrawer = renderDrawer;

function openDrawer(kind, id) {
  S.drawer = { kind, id };
  Object.assign(S, { menu: null, subForm: false, linkForm: false, prForm: false, cmtEdit: null });
  renderDrawer(); renderView();
}

// ---------------------------------------------------------------- editing (data-bind)
function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight + 2, ta.classList.contains('code') ? 420 : 640)}px`;
}

function onBind(e) {
  const el = e.target.closest('[data-bind]');
  if (!el || !P()) return;
  const path = el.dataset.bind.split('.');
  const kind = el.dataset.type;
  let v = el.value;
  if (kind === 'number') v = v === '' ? null : Number(v);
  if (kind === 'lines') v = v.split('\n').map((s) => s.trim()).filter(Boolean);
  if (kind === 'csv') v = v.split(',').map((s) => s.trim()).filter(Boolean);
  if (kind === 'nums') v = v.split(/[,\s]+/).map((s) => Number(s.replace(/\D/g, ''))).filter((n) => n > 0);
  if (kind === 'key') v = v.replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (['epicId', 'sprintId', 'parentId'].includes(path[1]) && !v) v = null;
  const p = P(), t = openIssue(), ep = openEpic();
  const tag = el.dataset.bind + (t?.id || ep?.id || '');
  const isSelect = el.tagName === 'SELECT';
  const render = path[0] === 'p' || path[0] === 'auto' ? 'side' : 'view';
  mutate(() => {
    if (path[0] === 't' && t) {
      if (path[1] === 'parentId') {
        const par = ticket(v);
        setField(t, 'parentId', v);
        if (par) { t.epicId = par.epicId; t.sprintId = par.sprintId; }
      } else setField(t, path[1], v);
    } else if (path[0] === 'ac' && t) {
      const old = clone(t.acceptanceCriteria);
      t.acceptanceCriteria[Number(path[1])] = v;
      logChange(t, 'acceptanceCriteria', old, t.acceptanceCriteria);
    } else if (path[0] === 'tc' && t) {
      const tc = t.testCases[Number(path[1])];
      const old = tc[path[2]];
      tc[path[2]] = v;
      if (path[2] === 'status') logEvent(t, `marked ${tcKey(t, Number(path[1]))} as ${v}`);
      else if (path[2] !== 'script') logChange(t, 'testCases', old, v);
    } else if (path[0] === 'e' && ep) ep[path[1]] = v;
    else if (path[0] === 'auto') p.automation[path[1]] = String(v).trim();
    else if (path[0] === 'p') {
      if (path[1] === 'key') { if (v && v !== p.key) rekey(p, v); }
      else p[path[1]] = v;
    }
  }, { tag, render });
  if (isSelect) renderDrawer();
  if (path[0] === 'p' && path[1] === 'name') renderTop();
}
function rekey(p, key) {
  const old = p.key;
  p.key = key;
  for (const x of [...p.tickets, ...p.epics]) if (x.key?.startsWith(`${old}-`)) x.key = `${key}-${x.key.slice(old.length + 1)}`;
}

const FILTER_IDS = { fEpic: 'epic', fType: 'type', fPrio: 'priority', fStatus: 'status' };
document.addEventListener('input', (e) => {
  const tg = e.target;
  if (tg.tagName === 'TEXTAREA') autosize(tg);
  if (tg.id === 'fq') { S.filter.q = tg.value; return renderView(); }
  if (tg.id === 'tq') { S.tcFilter.q = tg.value; return renderView(); }
  if (tg.id === 'pq') { S.projectQuery = tg.value; renderProjects(); const q = $('#pq'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); return; }
  if (tg.matches('[data-bind]') && tg.tagName !== 'SELECT') onBind(e);
});

function bulkSet(field, value, label) {
  const ids = [...S.checked];
  mutate(() => ids.forEach((id) => { const t = ticket(id); if (t) setField(t, field, value); }));
  S.checked.clear(); renderView();
  toast(`${ids.length} issues ${label}`);
}

document.addEventListener('change', (e) => {
  const tg = e.target;
  if (FILTER_IDS[tg.id]) { S.filter[FILTER_IDS[tg.id]] = tg.value; return renderView(); }
  if (tg.id === 'fGroup') { S.groupBy = tg.value; saveUi(); return renderView(); }
  if (tg.id === 'fBoardGroup') { S.boardGroup = tg.value; saveUi(); return renderView(); }
  if (tg.id === 'fBoardScope') { S.boardAll = tg.value === 'all'; return renderView(); }
  if (tg.id === 'tStatus') { S.tcFilter.status = tg.value; return renderView(); }
  if (tg.id === 'tType') { S.tcFilter.type = tg.value; return renderView(); }
  if (tg.id === 'arScope') { S.autoScope = tg.value; return renderView(); }
  if (tg.id === 'arRegen') { S.autoRegen = tg.checked; return; }
  if (tg.id === 'meSelect') { store.set('tf.me', tg.value); renderTop(); toast(`You are now ${tg.value}`); return renderView(); }
  if (tg.id === 'bulkEpic' && tg.value) return bulkSet('epicId', tg.value === '__none' ? null : tg.value, `moved to ${epic(tg.value)?.title || 'No epic'}`);
  if (tg.id === 'bulkSprint' && tg.value) return bulkSet('sprintId', tg.value === '__none' ? null : tg.value, `moved to ${sprint(tg.value)?.name || 'the backlog'}`);
  if (tg.id === 'bulkStatus' && tg.value) return bulkSet('status', tg.value, `set to ${tg.value}`);
  if (tg.id === 'bulkAssignee' && tg.value) return bulkSet('assignee', tg.value === '__none' ? '' : tg.value, tg.value === '__none' ? 'unassigned' : `assigned to ${tg.value}`);
  if (tg.dataset.tcstatus) {
    const [tid, tcid] = tg.dataset.tcstatus.split(':');
    const { t, tc } = findTc(tid, tcid);
    mutate(() => { if (tc) { tc.status = tg.value; logEvent(t, `marked ${tcKey(t, t.testCases.indexOf(tc))} as ${tg.value}`); } });
    return;
  }
  if (tg.dataset.member) {
    const m = P().members.find((x) => x.id === tg.dataset.member);
    const field = tg.dataset.mf;
    const val = tg.value.trim();
    if (!m || (field === 'name' && !val)) return renderView();
    mutate((p) => {
      if (field === 'name' && val !== m.name) {
        for (const t of p.tickets) { if (t.assignee === m.name) t.assignee = val; if (t.reporter === m.name) t.reporter = val; }
        if (store.get('tf.me', '') === m.name) store.set('tf.me', val);
      }
      m[field] = val;
    }, { render: 'view' });
    renderTop();
    return;
  }
  if (tg.dataset.wf !== undefined) {
    const i = Number(tg.dataset.wf);
    const w = P().workflow[i];
    if (tg.dataset.wff === 'name') {
      const name = tg.value.trim();
      if (!name || P().workflow.some((x, j) => j !== i && x.name.toLowerCase() === name.toLowerCase())) { toast('Status names must be unique and not empty.', 'err'); return renderView(); }
      mutate((p) => { p.tickets.forEach((t) => { if (t.status === w.name) t.status = name; }); w.name = name; });
    } else mutate(() => { w.category = tg.value; });
    return;
  }
  if (tg.matches('input[data-bind="t.assignee"], input[data-bind="t.reporter"]') && tg.value.trim()) { mutate(() => addMember(tg.value), { render: 'side' }); return; }
  if (tg.matches('select[data-bind]')) onBind(e);
});

// ---------------------------------------------------------------- drag & drop
let dragId = null;
function bindDnD() {
  $$('[data-ticket][draggable]').forEach((c) => {
    c.addEventListener('dragstart', (e) => { dragId = c.dataset.ticket; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
    c.addEventListener('dragend', () => { c.classList.remove('dragging'); dragId = null; $$('.drop, .drop-before').forEach((n) => n.classList.remove('drop', 'drop-before')); });
    c.addEventListener('dragover', (e) => { if (dragId && dragId !== c.dataset.ticket) { e.preventDefault(); e.stopPropagation(); c.classList.add('drop-before'); } });
    c.addEventListener('dragleave', () => c.classList.remove('drop-before'));
    c.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      moveTicket(dragId, c.closest('[data-drop-group],[data-drop-status]'), ticket(c.dataset.ticket));
    });
  });
  $$('[data-drop-group],[data-drop-status]').forEach((z) => {
    z.addEventListener('dragover', (e) => { if (dragId) { e.preventDefault(); z.classList.add('drop'); } });
    z.addEventListener('dragleave', (e) => { if (!z.contains(e.relatedTarget)) z.classList.remove('drop'); });
    z.addEventListener('drop', (e) => { e.preventDefault(); moveTicket(dragId, z, null); });
  });
}
function moveTicket(id, zone, before) {
  if (!id || !zone) return;
  mutate((p) => {
    const t = p.tickets.find((x) => x.id === id);
    const g = zone.dataset.dropGroup;
    if (g?.startsWith('e:')) setField(t, 'epicId', g === 'e:none' ? null : g.slice(2));
    if (g?.startsWith('s:')) setField(t, 'status', g.slice(2));
    if (g?.startsWith('sp:')) setField(t, 'sprintId', g === 'sp:none' ? null : g.slice(3));
    if (zone.dataset.dropStatus) setField(t, 'status', zone.dataset.dropStatus);
    if (zone.dataset.dropEpic !== undefined && !isSub(t)) setField(t, 'epicId', zone.dataset.dropEpic || null);
    if (before && before.id !== id) {
      p.tickets.splice(p.tickets.indexOf(t), 1);
      p.tickets.splice(p.tickets.indexOf(before), 0, t);
    }
  });
}

// ---------------------------------------------------------------- clicks
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (S.menu && !e.target.closest('.menu-wrap')) closeMenu();
  if (!el) return;
  const a = el.dataset.action;
  if (el.tagName === 'A' || (el.closest('a') && a !== 'go')) e.preventDefault();
  const t = openIssue();
  switch (a) {
    case 'go': closeMenu(); go(el.dataset.to); break;
    case 'logout': logout(); break;
    case 'account': closeMenu(); openAccount(); break;
    case 'settings': openSettings(); break;
    case 'menu': e.stopPropagation(); S.menu = S.menu === el.dataset.menu ? null : el.dataset.menu; ['export', 'account'].includes(el.dataset.menu) ? renderTop() : renderDrawer(); break;
    case 'export': closeMenu(); exportAs(el.dataset.fmt); break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'create': if (S.route.name === 'project' && P()) openCreateIssue({ epicId: el.dataset.epic }); else go('#/new'); break;

    // projects & create page
    case 'pick-file': if (e.target.id !== 'fileInput') $('#fileInput').click(); break;
    case 'clear-doc': e.stopPropagation(); readGenOpts(); S.doc = null; renderCreate(); break;
    case 'generate': generate(); break;
    case 'cancel-gen': S.gen?.ctrl.abort(); break;
    case 'import-json': $('#jsonInput').click(); break;
    case 'blank-project': blankProject(); break;
    case 'delete-project': {
      e.stopPropagation();
      const name = P()?.id === el.dataset.id ? P().name : S.projects.find((x) => x.id === el.dataset.id)?.name;
      confirmModal('Delete project?', `“${esc(name)}” and all of its issues will be permanently deleted. This can’t be undone.`, 'Delete', async () => {
        await api(`/api/projects/${el.dataset.id}`, { method: 'DELETE' });
        S.project = null; toast('Project deleted');
        if (S.route.name === 'projects') { S.projects = await api('/api/projects'); renderProjects(); } else go('#/');
      });
      break;
    }

    // navigation & filters
    case 'view': go(`#/p/${P().id}/${el.dataset.view}`); break;
    case 'clear-filters': S.filter = EMPTY_FILTER(); renderView(); break;
    case 'quick-assignee': S.filter.assignee = S.filter.assignee === el.dataset.name ? '' : el.dataset.name; renderView(); break;
    case 'filter-noepic': S.filter.epic = 'none'; S.groupBy = 'epic'; go(`#/p/${P().id}/backlog`); break;
    case 'board-all': S.boardAll = true; renderView(); break;
    case 'toggle-sec':
      if (e.target.closest('button, a')) return;
      S.collapsed.has(el.dataset.sec) ? S.collapsed.delete(el.dataset.sec) : S.collapsed.add(el.dataset.sec);
      saveUi(); renderView(); break;
    case 'open-issue':
      if (e.target.closest('[data-action="check"], [data-action="link-del"]')) return;
      openDrawer('issue', el.dataset.id); break;
    case 'open-epic': e.stopPropagation(); openDrawer('epic', el.dataset.id); break;
    case 'open-test':
      if (e.target.closest('select, button, a')) return;
      openDrawer('issue', el.dataset.id); S.openTc.add(el.dataset.tc); renderDrawer();
      $(`#tc-${CSS.escape(el.dataset.tc)}`)?.scrollIntoView({ block: 'center' });
      break;
    case 'close-drawer': S.drawer = null; S.full = false; S.menu = null; renderDrawer(); renderView(); break;
    case 'toggle-full': S.full = !S.full; renderDrawer(); break;
    case 'check':
      e.stopPropagation();
      el.checked ? S.checked.add(el.dataset.id) : S.checked.delete(el.dataset.id);
      renderView(); break;
    case 'bulk-clear': S.checked.clear(); renderView(); break;
    case 'bulk-delete': {
      const n = [...S.checked].length;
      confirmModal(`Delete ${n} issues?`, 'Their sub-tasks are deleted too. You can undo with ⌘Z.', 'Delete', () => {
        let count = 0;
        mutate(() => { count = deleteIssues([...S.checked]); }, { render: 'none' });
        S.checked.clear(); if (S.drawer && !openIssue() && !openEpic()) S.drawer = null; renderAll();
        toast(`Deleted ${count} issues`);
      });
      break;
    }
    case 'bulk-tests': bulkTests(); break;
    case 'bulk-run': runTests(P().tickets.filter((x) => S.checked.has(x.id)).flatMap((x) => x.testCases.map((tc) => ({ t: x, tc })))); break;

    // inline create
    case 'ic-open': S.inlineCreate = el.dataset.sec; renderView(); $('#icInput')?.focus(); break;
    case 'ic-cancel': S.inlineCreate = null; renderView(); break;
    case 'ic-submit': inlineCreate(); break;

    // sprints
    case 'sprint-create': {
      const n = P().sprints.length + 1;
      mutate((p) => p.sprints.push({ id: uid(), name: `${p.key} Sprint ${n}`, goal: '', state: 'future', startDate: '', endDate: '' }));
      toast(`Created ${P().key} Sprint ${n}`);
      break;
    }
    case 'sprint-start': sprintModal(sprint(el.dataset.id), 'start'); break;
    case 'sprint-edit': sprintModal(sprint(el.dataset.id), 'edit'); break;
    case 'sprint-complete': completeSprintModal(sprint(el.dataset.id)); break;
    case 'sprint-delete': {
      const s = sprint(el.dataset.id);
      const n = P().tickets.filter((x) => x.sprintId === s.id).length;
      confirmModal(`Delete ${s.name}?`, `${n ? `Its ${n} issues move back to the backlog. ` : ''}You can undo with ⌘Z.`, 'Delete sprint', () => {
        mutate((p) => { p.tickets.forEach((x) => { if (x.sprintId === s.id) setField(x, 'sprintId', null); }); p.sprints = p.sprints.filter((x) => x.id !== s.id); });
      });
      break;
    }

    // epics
    case 'add-epic': {
      const ne = { id: uid(), key: nextEpicKey(), title: 'New epic', description: '', color: COLORS[P().epics.length % COLORS.length] };
      mutate((p) => p.epics.push(ne), { render: 'none' });
      openDrawer('epic', ne.id); renderSidebar();
      setTimeout(() => { const i = $('#drawer .summary-input'); i?.focus(); i?.select(); }, 0);
      break;
    }
    case 'epic-color': mutate(() => { openEpic().color = el.dataset.c; }); break;
    case 'del-epic': {
      closeMenu();
      const ep = openEpic();
      const n = epicTickets(ep.id).length;
      openModal({
        title: `Delete ${ep.key}?`,
        body: `<p>Delete the epic “${esc(ep.title)}”?${n ? ` It has ${n} child issues.` : ''}</p>`,
        actions: [{ label: 'Cancel', action: 'modal-close' },
          ...(n ? [{ label: 'Delete epic and its issues', onClick: () => delEpic(ep, true) }] : []),
          { label: n ? 'Delete epic, keep issues' : 'Delete', danger: true, onClick: () => delEpic(ep, false) }],
      });
      break;
    }

    // issue actions
    case 'dup-issue': {
      closeMenu();
      const d = newTicket({ ...clone(t), id: uid(), key: nextTicketKey(), title: `${t.title} (copy)`, comments: [], history: [], links: [], prs: [], createdAt: nowIso(), reporter: me() });
      d.testCases.forEach((tc) => { tc.id = uid(); tc.lastRun = null; });
      mutate((p) => p.tickets.splice(p.tickets.indexOf(t) + 1, 0, d), { render: 'none' });
      openDrawer('issue', d.id); renderSidebar(); toast(`Created ${d.key}`); break;
    }
    case 'copy-key': closeMenu(); navigator.clipboard?.writeText(t.key); toast(`Copied ${t.key}`); break;
    case 'convert-sub': closeMenu(); convertToSubtask(t); break;
    case 'del-issue': {
      closeMenu();
      const n = childrenOf(t).length;
      confirmModal(`Delete ${t.key}?`, `“${esc(t.title)}”${n ? ` and its ${n} sub-tasks` : ''} will be deleted. You can undo with ⌘Z.`, 'Delete', () => {
        mutate(() => deleteIssues([t.id]), { render: 'none' });
        S.drawer = null; renderAll(); toast(`Deleted ${t.key}`);
      });
      break;
    }
    case 'assign-me': mutate(() => { addMember(me()); setField(t, 'assignee', me()); }); break;
    case 'ac-add': mutate(() => { t.acceptanceCriteria.push(''); logChange(t, 'acceptanceCriteria', 0, 1); }); focusLast('[data-bind^="ac."]'); break;
    case 'ac-add-gwt': mutate(() => { t.acceptanceCriteria.push('Given , when , then '); logChange(t, 'acceptanceCriteria', 0, 1); }); focusLast('[data-bind^="ac."]'); break;
    case 'ac-del': mutate(() => { t.acceptanceCriteria.splice(Number(el.dataset.i), 1); logChange(t, 'acceptanceCriteria', 1, 0); }); break;
    case 'ac-move': { const i = Number(el.dataset.i), j = i + Number(el.dataset.d); mutate(() => { const l = t.acceptanceCriteria; [l[i], l[j]] = [l[j], l[i]]; }); break; }
    case 'tc-toggle': if (e.target.closest('input,select,button')) return; S.openTc.has(el.dataset.id) ? S.openTc.delete(el.dataset.id) : S.openTc.add(el.dataset.id); renderDrawer(); break;
    case 'tc-all': t.testCases.forEach((x) => (el.dataset.open === '1' ? S.openTc.add(x.id) : S.openTc.delete(x.id))); renderDrawer(); break;
    case 'tc-add': { const n = newTest(); S.openTc.add(n.id); mutate(() => { t.testCases.push(n); logEvent(t, 'added a test case'); }); break; }
    case 'tc-dup': { const i = Number(el.dataset.i); const n = { ...clone(t.testCases[i]), id: uid(), lastRun: null }; S.openTc.add(n.id); mutate(() => t.testCases.splice(i + 1, 0, n)); break; }
    case 'tc-del': mutate(() => { const [x] = t.testCases.splice(Number(el.dataset.i), 1); logEvent(t, `removed test case “${x.title}”`); }); break;

    // sub-tasks
    case 'sub-open': S.subForm = true; renderDrawer(); $('#subInput')?.focus(); break;
    case 'sub-cancel': S.subForm = false; renderDrawer(); break;
    case 'sub-submit': createSubtask(); break;

    // links
    case 'link-open': S.linkForm = true; renderDrawer(); $('#lkTarget')?.focus(); break;
    case 'link-cancel': S.linkForm = false; renderDrawer(); break;
    case 'link-submit': {
      const target = ticket($('#lkTarget').value);
      if (!target) return toast('Choose an issue to link.', 'err');
      const type = $('#lkType').value;
      let ok = false;
      mutate(() => { ok = addLink(t, type, target); }, { render: 'none' });
      S.linkForm = false; renderDrawer(); renderView();
      toast(ok ? `${t.key} ${type} ${target.key}` : 'That link already exists.', ok ? 'ok' : 'err');
      break;
    }
    case 'link-del': e.stopPropagation(); mutate(() => removeLink(t, el.dataset.link)); break;

    // pull requests
    case 'pr-open': if (!t) return; S.prForm = true; renderDrawer(); $('#prUrl')?.focus(); break;
    case 'pr-cancel': S.prForm = false; renderDrawer(); break;
    case 'pr-submit': linkPr(); break;
    case 'pr-refresh': refreshPr(t, el.dataset.pr); break;
    case 'pr-del': mutate(() => { const r = t.prs.find((x) => x.id === el.dataset.pr); t.prs = t.prs.filter((x) => x.id !== el.dataset.pr); logEvent(t, `unlinked pull request ${r?.title || ''}`); }); break;

    // activity
    case 'act-tab': S.actTab = el.dataset.tab; saveUi(); renderDrawer(); break;
    case 'cmt-save': saveComment(); break;
    case 'cmt-edit': S.cmtEdit = el.dataset.id; renderDrawer(); $('#cmtEditText')?.focus(); break;
    case 'cmt-cancel': S.cmtEdit = null; renderDrawer(); break;
    case 'cmt-update': {
      const body = $('#cmtEditText').value.trim();
      if (!body) return;
      S.cmtEdit = null;
      mutate(() => { const c = t.comments.find((x) => x.id === el.dataset.id); c.body = body; c.editedAt = nowIso(); });
      break;
    }
    case 'cmt-del': confirmModal('Delete this comment?', 'The comment is removed from the issue.', 'Delete', () => mutate(() => { t.comments = t.comments.filter((x) => x.id !== el.dataset.id); })); break;

    // automation
    case 'auto-run': runTests(automationItems(S.autoScope), { regenerate: S.autoRegen }); break;
    case 'auto-stop': S.autoRun?.ctrl?.abort(); break;
    case 'run-filtered': runTests(testRows()); break;
    case 'run-issue-tests': runTests(t.testCases.map((tc) => ({ t, tc }))); break;
    case 'run-tc': {
      e.stopPropagation();
      const x = findTc(el.dataset.id, el.dataset.tc);
      if (x.tc) runTests([x], { regenerate: el.dataset.regen === '1' });
      break;
    }
    case 'script-view': e.stopPropagation(); scriptModal(el.dataset.id, el.dataset.tc); break;
    case 'install-browser': installBrowser(); break;

    // team & workflow
    case 'member-add': mutate((p) => p.members.push({ id: uid(), name: `Person ${p.members.length + 1}`, email: '', role: '' }), { render: 'view' }); setTimeout(() => { const i = $$('[data-mf="name"]').pop(); i?.focus(); i?.select(); }, 0); break;
    case 'member-del': {
      const m = P().members.find((x) => x.id === el.dataset.id);
      const n = P().tickets.filter((x) => x.assignee === m.name).length;
      confirmModal(`Remove ${m.name}?`, n ? `${n} issues assigned to them become unassigned.` : 'They are removed from the people list.', 'Remove', () => {
        mutate((p) => { p.tickets.forEach((x) => { if (x.assignee === m.name) setField(x, 'assignee', ''); }); p.members = p.members.filter((x) => x.id !== m.id); }, { render: 'view' });
      });
      break;
    }
    case 'wf-add': mutate((p) => { let n = 'New status', k = 1; while (p.workflow.some((w) => w.name === n)) n = `New status ${++k}`; p.workflow.splice(p.workflow.length - 1, 0, { id: uid(), name: n, category: 'inprogress' }); }); break;
    case 'wf-move': { const i = Number(el.dataset.i), j = i + Number(el.dataset.d); mutate((p) => { const l = p.workflow; [l[i], l[j]] = [l[j], l[i]]; }); break; }
    case 'wf-del': {
      const w = P().workflow[Number(el.dataset.i)];
      const rest = P().workflow.filter((x) => x !== w);
      const to = rest.find((x) => x.category === w.category) || rest[0];
      const n = P().tickets.filter((x) => x.status === w.name).length;
      confirmModal(`Delete status “${w.name}”?`, n ? `${n} issues move to “${esc(to.name)}”.` : 'No issues use this status.', 'Delete status', () => {
        mutate((p) => { p.tickets.forEach((x) => { if (x.status === w.name) setField(x, 'status', to.name); }); p.workflow = rest; });
      });
      break;
    }

    // Claude
    case 'ai': closeMenu(); runTicketAi(el.dataset.op); break;
    case 'ai-ask': closeMenu(); openAsk(); break;
    case 'ai-new': openNewWithClaude(el.dataset.epic); break;
    case 'regroup': openRegroup(); break;
    case 'modal-close': closeModal(); break;
    default: break;
  }
});

function delEpic(ep, withIssues) {
  mutate((p) => {
    if (withIssues) deleteIssues(p.tickets.filter((x) => x.epicId === ep.id).map((x) => x.id));
    else p.tickets.forEach((x) => { if (x.epicId === ep.id) setField(x, 'epicId', null); });
    p.epics = p.epics.filter((x) => x.id !== ep.id);
  }, { render: 'none' });
  S.drawer = null; closeModal(); renderAll(); toast(`Deleted ${ep.key}`);
}

function inlineCreate() {
  const title = $('#icInput')?.value.trim();
  if (!title) return;
  const g = S.inlineCreate;
  const fields = { title, type: $('#icType').value };
  if (g?.startsWith('e:')) fields.epicId = g === 'e:none' ? null : g.slice(2);
  if (g?.startsWith('s:')) fields.status = g.slice(2);
  if (g?.startsWith('sp:')) fields.sprintId = g === 'sp:none' ? null : g.slice(3);
  if (S.filter.epic && S.filter.epic !== 'none' && !fields.epicId) fields.epicId = S.filter.epic;
  const nt = newTicket(fields);
  mutate((p) => p.tickets.push(nt), { render: 'view' });
  $('#icInput')?.focus();
  toast(`Created ${nt.key}`);
}

function createSubtask() {
  const t = openIssue();
  const title = $('#subInput')?.value.trim();
  if (!t || !title) return;
  const st = newTicket({ title, type: 'Sub-task', parentId: t.id, epicId: t.epicId, sprintId: t.sprintId, priority: t.priority });
  mutate((p) => { p.tickets.push(st); logEvent(t, `added sub-task ${st.key}`); });
  $('#subInput')?.focus();
  toast(`Created ${st.key}`);
}

function convertToSubtask(t) {
  if (childrenOf(t).length) return toast('Issues with sub-tasks can’t become sub-tasks.', 'err');
  const parents = P().tickets.filter((x) => !isSub(x) && x.id !== t.id);
  openModal({
    title: `Convert ${t.key} to a sub-task`,
    body: `<label class="field"><span>Parent issue</span><select class="select" id="cvParent">${parents.map((x) => `<option value="${esc(x.id)}">${esc(x.key)} — ${esc(x.title.slice(0, 60))}</option>`).join('')}</select></label>`,
    actions: [{ label: 'Cancel', action: 'modal-close' }, { label: 'Convert', primary: true, onClick: () => {
      const par = ticket($('#cvParent').value);
      mutate(() => { setField(t, 'type', 'Sub-task'); setField(t, 'parentId', par.id); t.epicId = par.epicId; t.sprintId = par.sprintId; logEvent(par, `added sub-task ${t.key}`); });
      closeModal(); toast(`${t.key} is now a sub-task of ${par.key}`);
    } }],
  });
}

async function linkPr() {
  const t = openIssue();
  const url = $('#prUrl')?.value.trim();
  if (!t || !url) return;
  if (t.prs.some((r) => r.url === url)) return toast('That pull request is already linked.', 'err');
  const btn = $('[data-action="pr-submit"]'); if (btn) { btn.disabled = true; btn.textContent = 'Looking up…'; }
  try {
    const info = await api(`/api/pr-info?url=${encodeURIComponent(url)}`);
    S.prForm = false;
    mutate(() => { t.prs.push({ id: uid(), ...info, checkedAt: nowIso() }); logEvent(t, `linked pull request ${info.title}`); });
    toast(`Linked ${info.repo}${info.number ? ` #${info.number}` : ''} (${info.status})`);
  } catch (err) { toast(err.message, 'err'); if (btn) { btn.disabled = false; btn.textContent = 'Link'; } }
}
async function refreshPr(t, prId) {
  const r = t.prs.find((x) => x.id === prId);
  try {
    const info = await api(`/api/pr-info?url=${encodeURIComponent(r.url)}`);
    mutate(() => {
      if (info.status !== r.status) logEvent(t, `pull request ${info.repo}${info.number ? ` #${info.number}` : ''} is now ${info.status}`, 'Development');
      Object.assign(r, info, { checkedAt: nowIso() });
    });
    toast(`${info.title}: ${info.status}`);
  } catch (err) { toast(err.message, 'err'); }
}

function saveComment() {
  const t = openIssue();
  const body = $('#cmtText')?.value.trim();
  if (!t || !body) return;
  $('#cmtText').value = '';
  mutate(() => { t.comments.push({ id: uid(), author: me(), body, at: nowIso() }); t.updatedAt = nowIso(); });
}

document.addEventListener('keydown', (e) => {
  const inField = e.target.closest('input,textarea,select,[contenteditable]');
  const id = e.target.id;
  if (id === 'icInput' || id === 'subInput' || id === 'prUrl') {
    if (e.key === 'Enter') { e.preventDefault(); ({ icInput: inlineCreate, subInput: createSubtask, prUrl: linkPr })[id](); }
    if (e.key === 'Escape') { e.stopPropagation(); if (id === 'icInput') { S.inlineCreate = null; renderView(); } else { S.subForm = false; S.prForm = false; renderDrawer(); } }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    if (id === 'cmtText') { e.preventDefault(); return saveComment(); }
    if (id === 'cmtEditText') { e.preventDefault(); return $('[data-action="cmt-update"]')?.click(); }
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !inField && P()) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && P()) { e.preventDefault(); saveNow(); return; }
  if (e.key === 'Escape') {
    if ($('#modalRoot').innerHTML) return closeModal();
    if (S.menu) return closeMenu();
    if (S.full) { S.full = false; return renderDrawer(); }
    if (S.drawer && !inField) { S.drawer = null; renderDrawer(); renderView(); }
    return;
  }
  if (!inField && !e.metaKey && !e.ctrlKey && !e.altKey && !$('#modalRoot').innerHTML && P()) {
    if (e.key === 'c') { e.preventDefault(); openCreateIssue({}); }
    if (e.key === '/') { const f = $('#fq') || $('#tq'); if (f) { e.preventDefault(); f.focus(); } }
  }
});

function focusLast(sel) { setTimeout(() => { const l = $$(`#drawer ${sel}`).pop(); l?.focus(); }, 0); }
function closeMenu() {
  if (!S.menu) return;
  const m = S.menu; S.menu = null;
  ['export', 'account'].includes(m) ? renderTop() : renderDrawer();
}

// ---------------------------------------------------------------- sprints
function sprintModal(s, mode) {
  const start = s.startDate || dateInput(Date.now());
  const weeks = 2;
  const end = s.endDate || dateInput(Date.parse(start) + weeks * 7 * 86400000);
  const issues = P().tickets.filter((x) => x.sprintId === s.id && !isSub(x));
  openModal({
    title: mode === 'start' ? `Start ${s.name}` : `Edit ${s.name}`,
    body: `${mode === 'start' ? `<p style="margin-top:0"><b>${issues.length}</b> issues (${spSum(issues)} story points) will be included in this sprint.</p>` : ''}
      <label class="field"><span>Sprint name <span class="req">*</span></span><input class="input" id="spName" value="${esc(s.name)}"></label>
      <div class="grid2" style="grid-template-columns:1fr 1fr 1fr">
        <label class="field"><span>Duration</span><select class="select" id="spDur">${[1, 2, 3, 4].map((w) => `<option value="${w}" ${w === weeks ? 'selected' : ''}>${w} week${w > 1 ? 's' : ''}</option>`).join('')}<option value="custom">Custom</option></select></label>
        <label class="field"><span>Start date</span><input class="input" type="date" id="spStart" value="${esc(start)}"></label>
        <label class="field"><span>End date</span><input class="input" type="date" id="spEnd" value="${esc(end)}"></label>
      </div>
      <label class="field"><span>Sprint goal</span><textarea class="textarea" id="spGoal" placeholder="What should this sprint achieve?">${esc(s.goal || '')}</textarea></label>`,
    actions: [{ label: 'Cancel', action: 'modal-close' }, { label: mode === 'start' ? 'Start' : 'Update', primary: true, onClick: () => {
      const name = $('#spName').value.trim();
      if (!name) return $('#spName').focus();
      const startDate = $('#spStart').value, endDate = $('#spEnd').value;
      if (startDate && endDate && endDate < startDate) return toast('The end date must be after the start date.', 'err');
      if (mode === 'start' && activeSprint() && activeSprint().id !== s.id) return toast('Complete the active sprint first.', 'err');
      mutate(() => {
        Object.assign(s, { name, startDate, endDate, goal: $('#spGoal').value.trim() });
        if (mode === 'start') {
          s.state = 'active';
          s.committedPoints = spSum(issues);
          issues.forEach((x) => logEvent(x, `included in ${name}`));
        }
      });
      closeModal();
      if (mode === 'start') { toast(`${name} started`); go(`#/p/${P().id}/board`); }
    } }],
    onOpen: (m) => {
      const sync = () => { const d = $('#spDur', m).value; if (d !== 'custom' && $('#spStart', m).value) $('#spEnd', m).value = dateInput(Date.parse($('#spStart', m).value) + Number(d) * 7 * 86400000); };
      $('#spDur', m).addEventListener('change', sync);
      $('#spStart', m).addEventListener('change', sync);
      $('#spEnd', m).addEventListener('change', () => { $('#spDur', m).value = 'custom'; });
    },
  });
}

function completeSprintModal(s) {
  const issues = P().tickets.filter((x) => x.sprintId === s.id && !isSub(x));
  const done = issues.filter(isDone), open = issues.filter((x) => !isDone(x));
  const future = P().sprints.filter((x) => x.state === 'future');
  openModal({
    title: `Complete ${s.name}`,
    body: `<p style="margin-top:0">This sprint has <b>${done.length}</b> completed issue${done.length === 1 ? '' : 's'} (${spSum(done)} points) and <b>${open.length}</b> open issue${open.length === 1 ? '' : 's'}.</p>
      ${open.length ? `<label class="field"><span>Move open issues to</span><select class="select" id="cpTo"><option value="">Backlog</option>${future.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}<option value="__new">New sprint</option></select></label>` : '<p class="muted">All issues are done. Nice work.</p>'}`,
    actions: [{ label: 'Cancel', action: 'modal-close' }, { label: 'Complete sprint', primary: true, onClick: () => {
      let to = $('#cpTo')?.value || null;
      mutate((p) => {
        if (to === '__new') { const ns = { id: uid(), name: `${p.key} Sprint ${p.sprints.length + 1}`, goal: '', state: 'future', startDate: '', endDate: '' }; p.sprints.push(ns); to = ns.id; }
        Object.assign(s, { state: 'closed', completedAt: nowIso(), completedPoints: spSum(done) });
        open.forEach((x) => setField(x, 'sprintId', to));
      });
      closeModal(); toast(`${s.name} completed · ${spSum(done)} points done`);
      go(`#/p/${P().id}/reports`);
    } }],
  });
}

// ---------------------------------------------------------------- create issue modal
function openCreateIssue({ epicId } = {}) {
  const p = P();
  const cur = epicId || openEpic()?.id || (S.filter.epic && S.filter.epic !== 'none' ? S.filter.epic : '') || openIssue()?.epicId || '';
  openModal({
    title: 'Create issue',
    body: `<p class="muted small" style="margin-top:0">Required fields are marked with an asterisk <span style="color:var(--danger)">*</span></p>
      <div class="grid2">
        <label class="field"><span>Project</span><input class="input" value="${esc(p.name)} (${esc(p.key)})" disabled></label>
        <label class="field"><span>Issue type <span class="req">*</span></span><select class="select" id="cType">${opts([...TYPES, 'Epic'], 'Story')}</select></label>
      </div>
      <label class="field"><span>Summary <span class="req">*</span></span><input class="input" id="cSum" autocomplete="off"></label>
      <label class="field"><span>Description</span><textarea class="textarea" id="cDesc" placeholder="Describe the work. Claude can turn this into a full issue with acceptance criteria and test cases."></textarea></label>
      <div class="grid2 not-epic">
        <label class="field"><span>Epic</span><select class="select" id="cEpic"><option value="">None</option>${p.epics.map((e) => `<option value="${esc(e.id)}" ${e.id === cur ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}</select></label>
        <label class="field"><span>Sprint</span><select class="select" id="cSprint"><option value="">Backlog</option>${openSprints().map((s) => `<option value="${esc(s.id)}">${esc(s.name)}${s.state === 'active' ? ' (active)' : ''}</option>`).join('')}</select></label>
        <label class="field"><span>Priority</span><select class="select" id="cPrio">${opts(PRIORITIES, 'Medium')}</select></label>
        <label class="field"><span>Story points</span><input class="input" id="cSp" type="number" min="0"></label>
        <label class="field"><span>Assignee</span><input class="input" id="cAs" list="cMembers" placeholder="Unassigned"><datalist id="cMembers">${p.members.map((m) => `<option value="${esc(m.name)}">`).join('')}</datalist></label>
        <label class="field"><span>Reporter</span><input class="input" value="${esc(me())}" disabled></label>
      </div>`,
    left: '<label class="check small"><input type="checkbox" class="cb" id="cAnother"> Create another</label>',
    actions: [
      { label: 'Cancel', action: 'modal-close' },
      { label: '✨ Write with Claude', ai: true, id: 'cAi', onClick: () => {
        const idea = [$('#cSum').value.trim(), $('#cDesc').value.trim()].filter(Boolean).join('\n');
        if (!idea) { $('#cSum').focus(); return toast('Write a summary or description for Claude to work from.', 'err'); }
        const type = $('#cType').value, fields = { epicId: $('#cEpic').value || null, sprintId: $('#cSprint').value || null, assignee: $('#cAs').value.trim() };
        closeModal();
        writeWithClaude({ idea, fields, type: type === 'Story' ? null : type });
      } },
      { label: 'Create', primary: true, onClick: () => {
        const sum = $('#cSum').value.trim();
        if (!sum) return $('#cSum').focus();
        const type = $('#cType').value;
        let created;
        if (type === 'Epic') {
          created = { id: uid(), key: nextEpicKey(), title: sum, description: $('#cDesc').value.trim(), color: COLORS[P().epics.length % COLORS.length] };
          mutate((pp) => pp.epics.push(created), { render: 'none' });
        } else {
          const spv = $('#cSp').value;
          const assignee = $('#cAs').value.trim();
          created = newTicket({ title: sum, type, description: $('#cDesc').value.trim(), epicId: $('#cEpic').value || null, sprintId: $('#cSprint').value || null, priority: $('#cPrio').value, storyPoints: spv === '' ? null : Number(spv), assignee });
          mutate((pp) => { pp.tickets.push(created); addMember(assignee); }, { render: 'none' });
        }
        toast(`Created ${created.key}`);
        if ($('#cAnother').checked) { $('#cSum').value = ''; $('#cDesc').value = ''; $('#cSum').focus(); renderSidebar(); renderView(); return; }
        closeModal();
        openDrawer(type === 'Epic' ? 'epic' : 'issue', created.id); renderSidebar();
      } },
    ],
    onOpen: (m) => {
      const sync = () => { const isEpic = $('#cType', m).value === 'Epic'; $('.not-epic', m).hidden = isEpic; $('#cAi', m).hidden = isEpic; };
      $('#cType', m).addEventListener('change', sync);
      $('#cSum', m).addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); $$('[data-mi]', m).pop().click(); } });
      sync(); $('#cSum', m).focus();
    },
  });
}

async function writeWithClaude({ idea, fields = {}, type }) {
  const res = await withBusy('Claude is writing the issue…', () => api('/api/ai/new-ticket', { method: 'POST', body: aiBody({ epicId: fields.epicId, idea, project: P() }) }));
  if (!res) return;
  const nt = applyAi(newTicket({ ...fields }), res.ticket);
  if (type) nt.type = type;
  mutate((p) => { p.tickets.push(nt); addMember(fields.assignee); }, { render: 'none' });
  openDrawer('issue', nt.id); renderSidebar();
  toast(`Claude created ${nt.key}`);
}

function openNewWithClaude(epicId) {
  const p = P();
  const cur = epicId || openEpic()?.id || p.epics[0]?.id || '';
  openModal({
    title: 'Write an issue with Claude',
    body: `<label class="field"><span>Epic</span><select class="select" id="ntEpic"><option value="">None</option>${p.epics.map((e) => `<option value="${esc(e.id)}" ${e.id === cur ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}</select></label>
      <label class="field"><span>What should the issue cover?</span><textarea class="textarea" id="ntIdea" style="min-height:100px" placeholder="e.g. Customers can export their order history as a PDF"></textarea></label>
      <p class="muted small">Claude writes the summary, user story, description, acceptance criteria and test cases.</p>`,
    actions: [{ label: 'Cancel', action: 'modal-close' }, { label: '✨ Write issue', primary: true, onClick: () => {
      const idea = $('#ntIdea').value.trim();
      if (!idea) return $('#ntIdea').focus();
      const ep = $('#ntEpic').value || null;
      closeModal();
      writeWithClaude({ idea, fields: { epicId: ep } });
    } }],
    onOpen: () => $('#ntIdea').focus(),
  });
}

// ---------------------------------------------------------------- export
async function exportAs(fmt) {
  await saveNow();
  try {
    const res = await api(`/api/export/${fmt}`, { method: 'POST', body: P(), raw: true });
    const blob = await res.blob();
    const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || `export.${fmt}`;
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`Downloaded ${name}`);
  } catch (e) { toast(`Export failed: ${e.message}`, 'err'); }
}

// ---------------------------------------------------------------- Claude issue actions
const AI_LABEL = { enhance: 'Claude is enhancing the issue…', ac: 'Claude is improving acceptance criteria…', tests: 'Claude is writing test cases…', split: 'Claude is splitting the issue…', custom: 'Claude is applying your instruction…' };
const AI_DONE = { enhance: 'enhanced the issue with Claude', ac: 'improved acceptance criteria with Claude', tests: 'regenerated test cases with Claude', custom: 'updated the issue with Claude' };

async function runTicketAi(op, instruction) {
  const t = openIssue();
  if (!t) return;
  const res = await withBusy(AI_LABEL[op], () => api('/api/ai/ticket', { method: 'POST', body: aiBody({ action: op, ticket: { ...t, history: [], comments: [] }, project: P(), instruction }) }));
  if (!res) return;
  if (op === 'split') return reviewSplit(t, res.tickets);
  reviewTicket(t, applyAi(t, res.ticket), op);
}

function ticketSummaryHtml(t, other) {
  const oldAc = new Set(other?.acceptanceCriteria || []);
  return `<div class="row" style="gap:6px;margin-bottom:6px">${typeIcon(t.type)}${priorityIcon(t.priority)}<span class="sp">${t.storyPoints ?? '–'}</span>${t.labels?.map((l) => `<span class="label-chip">${esc(l)}</span>`).join('') || ''}</div>
    <p style="margin:0 0 8px;font-weight:600">${esc(t.title)}</p>
    ${t.userStory ? `<p style="margin:0 0 8px;font-style:italic;color:var(--text-subtle)">${esc(t.userStory)}</p>` : ''}
    <h5>Acceptance criteria (${t.acceptanceCriteria.length})</h5>
    <ol class="small">${t.acceptanceCriteria.map((a) => `<li class="${other && !oldAc.has(a) ? 'new' : ''}">${esc(a)}</li>`).join('')}</ol>
    <h5>Test cases (${(t.testCases || []).length})</h5>
    <ol class="small">${(t.testCases || []).map((tc) => `<li>${esc(tc.title)}</li>`).join('')}</ol>`;
}

function reviewTicket(before, after, op) {
  openModal({
    title: 'Review Claude’s suggestion', wide: true,
    body: `<div class="cmp"><div><h5>Current</h5>${ticketSummaryHtml(before)}</div><div><h5>Suggested</h5>${ticketSummaryHtml(after, before)}</div></div>
      <p class="small muted" style="margin:12px 0 0">Highlighted criteria are new or reworded. You can keep editing after accepting, and ⌘Z undoes it.</p>`,
    actions: [{ label: 'Discard', action: 'modal-close' }, { label: 'Accept changes', primary: true, onClick: () => {
      mutate((p) => { const i = p.tickets.findIndex((x) => x.id === before.id); p.tickets[i] = after; logEvent(after, AI_DONE[op] || 'updated the issue with Claude'); });
      closeModal(); toast('Changes applied');
    } }],
  });
}

function reviewSplit(orig, parts) {
  if (!parts?.length) return toast('Claude did not return any issues.', 'err');
  openModal({
    title: `Split ${orig.key} into ${parts.length} issues`, wide: true,
    body: parts.map((t) => `<div class="card" style="margin-bottom:12px;padding:14px">${ticketSummaryHtml(t)}</div>`).join(''),
    actions: [{ label: 'Discard', action: 'modal-close' }, { label: 'Replace with these issues', primary: true, onClick: () => {
      mutate((p) => {
        const i = p.tickets.findIndex((x) => x.id === orig.id);
        const first = applyAi(orig, parts[0]);
        logEvent(first, `split into ${parts.length} issues with Claude`);
        p.tickets.splice(i, 1, first);
        parts.slice(1).forEach((pt, k) => {
          const r = applyAi(newTicket({ epicId: orig.epicId, sprintId: orig.sprintId, assignee: orig.assignee }), pt);
          p.tickets.splice(i + 1 + k, 0, r);
          addLink(first, 'relates to', r);
        });
      });
      closeModal(); toast(`Split into ${parts.length} issues`);
    } }],
  });
}

const ASK_SUGGESTIONS = ['Add security and permission criteria', 'Add accessibility (WCAG) criteria', 'Add performance criteria', 'Make it more technical for developers', 'Rewrite in plain language for stakeholders', 'Add API contract details', 'Re-estimate the story points'];
function openAsk() {
  openModal({
    title: 'Ask Claude to change this issue',
    body: `<label class="field"><span>Instruction</span><textarea class="textarea" id="askText" style="min-height:96px" placeholder="e.g. Add criteria for offline mode and a test case for slow networks"></textarea></label>
      <div class="row">${ASK_SUGGESTIONS.map((s) => `<button class="btn sm" data-fill="${esc(s)}">${esc(s)}</button>`).join('')}</div>`,
    actions: [{ label: 'Cancel', action: 'modal-close' }, { label: '✨ Apply', primary: true, onClick: () => {
      const v = $('#askText').value.trim();
      if (!v) return $('#askText').focus();
      closeModal(); runTicketAi('custom', v);
    } }],
    onOpen: (m) => { m.addEventListener('click', (ev) => { const f = ev.target.closest('[data-fill]'); if (f) { $('#askText').value = f.dataset.fill; $('#askText').focus(); } }); $('#askText').focus(); },
  });
}

function openRegroup() {
  openModal({
    title: 'Re-organize issues into epics',
    body: `<p style="margin-top:0">Claude proposes a new set of epics and assigns every issue to one. You review the result before anything changes.</p>
      <label class="field"><span>Guidance (optional)</span><textarea class="textarea" id="rgText" placeholder="e.g. Group by user journey: onboarding, browsing, checkout, admin"></textarea></label>`,
    actions: [{ label: 'Cancel', action: 'modal-close' }, { label: '✨ Propose epics', primary: true, onClick: async () => {
      const instruction = $('#rgText').value.trim();
      closeModal();
      const proj = { ...P(), tickets: P().tickets.filter((x) => !isSub(x)) };
      const res = await withBusy('Claude is re-organizing epics…', () => api('/api/ai/regroup', { method: 'POST', body: aiBody({ project: proj, instruction }) }));
      if (res) reviewRegroup(res.epics);
    } }],
  });
}

function reviewRegroup(proposed) {
  openModal({
    title: `Proposed epics (${proposed.length})`, wide: true,
    body: proposed.map((e) => `<div style="margin-bottom:16px"><div class="row" style="gap:6px">${typeIcon('Epic')}<b>${esc(e.title)}</b><span class="muted small">${e.ticketIds.length} issues</span></div><div class="small muted" style="margin:2px 0 6px 22px">${esc(e.description)}</div>
      <div class="rows" style="margin-left:22px">${e.ticketIds.map((id) => ticket(id)).filter(Boolean).map((t) => `<div class="irow" style="cursor:default;min-height:32px">${typeIcon(t.type)}<span class="key">${esc(t.key)}</span><span class="sum">${esc(t.title)}</span></div>`).join('')}</div></div>`).join(''),
    actions: [{ label: 'Discard', action: 'modal-close' }, { label: 'Apply new epics', primary: true, onClick: () => {
      mutate((pp) => {
        const byTitle = new Map(pp.epics.map((e) => [e.title.toLowerCase(), e]));
        const next = proposed.map((pe, i) => {
          const old = byTitle.get(pe.title.toLowerCase());
          return { id: old?.id || uid(), key: `${pp.key}-E${i + 1}`, title: pe.title, description: pe.description || old?.description || '', color: old?.color || COLORS[i % COLORS.length], ticketIds: pe.ticketIds };
        });
        pp.epics = next.map(({ ticketIds, ...e }) => e);
        for (const e of next) for (const id of e.ticketIds) { const t = pp.tickets.find((x) => x.id === id); if (t) setField(t, 'epicId', e.id); }
        pp.tickets.sort((a, b) => pp.epics.findIndex((e) => e.id === a.epicId) - pp.epics.findIndex((e) => e.id === b.epicId));
      }, { render: 'none' });
      S.drawer = null; closeModal(); renderAll(); toast('Epics re-organized — ⌘Z to undo');
    } }],
  });
}

async function bulkTests() {
  const ids = [...S.checked].filter((id) => ticket(id));
  if (!ids.length) return;
  let done = 0;
  await withBusy(`Claude is writing test cases for ${ids.length} issues…`, async () => {
    for (const id of ids) {
      const t = ticket(id);
      S.busy = `Writing test cases ${done + 1} of ${ids.length}: ${t.key}`; renderBusy();
      try {
        const res = await api('/api/ai/ticket', { method: 'POST', body: aiBody({ action: 'tests', ticket: { ...t, history: [], comments: [] }, project: P() }) });
        mutate(() => { const x = ticket(id); x.testCases = withIds(res.ticket.testCases.map(({ id: _i, ...tc }) => tc)); logEvent(x, 'regenerated test cases with Claude'); }, { render: 'view' });
      } catch (e) { toast(`${t.key}: ${e.message}`, 'err'); }
      done += 1;
    }
  });
  if (openIssue()) renderDrawer();
  toast(`Test cases written for ${done} issues`);
}

// ---------------------------------------------------------------- test automation
function askBaseUrl() {
  return new Promise((resolve) => {
    openModal({
      title: 'Where should the tests run?',
      body: `<p style="margin-top:0">Enter the URL of the application under test. Claude writes Playwright scripts against it and they run in a headless browser on this machine.</p>
        <label class="field"><span>Application URL <span class="req">*</span></span><input class="input" id="buUrl" placeholder="http://localhost:3000" value="${esc(P().automation.baseUrl || '')}"></label>`,
      actions: [{ label: 'Cancel', onClick: () => { closeModal(); resolve(null); } }, { label: 'Save and run', primary: true, onClick: () => {
        const v = $('#buUrl').value.trim();
        if (!/^https?:\/\/\S+$/i.test(v)) return toast('Enter a full URL starting with http:// or https://', 'err');
        mutate((p) => { p.automation.baseUrl = v; }, { render: 'none' });
        closeModal(); resolve(v);
      } }],
      onOpen: () => $('#buUrl').focus(),
    });
  });
}

function rerenderRun() {
  renderRunPill();
  if (!P()) return;
  if (['automation', 'tests'].includes(S.view)) renderView();
  if (openIssue() && S.autoRun?.ids?.has(openIssue().id)) renderDrawer();
}

async function runTests(list, { regenerate = false } = {}) {
  if (!list.length) return toast('No test cases to run.', 'err');
  if (S.autoRun?.running) return toast('Tests are already running.', 'err');
  if (!S.engine?.browser) { await loadEngine(); if (!S.engine?.browser) { toast('Install the test browser first (Test automation page).', 'err'); return go(`#/p/${P().id}/automation`); } }
  const baseUrl = P().automation.baseUrl || await askBaseUrl();
  if (!baseUrl) return;
  const ctrl = new AbortController();
  const run = { running: true, ctrl, total: list.length, done: 0, pass: 0, fail: 0, current: null, ids: new Set(list.map((x) => x.t.id)), log: [{ message: `Running ${list.length} test${list.length > 1 ? 's' : ''} against ${baseUrl}` }] };
  S.autoRun = run;
  const push = (message, level) => { run.log.forEach((l) => { if (!l.level) l.level = 'info'; }); run.log.push({ message, level }); };
  rerenderRun();
  try {
    const res = await api('/api/automation/run', {
      method: 'POST', raw: true, signal: ctrl.signal,
      body: {
        baseUrl, regenerate, provider: S.settings.provider || undefined, model: S.settings.model || undefined,
        project: { name: P().name, summary: P().summary },
        items: list.map(({ t, tc }) => ({
          ticket: { id: t.id, key: t.key, title: t.title, userStory: t.userStory, acceptanceCriteria: t.acceptanceCriteria },
          tc: { id: tc.id, title: tc.title, steps: tc.steps, expected: tc.expected, preconditions: tc.preconditions, script: regenerate ? '' : tc.script },
        })),
      },
    });
    await readNdjson(res, (ev) => {
      const { t, tc } = ev.ticketId ? findTc(ev.ticketId, ev.tcId) : {};
      const label = t && tc ? `${tcKey(t, t.testCases.indexOf(tc))} ${tc.title}` : '';
      if (ev.type === 'phase') push(ev.message, ev.level);
      else if (ev.type === 'error') push(ev.message, 'err');
      else if (ev.type === 'script' && tc) mutate(() => { tc.script = ev.code; }, { render: 'none' });
      else if (ev.type === 'start') { run.current = ev.tcId; push(`Running ${label}`); }
      else if (ev.type === 'result' && tc) {
        run.done += 1; run.current = null;
        if (ev.result.status === 'Pass') run.pass += 1; else run.fail += 1;
        const msg = { message: `${label} — ${ev.result.status}${ev.result.durationMs ? ` (${(ev.result.durationMs / 1000).toFixed(1)}s)` : ''}`, level: ev.result.status === 'Pass' ? 'pass' : 'fail' };
        if (run.log[run.log.length - 1]?.message.startsWith('Running ')) run.log[run.log.length - 1] = msg; else run.log.push(msg);
        mutate(() => { tc.lastRun = ev.result; tc.status = ev.result.status; logEvent(t, `automated test ${tcKey(t, t.testCases.indexOf(tc))}: ${ev.result.status}`, 'Automation'); }, { render: 'none' });
      }
      rerenderRun();
    });
  } catch (e) {
    push(e.name === 'AbortError' ? 'Run stopped' : e.message, e.name === 'AbortError' ? 'warn' : 'err');
  } finally {
    run.running = false; run.current = null;
    rerenderRun();
    toast(`Test run finished · ${run.pass} passed · ${run.fail} failed`, run.fail ? 'err' : 'ok');
  }
}

async function installBrowser() {
  await withBusy('Installing Chromium for test automation…', async () => {
    const res = await api('/api/automation/install', { method: 'POST', raw: true });
    await readNdjson(res, (ev) => {
      if (ev.type === 'log') { S.busy = `Installing Chromium… ${ev.line.slice(0, 60)}`; renderBusy(); }
      if (ev.type === 'error') throw new Error(ev.message);
    });
  });
  await loadEngine();
  if (S.engine?.browser) toast('Chromium installed — ready to run tests');
}

function scriptModal(tid, tcid) {
  const { t, tc } = findTc(tid, tcid);
  if (!tc) return;
  const i = t.testCases.indexOf(tc);
  openModal({
    title: `${tcKey(t, i)} automation script`, wide: true,
    body: `<p class="muted small" style="margin-top:0">Body of <code>async ({ page, expect, baseURL }) =&gt; { … }</code> — runs with Playwright against ${esc(P().automation.baseUrl || 'your app')}.</p>
      <textarea class="textarea code" id="scriptText" spellcheck="false" style="min-height:280px">${esc(tc.script || '')}</textarea>
      ${tc.lastRun?.error ? `<h5 style="margin:12px 0 4px">Last error</h5><pre class="err-box">${esc(tc.lastRun.error)}</pre>` : ''}`,
    actions: [{ label: 'Cancel', action: 'modal-close' },
      { label: '✨ Rewrite and run', ai: true, onClick: () => { closeModal(); runTests([{ t, tc }], { regenerate: true }); } },
      { label: 'Save and run', onClick: () => { const v = $('#scriptText').value; mutate(() => { tc.script = v; }, { render: 'none' }); closeModal(); runTests([{ t, tc }]); } },
      { label: 'Save', primary: true, onClick: () => { const v = $('#scriptText').value; mutate(() => { tc.script = v; }); closeModal(); toast('Script saved'); } }],
  });
}

// ---------------------------------------------------------------- connection settings
function openSettings() {
  const st = S.status || {};
  const cur = S.settings.provider || '';
  const models = ['opus', 'sonnet', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
  openModal({
    title: 'Claude connection',
    body: `
      <div class="field"><span>Status</span>
        <div class="row small" style="flex-wrap:nowrap;align-items:flex-start"><span class="dot ${st.cli?.available ? 'ok' : 'bad'}" style="margin-top:4px"></span><span>Claude account (Claude Code): ${st.cli?.available ? `${esc(st.cli.version)}${st.cli.outdated ? ' — <b>outdated, run <code>claude update</code></b>' : ''}<br><span class="muted" style="word-break:break-all">${esc(st.cli.path || '')}</span>` : 'not found — install Claude Code and run <code>claude</code> to sign in'}</span></div>
        <div class="row small"><span class="dot ${st.api ? 'ok' : 'bad'}"></span>Anthropic API key: ${st.api ? 'detected' : 'not set'}</div>
      </div>
      <label class="field"><span>Use</span><select class="select" id="stProvider">
        <option value="" ${!cur ? 'selected' : ''}>Automatic (${esc(st.defaultProvider === 'api' ? 'API key' : 'Claude account')})</option>
        <option value="cli" ${cur === 'cli' ? 'selected' : ''}>My Claude account (Claude Code)</option>
        <option value="api" ${cur === 'api' ? 'selected' : ''}>Anthropic API key</option></select></label>
      <label class="field"><span>Model — leave blank for the default</span><input class="input" id="stModel" list="modelList" value="${esc(S.settings.model)}" placeholder="${esc((cur || st.defaultProvider) === 'api' ? st.defaultModels?.api : st.defaultModels?.cli)}">
        <datalist id="modelList">${models.map((m) => `<option value="${m}">`).join('')}</datalist></label>
      <p class="small muted">With your Claude account, aliases like <code>opus</code> or <code>sonnet</code> use the newest model your Claude Code version knows.</p>`,
    actions: [{ label: 'Cancel', action: 'modal-close' }, { label: 'Save', primary: true, onClick: () => {
      S.settings = { provider: $('#stProvider').value, model: $('#stModel').value.trim() };
      store.set('tf.settings', S.settings);
      closeModal(); renderTop(); if (S.route.name === 'new') renderCreate();
    } }],
  });
}

// ---------------------------------------------------------------- modal
function openModal({ title, body, actions = [], onOpen, wide, left = '' }) {
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
function closeModal() { $('#modalRoot').innerHTML = ''; }
function confirmModal(title, html, label, onYes) {
  openModal({ title, body: `<p style="margin-top:0">${html}</p>`, actions: [{ label: 'Cancel', action: 'modal-close' }, { label, danger: true, onClick: async () => { closeModal(); await onYes(); } }] });
}

// ---------------------------------------------------------------- boot
hooks.ensure = ensureProject;
hooks.refresh = () => renderAll();
hooks.afterLogin = async () => {
  S.auth = await api('/api/auth/me').catch(() => S.auth);
  try { S.status = await api('/api/status'); } catch { S.status = null; }
  loadEngine();
  if (['login', 'invite', 'reset', 'forgot'].includes(parseRoute().name)) location.hash = '#/';
  await route();
};
const _renderView = renderView, _renderDrawer = renderDrawer, _renderTop = renderTop;
hooks.renderView = () => { _renderView(); applyPerms($('#view') || document); };
hooks.renderDrawer = () => { _renderDrawer(); applyPerms($('#drawer') || document); };
new MutationObserver(() => applyPerms($('#app'))).observe($('#app'), { childList: true, subtree: true });
new MutationObserver(() => applyPerms($('#topnav'))).observe($('#topnav'), { childList: true });
void _renderTop;

(async function boot() {
  S.auth = await api('/api/auth/me').catch(() => ({ user: null }));
  S.user = S.auth.user;
  if (S.user) { try { S.status = await api('/api/status'); } catch { S.status = null; } loadEngine(); }
  await route();
  startSync();
  window.addEventListener('beforeunload', () => { if (P() && S.saveTimer) saveNow(); });
})();

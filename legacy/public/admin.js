// Administration: users, invites, roles & permissions, email.
import { I } from './icons.js';
import { $, $$, esc, S, api, toast, avatar, ago, openModal, closeModal, confirmModal, copyText, can } from './core.js';

const TABS = [['users', 'Users', I.people], ['invites', 'Invites', I.comment], ['roles', 'Roles & permissions', I.settings], ['email', 'Email & database', I.doc]];
const A = { tab: 'users', users: [], roles: [], invites: [], projects: [], email: null, q: '' };

const accessText = (a) => (a === 'all' ? 'All projects' : `${(a || []).length} project${(a || []).length === 1 ? '' : 's'}`);
const accessTitle = (a) => (a === 'all' ? 'Every current and future project' : (a || []).map((id) => A.projects.find((p) => p.id === id)?.name || id).join(', ') || 'No projects');
function inviteState(i) {
  if (i.accepted_at) return ['Accepted', 's-done'];
  if (i.revoked_at) return ['Revoked', 's-todo'];
  if (new Date(i.expires_at) < new Date()) return ['Expired', 's-todo'];
  return ['Pending', 's-inprogress'];
}

async function load() {
  const [users, roles, invites, projects, email] = await Promise.all([
    api('/api/admin/users'), api('/api/admin/roles'), api('/api/admin/invites'), api('/api/admin/projects'), api('/api/admin/email'),
  ]);
  Object.assign(A, { users, roles, invites, projects, email });
}

export async function renderAdmin(tab = 'users') {
  A.tab = TABS.some(([t]) => t === tab) ? tab : 'users';
  const app = $('#app');
  if (!$('#adminPage')) app.innerHTML = '<div class="page" id="adminPage"><div class="page-inner"><p class="muted">Loading…</p></div></div>';
  try { await load(); } catch (e) { toast(e.message, 'err'); return; }
  draw();
}

function draw() {
  const page = $('#adminPage');
  if (!page) return;
  const body = { users: usersTab, invites: invitesTab, roles: rolesTab, email: emailTab }[A.tab]();
  const focusId = document.activeElement?.id;
  page.innerHTML = `<div class="page-inner">
    <div class="crumbs"><a href="#/">Projects</a><span>/</span><span>Administration</span></div>
    <div class="page-h"><h1>Administration</h1><div class="spacer"></div>
      <button class="btn primary" data-action="adm-invite">${I.plus}Invite people</button></div>
    <div class="tabbar">${TABS.map(([t, l, ic]) => `<a class="tab ${A.tab === t ? 'active' : ''}" href="#/admin/${t}">${ic}${l}${t === 'invites' ? ` <span class="count">${A.invites.filter((i) => inviteState(i)[0] === 'Pending').length}</span>` : t === 'users' ? ` <span class="count">${A.users.length}</span>` : ''}</a>`).join('')}</div>
    ${body}</div>`;
  if (focusId) { const f = document.getElementById(focusId); if (f) { f.focus(); try { f.setSelectionRange(f.value.length, f.value.length); } catch { /* */ } } }
}

// ---------------------------------------------------------------- users
function usersTab() {
  const qq = A.q.toLowerCase();
  const list = A.users.filter((u) => !qq || `${u.name} ${u.email} ${u.roleName}`.toLowerCase().includes(qq));
  return `<div class="toolbar"><div class="search"><span>${I.search}</span><input id="admQ" placeholder="Search users" value="${esc(A.q)}"></div><div class="spacer"></div><span class="muted small">${A.users.filter((u) => u.status === 'active').length} active · ${A.users.length} total</span></div>
    <table class="tbl"><thead><tr><th>User</th><th>Role</th><th>Project access</th><th>Status</th><th>Last signed in</th><th></th></tr></thead><tbody>
    ${list.map((u) => `<tr>
      <td><div class="row" style="flex-wrap:nowrap">${avatar(u.name, 32)}<div><b style="font-weight:500">${esc(u.name)}</b>${u.isOwner ? ' <span class="loz s-inprogress">Owner</span>' : ''}${u.id === S.user.id ? ' <span class="muted small">(you)</span>' : ''}<div class="muted small">${esc(u.email)}</div></div></div></td>
      <td><select class="select compact" data-adm-role="${esc(u.id)}" ${u.isOwner ? 'disabled title="The owner is always an Administrator"' : ''} aria-label="Role">${A.roles.map((r) => `<option value="${esc(r.id)}" ${r.id === u.roleId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></td>
      <td><button class="btn sm" data-action="adm-access" data-id="${esc(u.id)}" ${u.isOwner ? 'disabled' : ''} title="${esc(accessTitle(u.projectAccess))}">${I.folder}${accessText(u.projectAccess)}</button></td>
      <td><span class="loz ${u.status === 'active' ? 's-done' : 's-todo'}">${u.status === 'active' ? 'Active' : 'Disabled'}</span></td>
      <td class="muted">${u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn sm subtle" data-action="adm-reset" data-id="${esc(u.id)}" title="Send a password reset link">Reset password</button>
        ${u.isOwner || u.id === S.user.id ? '' : `<button class="btn sm subtle" data-action="adm-toggle" data-id="${esc(u.id)}">${u.status === 'active' ? 'Disable' : 'Enable'}</button>
        <button class="icon-btn" data-action="adm-del-user" data-id="${esc(u.id)}" title="Remove user">${I.trash}</button>`}</td></tr>`).join('')}
    </tbody></table>`;
}

// ---------------------------------------------------------------- invites
function invitesTab() {
  return `${A.email?.configured ? '' : `<div class="warn-banner">${I.warn}<span>Email isn’t configured, so invites give you a link to share yourself. Set up SMTP on the <a href="#/admin/email">Email</a> tab to send them automatically.</span></div>`}
    ${A.invites.length ? `<table class="tbl"><thead><tr><th>Email</th><th>Role</th><th>Projects</th><th>Invited by</th><th>Sent</th><th>Status</th><th>Delivery</th><th></th></tr></thead><tbody>
    ${A.invites.map((i) => { const [st, cls] = inviteState(i); return `<tr>
      <td>${esc(i.email)}</td><td>${esc(i.role_name)}</td><td title="${esc(accessTitle(i.project_access))}">${accessText(i.project_access)}</td>
      <td class="muted">${esc(i.invited_by_name || '—')}</td><td class="muted">${ago(i.created_at)}</td>
      <td><span class="loz ${cls}">${st}</span>${st === 'Pending' ? `<div class="muted small">expires ${new Date(i.expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</div>` : ''}</td>
      <td class="muted small">${i.emailed ? `${I.check} Emailed` : 'Link only'}</td>
      <td style="text-align:right;white-space:nowrap">${st === 'Accepted' ? '' : `<button class="btn sm subtle" data-action="adm-resend" data-id="${esc(i.id)}" title="Create a new link${A.email?.configured ? ' and email it' : ''}">${A.email?.configured ? 'Resend' : 'New link'}</button>`}
        ${st === 'Pending' ? `<button class="btn sm danger-subtle" data-action="adm-revoke" data-id="${esc(i.id)}">Revoke</button>` : ''}</td></tr>`; }).join('')}
    </tbody></table>` : '<div class="empty"><h3>No invites yet</h3><p>Invite teammates by email and choose their role and projects.</p><button class="btn primary" data-action="adm-invite">Invite people</button></div>'}`;
}

function accessPicker(prefix, current) {
  const all = current === 'all';
  const sel = new Set(all ? [] : current || []);
  return `<div class="field"><span>Project access</span>
    <label class="check"><input type="radio" name="${prefix}Scope" value="all" ${all ? 'checked' : ''}> All projects, including future ones</label>
    <label class="check"><input type="radio" name="${prefix}Scope" value="some" ${all ? '' : 'checked'}> Only selected projects</label>
    <div class="proj-pick" id="${prefix}Projects" ${all ? 'hidden' : ''}>
      ${A.projects.length ? A.projects.map((p) => `<label class="check"><input type="checkbox" class="cb" value="${esc(p.id)}" ${sel.has(p.id) ? 'checked' : ''}> <span class="key">${esc(p.key)}</span> ${esc(p.name)}</label>`).join('') : '<p class="muted small">No projects yet.</p>'}
    </div></div>`;
}
function bindAccessPicker(m, prefix) {
  $$(`input[name="${prefix}Scope"]`, m).forEach((r) => r.addEventListener('change', () => { $(`#${prefix}Projects`, m).hidden = r.value === 'all' && r.checked; }));
}
function readAccess(m, prefix) {
  const scope = $(`input[name="${prefix}Scope"]:checked`, m).value;
  return scope === 'all' ? 'all' : $$(`#${prefix}Projects input:checked`, m).map((c) => c.value);
}

function inviteModal() {
  const defRole = A.roles.find((r) => r.id === 'member') || A.roles[0];
  openModal({
    title: 'Invite people',
    body: `<label class="field"><span>Email addresses <span class="req">*</span></span><textarea class="textarea" id="ivEmails" placeholder="ana@company.com, ben@company.com" style="min-height:70px"></textarea>
        <span class="muted small" style="font-weight:400;text-transform:none">Separate several with commas, spaces or new lines.</span></label>
      <label class="field"><span>Role</span><select class="select" id="ivRole">${A.roles.map((r) => `<option value="${esc(r.id)}" ${r.id === defRole?.id ? 'selected' : ''}>${esc(r.name)} — ${esc(r.description)}</option>`).join('')}</select></label>
      ${accessPicker('iv', 'all')}
      <label class="field"><span>Personal message (optional)</span><textarea class="textarea" id="ivMsg" placeholder="Hi! Join us to plan the next release."></textarea></label>
      <p class="muted small">${A.email?.configured ? `Invites are emailed from ${esc(A.email.from || A.email.user)}.` : 'Email isn’t configured: you’ll get a link to send each person yourself.'} Links expire after 7 days.</p>`,
    actions: [{ label: 'Cancel', action: 'modal-close' }, { label: 'Send invites', primary: true, onClick: async () => {
      const m = $('#mBack');
      try {
        const res = await api('/api/admin/invites', { method: 'POST', body: { emails: $('#ivEmails').value, roleId: $('#ivRole').value, projectAccess: readAccess(m, 'iv'), message: $('#ivMsg').value } });
        closeModal();
        await load(); A.tab = 'invites'; location.hash = '#/admin/invites'; draw();
        inviteResults(res.results);
      } catch (e) { toast(e.message, 'err'); }
    } }],
    onOpen: (m) => { bindAccessPicker(m, 'iv'); $('#ivEmails').focus(); },
  });
}

function inviteResults(results) {
  openModal({
    title: 'Invites created', wide: true,
    body: `${results.map((r) => `<div class="inv-res">
        <div class="row" style="justify-content:space-between"><b style="font-weight:500">${esc(r.email)}</b>
          ${r.error ? `<span class="loz t-fail">${esc(r.error)}</span>` : r.emailed ? `<span class="loz s-done">${I.check} Emailed</span>` : '<span class="loz s-todo">Not emailed</span>'}</div>
        ${r.link ? `<div class="row" style="flex-wrap:nowrap;margin-top:6px"><input class="input" readonly value="${esc(r.link)}" onclick="this.select()"><button class="btn" data-copy="${esc(r.link)}">${I.copy}Copy</button></div>` : ''}
        ${r.emailError ? `<div class="muted small" style="margin-top:4px">${esc(r.emailError)}</div>` : ''}</div>`).join('')}
      <p class="muted small" style="margin-bottom:0">Each link works once and expires in 7 days. Anyone with the link can create the account, so share it only with that person.</p>`,
    actions: [{ label: 'Done', primary: true, action: 'modal-close' }],
    onOpen: (m) => m.addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (b) copyText(b.dataset.copy); }),
  });
}

function accessModal(u) {
  openModal({
    title: `Project access for ${u.name}`,
    body: `<p class="muted" style="margin-top:0">${esc(u.email)} · ${esc(u.roleName)}. Their role decides what they can do; this decides which projects they can see.</p>${accessPicker('ac', u.projectAccess)}`,
    actions: [{ label: 'Cancel', action: 'modal-close' }, { label: 'Save', primary: true, onClick: async () => {
      try {
        await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { projectAccess: readAccess($('#mBack'), 'ac') } });
        closeModal(); await load(); draw(); toast(`Updated access for ${u.name}`);
      } catch (e) { toast(e.message, 'err'); }
    } }],
    onOpen: (m) => bindAccessPicker(m, 'ac'),
  });
}

function linkModal(title, res) {
  openModal({
    title,
    body: `<p style="margin-top:0">${res.emailed ? `${I.check} Emailed. You can also share the link directly:` : `${esc(res.emailError || 'Email isn’t configured.')} Share this link with them:`}</p>
      <div class="row" style="flex-wrap:nowrap"><input class="input" readonly value="${esc(res.link)}" onclick="this.select()"><button class="btn" data-copy="${esc(res.link)}">${I.copy}Copy</button></div>`,
    actions: [{ label: 'Done', primary: true, action: 'modal-close' }],
    onOpen: (m) => m.addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (b) copyText(b.dataset.copy); }),
  });
}

// ---------------------------------------------------------------- roles
function rolesTab() {
  const groups = [...new Set(S.auth.permissions.map((p) => p.group))];
  return `<p class="muted" style="margin-top:-4px">Tick what each role can do. Changes apply immediately to everyone with that role. The Administrator role always has every permission.</p>
    <div class="toolbar"><button class="btn" data-action="adm-role-new">${I.plus}Create role</button></div>
    <div style="overflow-x:auto"><table class="tbl matrix"><thead><tr><th>Permission</th>
      ${A.roles.map((r) => `<th class="role-col"><div class="role-h"><b>${esc(r.name)}</b><span class="muted small">${r.users} user${r.users === 1 ? '' : 's'}</span>
        ${r.is_system ? '<span class="muted small">Locked</span>' : `<span><button class="icon-btn" data-action="adm-role-edit" data-id="${esc(r.id)}" title="Rename">${I.pencil}</button><button class="icon-btn" data-action="adm-role-del" data-id="${esc(r.id)}" title="Delete role">${I.trash}</button></span>`}</div></th>`).join('')}</tr></thead>
      <tbody>${groups.map((g) => `<tr class="grp"><td colspan="${A.roles.length + 1}">${esc(g)}</td></tr>
        ${S.auth.permissions.filter((p) => p.group === g).map((p) => `<tr><td><b style="font-weight:500">${esc(p.label)}</b><div class="muted small">${esc(p.desc)}</div></td>
          ${A.roles.map((r) => `<td class="role-col"><input type="checkbox" class="cb" data-adm-perm="${esc(r.id)}|${esc(p.key)}" ${r.permissions.includes(p.key) ? 'checked' : ''} ${r.is_system ? 'disabled' : ''} aria-label="${esc(r.name)}: ${esc(p.label)}"></td>`).join('')}</tr>`).join('')}`).join('')}
      </tbody></table></div>`;
}

function roleModal(role) {
  openModal({
    title: role ? `Edit ${role.name}` : 'Create role',
    body: `<label class="field"><span>Name <span class="req">*</span></span><input class="input" id="rlName" value="${esc(role?.name || '')}" placeholder="e.g. Business analyst"></label>
      <label class="field"><span>Description</span><input class="input" id="rlDesc" value="${esc(role?.description || '')}" placeholder="What this role is for"></label>
      ${role ? '' : `<label class="field"><span>Start with the permissions of</span><select class="select" id="rlCopy"><option value="">No permissions</option>${A.roles.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></label>`}`,
    actions: [{ label: 'Cancel', action: 'modal-close' }, { label: role ? 'Save' : 'Create', primary: true, onClick: async () => {
      const name = $('#rlName').value.trim();
      if (!name) return $('#rlName').focus();
      const description = $('#rlDesc').value.trim();
      try {
        if (role) await api(`/api/admin/roles/${role.id}`, { method: 'PUT', body: { name, description, permissions: role.permissions } });
        else await api('/api/admin/roles', { method: 'POST', body: { name, description, permissions: A.roles.find((r) => r.id === $('#rlCopy').value)?.permissions || [] } });
        closeModal(); await load(); draw(); toast(role ? 'Role updated' : `Created ${name}`);
      } catch (e) { toast(e.message, 'err'); }
    } }],
    onOpen: () => $('#rlName').focus(),
  });
}

function deleteRole(role) {
  const others = A.roles.filter((r) => r.id !== role.id);
  openModal({
    title: `Delete ${role.name}?`,
    body: role.users ? `<p style="margin-top:0">${role.users} user${role.users === 1 ? ' has' : 's have'} this role. Move them to:</p>
      <select class="select" id="rlTo">${others.map((r) => `<option value="${esc(r.id)}" ${r.id === 'viewer' ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>` : '<p style="margin-top:0">Nobody has this role. Pending invites with it are cancelled.</p>',
    actions: [{ label: 'Cancel', action: 'modal-close' }, { label: 'Delete role', danger: true, onClick: async () => {
      try {
        const to = $('#rlTo')?.value;
        await api(`/api/admin/roles/${role.id}${to ? `?replacement=${encodeURIComponent(to)}` : ''}`, { method: 'DELETE' });
        closeModal(); await load(); draw(); toast(`Deleted ${role.name}`);
      } catch (e) { toast(e.message, 'err'); }
    } }],
  });
}

// ---------------------------------------------------------------- email & database
function emailTab() {
  const e = A.email || {};
  const row = (k, v) => `<tr><td class="muted" style="width:200px">${k}</td><td>${v}</td></tr>`;
  return `<div class="cards">
    <div class="card"><h3>Email (SMTP)</h3><p class="sub">Used for invites and password resets.</p>
      <table class="tbl"><tbody>
        ${row('Status', e.configured ? '<span class="loz s-done">Configured</span>' : '<span class="loz s-todo">Not configured</span>')}
        ${row('Server', e.host ? `${esc(e.host)}:${e.port}${e.secure ? ' (TLS)' : ''}` : '—')}
        ${row('Username', esc(e.user || '—'))}
        ${row('From', esc(e.from || '—'))}
        ${row('Links point to', `${esc(e.appUrl)}${e.appUrlSet ? '' : ' <span class="muted small">(detected — set APP_URL for a public address)</span>'}`)}
      </tbody></table>
      <div class="row" style="margin-top:12px"><button class="btn" data-action="adm-test-email" ${e.configured ? '' : 'disabled'}>Send a test email to me</button></div></div>
    <div class="card"><h3>Database</h3><p class="sub">Where projects, users and invites are stored.</p>
      <table class="tbl"><tbody>${row('Connected to', esc(e.database || '—'))}</tbody></table>
      <p class="muted small" style="margin-bottom:0">${/Supabase|PostgreSQL/.test(e.database || '') ? 'Data is stored in your Postgres database.' : 'Using the built-in local database. Set DATABASE_URL to your Supabase connection string and run <code>npm run db:push</code> to move your data there.'}</p></div>
    <div class="card wide"><h3>Configuration</h3><p class="sub">Add these to the <code>.env</code> file next to <code>server.js</code>, then restart TicketForge. Passwords are never shown here.</p>
      <pre class="code">DATABASE_URL=postgresql://postgres.&lt;project-ref&gt;:&lt;password&gt;@aws-0-&lt;region&gt;.pooler.supabase.com:5432/postgres
APP_URL=https://tickets.yourcompany.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@yourcompany.com
SMTP_PASS=your-app-password
SMTP_FROM="TicketForge &lt;you@yourcompany.com&gt;"</pre></div>
  </div>`;
}

// ---------------------------------------------------------------- account
export function openAccount() {
  openModal({
    title: 'Your account',
    body: `<div class="row" style="flex-wrap:nowrap;margin-bottom:16px">${avatar(S.user.name, 40)}<div><b>${esc(S.user.name)}</b><div class="muted small">${esc(S.user.email)} · ${esc(S.user.roleName)}</div></div></div>
      <h4 style="margin:0 0 8px">Change password</h4>
      <label class="field"><span>Current password</span><input class="input" type="password" id="pwCur" autocomplete="current-password"></label>
      <label class="field"><span>New password (at least 8 characters)</span><input class="input" type="password" id="pwNew" autocomplete="new-password"></label>`,
    actions: [{ label: 'Close', action: 'modal-close' }, { label: 'Change password', primary: true, onClick: async () => {
      try { await api('/api/auth/password', { method: 'POST', body: { current: $('#pwCur').value, next: $('#pwNew').value } }); closeModal(); toast('Password changed'); }
      catch (e) { toast(e.message, 'err'); }
    } }],
    onOpen: () => $('#pwCur').focus(),
  });
}

// ---------------------------------------------------------------- events
const user = (id) => A.users.find((u) => u.id === id);
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action^="adm-"]');
  if (!el) return;
  if (!can('users.manage') && el.dataset.action !== 'adm-password') return;
  const id = el.dataset.id;
  try {
    switch (el.dataset.action) {
      case 'adm-invite': inviteModal(); break;
      case 'adm-access': accessModal(user(id)); break;
      case 'adm-reset': linkModal(`Password reset for ${user(id).name}`, await api(`/api/admin/users/${id}/reset`, { method: 'POST', body: {} })); break;
      case 'adm-toggle': {
        const u = user(id);
        await api(`/api/admin/users/${id}`, { method: 'PATCH', body: { status: u.status === 'active' ? 'disabled' : 'active' } });
        await load(); draw(); toast(`${u.name} ${u.status === 'active' ? 'disabled — signed out everywhere' : 'enabled'}`); break;
      }
      case 'adm-del-user': {
        const u = user(id);
        confirmModal(`Remove ${u.name}?`, `${esc(u.email)} loses access immediately. Their past comments and history stay.`, 'Remove user', async () => {
          try { await api(`/api/admin/users/${id}`, { method: 'DELETE' }); await load(); draw(); toast(`Removed ${u.name}`); } catch (err) { toast(err.message, 'err'); }
        });
        break;
      }
      case 'adm-resend': { const r = await api(`/api/admin/invites/${id}/resend`, { method: 'POST', body: {} }); await load(); draw(); linkModal(`New invite link for ${r.email}`, r); break; }
      case 'adm-revoke': await api(`/api/admin/invites/${id}`, { method: 'DELETE' }); await load(); draw(); toast('Invite revoked'); break;
      case 'adm-role-new': roleModal(null); break;
      case 'adm-role-edit': roleModal(A.roles.find((r) => r.id === id)); break;
      case 'adm-role-del': deleteRole(A.roles.find((r) => r.id === id)); break;
      case 'adm-test-email': { const r = await api('/api/admin/email/test', { method: 'POST', body: {} }); toast(`Test email sent to ${r.to}`); break; }
      default: break;
    }
  } catch (err) { toast(err.message, 'err'); }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  try {
    if (t.dataset.admRole) {
      const u = user(t.dataset.admRole);
      await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { roleId: t.value } });
      await load(); draw(); toast(`${u.name} is now ${A.roles.find((r) => r.id === t.value)?.name}`);
    } else if (t.dataset.admPerm) {
      const [rid, key] = t.dataset.admPerm.split('|');
      const role = A.roles.find((r) => r.id === rid);
      const permissions = t.checked ? [...new Set([...role.permissions, key])] : role.permissions.filter((k) => k !== key);
      await api(`/api/admin/roles/${rid}`, { method: 'PUT', body: { name: role.name, description: role.description, permissions } });
      role.permissions = permissions;
      toast(`${role.name}: ${t.checked ? 'can now' : 'can no longer'} ${S.auth.permissions.find((p) => p.key === key).label.toLowerCase()}`);
    }
  } catch (err) { toast(err.message, 'err'); await load(); draw(); }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'admQ') { A.q = e.target.value; draw(); }
});

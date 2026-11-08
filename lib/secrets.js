// Passwords for the roles in a project's App setup (Test automation). They're stored encrypted (AES-256-GCM)
// in app_meta, which row-level security limits to the server. They never go into the project data, so they're
// never sent to the browser, exported, or shown to the AI; test runs get them only while they run.
import { qs } from './db.js';
import { encrypt, decrypt } from './settings.js';

const KEY = (projectId) => `project_secrets:${projectId}`;

async function load(projectId) {
  const row = (await qs('select value from app_meta where key = $1', [KEY(projectId)])).rows[0];
  return row?.value?.roles ? row.value : { roles: {} };
}
async function store(projectId, v) {
  await qs('insert into app_meta (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [KEY(projectId), JSON.stringify(v)]);
}

/** Which roles have a saved password: { [roleId]: { hasPassword, updatedAt, updatedBy } }. No passwords. */
export async function credentialStatus(projectId) {
  const v = await load(projectId);
  return Object.fromEntries(Object.entries(v.roles).map(([id, r]) => [id, { hasPassword: Boolean(r.passEnc), updatedAt: r.updatedAt || null, updatedBy: r.updatedBy || null }]));
}

export async function setRolePassword(projectId, roleId, password, actor) {
  const v = await load(projectId);
  const pw = String(password ?? '');
  if (pw) v.roles[roleId] = { passEnc: encrypt(pw), updatedAt: new Date().toISOString(), updatedBy: actor?.name || null };
  else delete v.roles[roleId];
  await store(projectId, v);
}

export async function deleteProjectSecrets(projectId) {
  await qs('delete from app_meta where key = $1', [KEY(projectId)]);
}

/**
 * The App setup for a test run: pages, login settings and roles with their passwords decrypted.
 * For the server and the test runner only.
 */
export async function appWithSecrets(projectId, app = {}) {
  const v = projectId ? await load(projectId) : { roles: {} };
  const roles = (app.roles || []).map((r) => {
    let password = '';
    const enc = v.roles[r.id]?.passEnc;
    if (enc) { try { password = decrypt(enc); } catch { password = ''; } }
    return { id: r.id, name: String(r.name || '').trim(), description: r.description || '', username: String(r.username || '').trim(), password };
  }).filter((r) => r.name);
  const pages = (app.pages || []).map((p) => ({ id: p.id, name: String(p.name || '').trim(), path: normPath(p.path), description: p.description || '' })).filter((p) => p.name);
  return { pages, roles, login: app.login || {}, notes: app.notes || '' };
}
/** "orders" → "/orders"; full URLs keep only path, query and hash. */
export function normPath(p) {
  const s = String(p || '').trim();
  if (!s) return '/';
  if (/^https?:\/\//i.test(s)) { try { const u = new URL(s); return `${u.pathname}${u.search}${u.hash}` || '/'; } catch { return s; } }
  return s.startsWith('/') || s.startsWith('#') ? s : `/${s}`;
}

/** Other per-project secrets (e.g. a GitHub token for route scanning), stored like the role passwords. */
export async function setProjectSecret(projectId, name, value, actor) {
  const v = await load(projectId);
  v.extra = v.extra || {};
  if (value) v.extra[name] = { enc: encrypt(String(value)), updatedAt: new Date().toISOString(), updatedBy: actor?.name || null };
  else delete v.extra[name];
  await store(projectId, v);
}
export async function getProjectSecret(projectId, name) {
  const e = (await load(projectId)).extra?.[name];
  if (!e?.enc) return '';
  try { return decrypt(e.enc); } catch { return ''; }
}
export async function hasProjectSecret(projectId, name) {
  return Boolean((await load(projectId)).extra?.[name]?.enc);
}

// Passwords for the roles in a project's App setup (Test automation). They're stored encrypted (AES-256-GCM)
// in app_meta, which row-level security limits to the server. They never go into the project data, so they're
// never sent to the browser, exported, or shown to the AI; test runs get them only while they run.
import { getMeta, setMeta, deleteMeta } from './appmeta';
import { encrypt, decrypt } from './settings';

const KEY = (projectId) => `project_secrets:${projectId}`;

async function load(projectId) {
  const value = await getMeta(KEY(projectId));
  return value?.roles ? value : { roles: {} };
}
async function store(projectId, v) {
  await setMeta(KEY(projectId), v);
}

/**
 * What each role has saved, never the values: { [roleId]: { hasPassword, hasTotp, hasSession, sessionAt, sessionBy,
 * sessionExpires, updatedAt, updatedBy } }.
 */
export async function credentialStatus(projectId) {
  const v = await load(projectId);
  return Object.fromEntries(Object.entries<any>(v.roles).map(([id, r]: any) => [id, {
    hasPassword: Boolean(r.passEnc), hasTotp: Boolean(r.totpEnc), hasSession: Boolean(r.sessionEnc),
    sessionAt: r.sessionAt || null, sessionBy: r.sessionBy || null, sessionExpires: r.sessionExpires || null,
    updatedAt: r.updatedAt || null, updatedBy: r.updatedBy || null,
  }]));
}

// A role's secrets: its password, its authenticator (TOTP) secret and a saved signed-in session, each encrypted.
const FIELDS = { password: 'passEnc', totp: 'totpEnc', session: 'sessionEnc' };
/** Saves (or, with an empty value, removes) one of a role's secrets, keeping the others. */
export async function setRoleSecret(projectId, roleId, field, value, actor, extra: any = {}) {
  const k = FIELDS[field];
  if (!k) throw new Error(`Unknown secret ${field}`);
  const v = await load(projectId);
  const cur = { ...(v.roles[roleId] || {}) };
  const val = String(value ?? '');
  if (val) Object.assign(cur, { [k]: encrypt(val), updatedAt: new Date().toISOString(), updatedBy: actor?.name || null }, extra);
  else { delete cur[k]; if (field === 'session') { delete cur.sessionAt; delete cur.sessionBy; delete cur.sessionExpires; } }
  if (cur.passEnc || cur.totpEnc || cur.sessionEnc) v.roles[roleId] = cur; else delete v.roles[roleId];
  await store(projectId, v);
}
export const setRolePassword = (projectId, roleId, password, actor) => setRoleSecret(projectId, roleId, 'password', password, actor);
/** Forgets everything saved for a role (it was removed). */
export async function clearRoleSecrets(projectId, roleId) {
  const v = await load(projectId);
  delete v.roles[roleId];
  await store(projectId, v);
}

export async function deleteProjectSecrets(projectId) {
  await deleteMeta(KEY(projectId));
}

/**
 * The App setup for a test run: pages, login settings and roles with their passwords decrypted.
 * For the server and the test runner only.
 */
export async function appWithSecrets(projectId, app: any = {}) {
  const v = projectId ? await load(projectId) : { roles: {} };
  const open = (enc) => { if (!enc) return ''; try { return decrypt(enc); } catch { return ''; } };
  const roles = (app.roles || []).map((r) => {
    const sec = v.roles[r.id] || {};
    let session = null;
    if (sec.sessionEnc) { try { session = JSON.parse(open(sec.sessionEnc) || 'null'); } catch { session = null; } }
    return { id: r.id, name: String(r.name || '').trim(), description: r.description || '', username: String(r.username || '').trim(),
      signIn: ['sso', 'session'].includes(r.signIn) ? r.signIn : 'form', ssoButton: String(r.ssoButton || '').trim(),
      password: open(sec.passEnc), totp: open(sec.totpEnc), session };
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

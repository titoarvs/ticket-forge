// Users, roles, sessions, invites, password resets and email.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import nodemailer from 'nodemailer';
// The sign-in system works with sessions, invites and users before anyone is signed in: system context.
import { qs as q, txs as tx, authGen, currentWs, DEFAULT_WS } from './db.js';
import { ALL, DEFAULT_ROLES } from './permissions.js';
import { LEGAL_VERSIONS, ACCEPTED_DOCS } from './legal/versions.js';
import { signupMode } from './platform.js';
import { checkLimit, trialEndFor } from './limits.js';

const scrypt = promisify(crypto.scrypt);
export const SESSION_COOKIE = 'tf_session';
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const RESET_HOURS = 2;

export const newId = () => crypto.randomUUID();
const token = () => crypto.randomBytes(32).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const normEmail = (e) => String(e || '').trim().toLowerCase();
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// ---------------------------------------------------------------- passwords
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, n, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(key, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}
function checkPassword(pw) {
  if (String(pw || '').length < 8) throw new HttpError(400, 'Use a password of at least 8 characters.');
}

// ---------------------------------------------------------------- workspaces
// Everything about people (role, project access, owner, enabled) belongs to their membership of a workspace. The
// workspace is the request's (see db.js currentWs); functions that run before anyone is signed in take it explicitly.
function needWs(ws = currentWs()) {
  if (!ws) throw new HttpError(500, 'No workspace for this request.');
  return ws;
}
const wsName = (n) => String(n || '').trim().slice(0, 80);

/** A new workspace with the starter roles and its owner as the first member (inside a transaction `x`). */
async function insertWorkspace(x, { id, name, ownerId, trialEnds = null }) {
  await x.query('insert into workspaces (id, name, owner_id, trial_ends_at) values ($1,$2,$3,$4)', [id, wsName(name) || 'My workspace', ownerId, trialEnds]);
  await seedRolesWith(x, id);
  await x.query(`insert into workspace_members (workspace_id, user_id, role_id, project_access, is_owner) values ($1,$2,'admin','"all"',true)`, [id, ownerId]);
}
/** A signed-in person creates another workspace, which they own. */
export async function createWorkspace(user, { name }) {
  if (!wsName(name)) throw new HttpError(400, 'Give the workspace a name.');
  const n = (await q('select count(*)::int n from workspaces where owner_id = $1', [user.id])).rows[0].n;
  if (n >= 20) throw new HttpError(400, 'You already own 20 workspaces.');
  const id = `ws_${crypto.randomBytes(6).toString('hex')}`;
  const trialEnds = await trialEndFor(user.id);
  await tx((x) => insertWorkspace(x, { id, name, ownerId: user.id, trialEnds }));
  return { id, name: wsName(name) };
}
export async function listMyWorkspaces(userId) {
  // projects: how many this person can open there (all of them, or those on their access list or that they made).
  return (await q(`select w.id, w.name, w.plan, m.is_owner, r.name as role_name,
      (select count(*) from projects p where p.workspace_id = w.id
        and (m.is_owner or m.project_access = '"all"'::jsonb or m.project_access ? p.id or p.created_by = m.user_id))::int as projects
    from workspace_members m join workspaces w on w.id = m.workspace_id
    left join roles r on r.workspace_id = m.workspace_id and r.id = m.role_id
    where m.user_id = $1 and m.status = 'active' order by w.name, w.created_at`, [userId])).rows
    .map((w) => ({ id: w.id, name: w.name, plan: w.plan, isOwner: w.is_owner, role: w.role_name, projects: w.projects }));
}
export async function renameWorkspace(actor, name) {
  if (!actor.is_owner) throw new HttpError(403, 'Only the workspace owner can rename it.');
  if (!wsName(name)) throw new HttpError(400, 'Give the workspace a name.');
  await q('update workspaces set name=$2 where id=$1', [needWs(), wsName(name)]);
}

// ---------------------------------------------------------------- roles
async function seedRolesWith(x, ws) {
  for (const r of DEFAULT_ROLES) {
    await x.query('insert into roles (workspace_id, id, name, description, permissions, is_system) values ($1,$2,$3,$4,$5,$6) on conflict (workspace_id, id) do nothing',
      [ws, r.id, r.name, r.description, JSON.stringify(r.permissions), r.is_system]);
  }
  // The system admin role always has every permission (new ones included).
  await x.query('update roles set permissions = $1 where workspace_id = $2 and id = $3', [JSON.stringify(ALL), ws, 'admin']);
}
/** At start-up: the default workspace's roles, and every workspace's Administrator role gets new permissions. */
export async function seedRoles() {
  await seedRolesWith({ query: q }, DEFAULT_WS);
  await q('update roles set permissions = $1 where id = $2', [JSON.stringify(ALL), 'admin']);
  // Restoring issue versions is for admins and managers: give it once to the existing Project lead role (an admin
  // can take it away again afterwards, so this runs only one time).
  const seeded = await q("insert into app_meta (key, value) values ('perm_issue_restore', $1) on conflict (key) do nothing returning key", [JSON.stringify({ at: new Date().toISOString() })]);
  if (seeded.rows[0]) await q(`update roles set permissions = permissions || '["issue.restore"]'::jsonb where id = 'lead' and not permissions ? 'issue.restore'`);
}
export async function listRoles() {
  const ws = needWs();
  const { rows } = await q(`select r.*, (select count(*) from workspace_members m where m.workspace_id = r.workspace_id and m.role_id = r.id)::int as users
    from roles r where r.workspace_id = $1 order by r.is_system desc, r.created_at, r.name`, [ws]);
  return rows;
}
const roleExists = async (ws, id) => Boolean((await q('select 1 from roles where workspace_id=$1 and id=$2', [ws, id])).rows[0]);
export async function saveRole({ id, name, description, permissions }) {
  const ws = needWs();
  const perms = [...new Set((permissions || []).filter((k) => ALL.includes(k)))];
  if (!String(name || '').trim()) throw new HttpError(400, 'Give the role a name.');
  if (id) {
    const { rows } = await q('select * from roles where workspace_id = $1 and id = $2', [ws, id]);
    if (!rows[0]) throw new HttpError(404, 'Role not found');
    if (rows[0].is_system) throw new HttpError(400, 'The Administrator role cannot be changed.');
    await q('update roles set name=$3, description=$4, permissions=$5 where workspace_id=$1 and id=$2', [ws, id, name.trim(), description || '', JSON.stringify(perms)]);
    return id;
  }
  const nid = newId();
  await q('insert into roles (workspace_id, id, name, description, permissions) values ($1,$2,$3,$4,$5)', [ws, nid, name.trim(), description || '', JSON.stringify(perms)]);
  return nid;
}
export async function deleteRole(id, replacement) {
  const ws = needWs();
  const { rows } = await q('select * from roles where workspace_id = $1 and id = $2', [ws, id]);
  if (!rows[0]) throw new HttpError(404, 'Role not found');
  if (rows[0].is_system) throw new HttpError(400, 'The Administrator role cannot be deleted.');
  if (replacement && !(await roleExists(ws, replacement))) throw new HttpError(400, 'Unknown role');
  await tx(async (t) => {
    if (replacement) {
      await t.query('update workspace_members set role_id=$3 where workspace_id=$1 and role_id=$2', [ws, id, replacement]);
      await t.query('update invites set role_id=$3 where workspace_id=$1 and role_id=$2', [ws, id, replacement]);
    }
    const used = await t.query('select count(*)::int n from workspace_members where workspace_id=$1 and role_id=$2', [ws, id]);
    if (used.rows[0].n) throw new HttpError(400, 'Move this role\'s users to another role first.');
    await t.query('delete from invites where workspace_id=$1 and role_id=$2 and accepted_at is null', [ws, id]);
    await t.query('delete from roles where workspace_id=$1 and id=$2', [ws, id]);
  });
}

// ---------------------------------------------------------------- users & sessions
export const publicUser = (u) => u && ({
  id: u.id, email: u.email, name: u.name, roleId: u.role_id, roleName: u.role_name, permissions: u.permissions || [],
  projectAccess: u.project_access, isOwner: u.is_owner, status: u.status, createdAt: u.created_at, lastLoginAt: u.last_login_at,
  termsAcceptedAt: u.terms_accepted_at || null, workspaceId: u.workspace_id || null, workspaceName: u.workspace_name || null,
});
// A person as a member of a workspace: their account plus that membership (same field names as before workspaces).
const MEMBER_COLS = `u.id, u.email, u.name, u.password_hash, u.created_at, u.last_login_at, u.terms_version, u.privacy_version,
  u.terms_accepted_at, u.email_verified_at, case when u.status = 'active' then m.status else u.status end as status,
  m.role_id, m.project_access, m.is_owner, m.workspace_id, w.name as workspace_name, r.name as role_name, r.permissions`;
const MEMBER_FROM = `workspace_members m join users u on u.id = m.user_id join workspaces w on w.id = m.workspace_id
  left join roles r on r.workspace_id = m.workspace_id and r.id = m.role_id`;

export async function userCount() { return (await q('select count(*)::int n from users')).rows[0].n; }
/** Someone as a member of the current workspace (or `ws`), or null. */
export async function getUser(id, ws = currentWs()) {
  if (!ws) return getUserAny(id);
  return (await q(`select ${MEMBER_COLS} from ${MEMBER_FROM} where m.user_id = $1 and m.workspace_id = $2`, [id, ws])).rows[0] || null;
}
/** Someone in their first active workspace (after sign-in or a password reset), or null if they belong to none. */
export async function getUserAny(id) {
  return (await q(`select ${MEMBER_COLS} from ${MEMBER_FROM} where m.user_id = $1 order by (m.status = 'active') desc, m.created_at limit 1`, [id])).rows[0] || null;
}
export async function listUsers() {
  return (await q(`select ${MEMBER_COLS} from ${MEMBER_FROM} where m.workspace_id = $1 order by m.is_owner desc, m.created_at`, [needWs()])).rows.map(publicUser);
}

// ---------------------------------------------------------------- consent (Terms of Use, Privacy Policy)
function needTerms(accept) {
  if (accept !== true) throw new HttpError(400, 'Please read and accept the Terms of Use and Privacy Policy to continue.');
}
async function writeAcceptance(x, userId, email, meta = {}) {
  for (const d of ACCEPTED_DOCS) {
    await x.query('insert into legal_acceptances (user_id, email, doc, version, ip, user_agent) values ($1,$2,$3,$4,$5,$6)',
      [userId, email, d, LEGAL_VERSIONS[d].version, String(meta.ip || '').slice(0, 64), String(meta.userAgent || '').slice(0, 200)]);
  }
  await x.query('update users set terms_version=$2, privacy_version=$3, terms_accepted_at=now() where id=$1',
    [userId, LEGAL_VERSIONS.terms.version, LEGAL_VERSIONS.privacy.version]);
}
/** The documents this person still has to accept: never accepted, or a material change since. */
export function legalNeeds(u) {
  if (!u) return [];
  return ACCEPTED_DOCS.filter((d) => LEGAL_VERSIONS[d].material && (u[`${d}_version`] || '') !== LEGAL_VERSIONS[d].version);
}
export const legalStatus = (u) => ({
  needs: legalNeeds(u),
  versions: Object.fromEntries(ACCEPTED_DOCS.map((d) => [d, LEGAL_VERSIONS[d].version])),
  acceptedAt: u?.terms_accepted_at || null,
});
/** A signed-in person accepts the current versions (after a change, or if they joined before consent existed). */
export async function recordAcceptance(u, { accept, ip, userAgent } = {}) {
  needTerms(accept);
  await tx((x) => writeAcceptance(x, u.id, u.email, { ip, userAgent }));
  return getUser(u.id);
}

export async function createOwner({ name, email, password, acceptTerms, company }, meta = {}) {
  email = normEmail(email);
  if (!String(name || '').trim()) throw new HttpError(400, 'Enter your name.');
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  checkPassword(password);
  needTerms(acceptTerms);
  const id = newId();
  const hash = await hashPassword(password);
  await tx(async (t) => {
    const n = (await t.query('select count(*)::int n from users')).rows[0].n;
    if (n) throw new HttpError(409, 'TicketForge is already set up. Sign in instead.');
    await t.query('insert into users (id, email, name, password_hash, role_id, project_access, is_owner) values ($1,$2,$3,$4,$5,$6,true)',
      [id, email, name.trim(), hash, 'admin', JSON.stringify('all')]);
    // The first account owns the default workspace (where data from before workspaces lives).
    if ((await t.query('select 1 from workspaces where id = $1', [DEFAULT_WS])).rows[0]) {
      await t.query('update workspaces set owner_id = $2 where id = $1', [DEFAULT_WS, id]);
      await t.query(`insert into workspace_members (workspace_id, user_id, role_id, project_access, is_owner) values ($1,$2,'admin','"all"',true)
        on conflict (workspace_id, user_id) do update set role_id = 'admin', project_access = '"all"', is_owner = true`, [DEFAULT_WS, id]);
    } else await insertWorkspace(t, { id: DEFAULT_WS, name: company || 'My workspace', ownerId: id });
    await writeAcceptance(t, id, email, meta);
  });
  return getUser(id, DEFAULT_WS);
}

export async function createSession(userId, userAgent = '', ws = null) {
  const t = token();
  await q('insert into sessions (token_hash, user_id, expires_at, user_agent, workspace_id) values ($1,$2,$3,$4,$5)',
    [sha(t), userId, new Date(Date.now() + SESSION_DAYS * 86400000), String(userAgent).slice(0, 200), ws]);
  await q('update users set last_login_at = now() where id = $1', [userId]);
  return { token: t, maxAge: SESSION_DAYS * 86400 };
}
// Every API request looks up who is signed in. Remember the answer briefly so a page load (several requests at
// once) costs one database round trip, not one per request. Any change to users, roles, memberships or sessions
// clears it at once (authGen); on servers with several copies, another copy's change shows within SESSION_CACHE_MS.
const SESSION_CACHE_MS = 15000;
const sessionCache = globalThis.__tfSessionCache ??= new Map();
export async function sessionUser(t) {
  if (!t) return null;
  const key = sha(t), now = Date.now(), gen = authGen();
  const hit = sessionCache.get(key);
  if (hit && hit.gen === gen && now - hit.at < SESSION_CACHE_MS && (!hit.exp || hit.exp > now)) return hit.u;
  // The session's workspace, or (none chosen, or no longer a member) the first workspace the person belongs to.
  const { rows } = await q(`select ${MEMBER_COLS}, s.expires_at as session_expires from sessions s join users u on u.id = s.user_id
    join lateral (select * from workspace_members mm where mm.user_id = u.id and mm.status = 'active'
      order by (mm.workspace_id = coalesce(s.workspace_id, '')) desc, mm.created_at limit 1) m on true
    join workspaces w on w.id = m.workspace_id left join roles r on r.workspace_id = m.workspace_id and r.id = m.role_id
    where s.token_hash = $1 and s.expires_at > now()`, [key]);
  const r = rows[0];
  const u = r && r.status === 'active' ? r : null;
  if (sessionCache.size > 50000) { // drop the oldest tenth (Maps keep insertion order) instead of everyone at once
    let n = 5000;
    for (const k of sessionCache.keys()) { sessionCache.delete(k); if (--n <= 0) break; }
  }
  sessionCache.delete(key);
  sessionCache.set(key, { u, at: now, gen, exp: r ? new Date(r.session_expires).getTime() : 0 });
  return u;
}
export async function destroySession(t) { if (t) await q('delete from sessions where token_hash = $1', [sha(t)]); }
/** Switch this sign-in to another workspace the person belongs to. */
export async function switchWorkspace(t, user, ws) {
  const m = (await q("select 1 from workspace_members where workspace_id=$1 and user_id=$2 and status='active'", [String(ws || ''), user.id])).rows[0];
  if (!m) throw new HttpError(404, 'Workspace not found');
  await q('update sessions set workspace_id=$2 where token_hash=$1', [sha(String(t || '')), ws]);
}

// Simple in-memory throttle for login / forgot-password.
const attempts = new Map();
export function throttle(key, limit = 8, windowMs = 15 * 60000) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit) throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.');
  list.push(now);
  attempts.set(key, list);
}

export async function login(email, password) {
  const { rows } = await q('select * from users u where u.email = $1', [normEmail(email)]);
  const u = rows[0];
  const ok = u && await verifyPassword(String(password || ''), u.password_hash);
  if (!ok) throw new HttpError(401, 'Email or password is incorrect.');
  if (u.status !== 'active') throw new HttpError(403, 'This account is disabled. Ask an administrator to enable it.');
  const m = await getUserAny(u.id);
  if (!m || m.status !== 'active') throw new HttpError(403, 'Your account isn’t part of any workspace right now. Ask a workspace owner to invite you again.');
  return m;
}

export async function updateUser(actor, id, { roleId, projectAccess, status, name }) {
  const ws = needWs();
  const u = await getUser(id, ws);
  if (!u) throw new HttpError(404, 'User not found');
  if (u.is_owner && (roleId && roleId !== 'admin' || status === 'disabled' || (projectAccess && projectAccess !== 'all'))) throw new HttpError(400, 'The owner always keeps full access.');
  if (id === actor.id && status === 'disabled') throw new HttpError(400, 'You cannot disable your own account.');
  if (roleId) {
    if (!(await roleExists(ws, roleId))) throw new HttpError(400, 'Unknown role');
    await q('update workspace_members set role_id=$3 where workspace_id=$1 and user_id=$2', [ws, id, roleId]);
  }
  if (projectAccess !== undefined) await q('update workspace_members set project_access=$3 where workspace_id=$1 and user_id=$2', [ws, id, JSON.stringify(normAccess(projectAccess))]);
  if (status) {
    await q('update workspace_members set status=$3 where workspace_id=$1 and user_id=$2', [ws, id, status === 'disabled' ? 'disabled' : 'active']);
    if (status === 'disabled') await q('delete from sessions where user_id=$1 and workspace_id=$2', [id, ws]);
  }
  // A name belongs to the person's account; another workspace's admin may only change it if this is their only workspace.
  if (name) {
    const others = (await q('select count(*)::int n from workspace_members where user_id=$1 and workspace_id<>$2', [id, ws])).rows[0].n;
    if (!others || id === actor.id) await q('update users set name=$2 where id=$1', [id, String(name).trim()]);
  }
  return publicUser(await getUser(id, ws));
}
/** Removes someone from this workspace. An account left with no workspace is deleted. */
export async function deleteUser(actor, id) {
  const ws = needWs();
  const u = await getUser(id, ws);
  if (!u) throw new HttpError(404, 'User not found');
  if (u.is_owner) throw new HttpError(400, 'The owner cannot be removed.');
  if (id === actor.id) throw new HttpError(400, 'You cannot remove yourself.');
  await tx(async (t) => {
    await t.query('delete from workspace_members where workspace_id=$1 and user_id=$2', [ws, id]);
    await t.query('delete from sessions where user_id=$1 and workspace_id=$2', [id, ws]);
    const left = (await t.query('select count(*)::int n from workspace_members where user_id=$1', [id])).rows[0].n;
    if (!left) await t.query('delete from users where id=$1', [id]);
  });
}
export async function changePassword(user, current, next) {
  if (!(await verifyPassword(String(current || ''), user.password_hash))) throw new HttpError(400, 'Your current password is incorrect.');
  checkPassword(next);
  await q('update users set password_hash=$2 where id=$1', [user.id, await hashPassword(next)]);
}
const normAccess = (a) => (a === 'all' ? 'all' : [...new Set((Array.isArray(a) ? a : []).map(String))]);

// ---------------------------------------------------------------- invites
export async function createInvites(actor, { emails, roleId, projectAccess, message }) {
  const ws = needWs();
  const list = [...new Set(String(emails || '').split(/[\s,;]+/).map(normEmail).filter(Boolean))];
  if (!list.length) throw new HttpError(400, 'Enter at least one email address.');
  const bad = list.filter((e) => !isEmail(e));
  if (bad.length) throw new HttpError(400, `Not a valid email: ${bad.join(', ')}`);
  if (!(await roleExists(ws, roleId))) throw new HttpError(400, 'Choose a role.');
  await checkLimit('members', list.length, ws); // people + pending invites, within the plan (SaaS)
  const out = [];
  for (const email of list) {
    // People who already have an account (in another workspace) can be invited too: they join with their login.
    if ((await q('select 1 from workspace_members m join users u on u.id = m.user_id where m.workspace_id=$1 and u.email=$2', [ws, email])).rows[0]) {
      out.push({ email, error: 'Already a member of this workspace' }); continue;
    }
    await q('update invites set revoked_at = now() where workspace_id=$1 and email=$2 and accepted_at is null and revoked_at is null', [ws, email]);
    const t = token();
    const id = newId();
    await q('insert into invites (id, workspace_id, email, role_id, project_access, message, token_hash, invited_by, expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, ws, email, roleId, JSON.stringify(normAccess(projectAccess)), String(message || '').slice(0, 1000), sha(t), actor.id, new Date(Date.now() + INVITE_DAYS * 86400000)]);
    out.push({ id, email, token: t });
  }
  return out;
}
export async function listInvites() {
  const { rows } = await q(`select i.id, i.email, i.role_id, r.name role_name, i.project_access, i.created_at, i.expires_at, i.accepted_at, i.revoked_at, i.emailed, u.name invited_by_name
    from invites i left join roles r on r.workspace_id = i.workspace_id and r.id = i.role_id left join users u on u.id = i.invited_by
    where i.workspace_id = $1 order by i.created_at desc limit 200`, [needWs()]);
  return rows;
}
export async function reissueInvite(id) {
  const ws = needWs();
  const t = token();
  const { rowCount } = await q('update invites set token_hash=$3, expires_at=$4, revoked_at=null, created_at=now() where id=$1 and workspace_id=$2 and accepted_at is null',
    [id, ws, sha(t), new Date(Date.now() + INVITE_DAYS * 86400000)]);
  if (!rowCount) throw new HttpError(404, 'Invite not found or already accepted');
  const { rows } = await q('select email from invites where id=$1', [id]);
  return { id, email: rows[0].email, token: t };
}
export async function revokeInvite(id) { await q('update invites set revoked_at=now() where id=$1 and workspace_id=$2 and accepted_at is null', [id, needWs()]); }
export async function markEmailed(id, ok) { await q('update invites set emailed=$2 where id=$1', [id, ok]); }

async function inviteByToken(t) {
  const { rows } = await q(`select i.*, r.name role_name, u.name inviter, w.name workspace_name from invites i
    join workspaces w on w.id = i.workspace_id left join roles r on r.workspace_id = i.workspace_id and r.id = i.role_id
    left join users u on u.id = i.invited_by where i.token_hash=$1`, [sha(String(t || ''))]);
  const i = rows[0];
  if (!i || i.revoked_at) throw new HttpError(404, 'This invite link is not valid. Ask for a new invite.');
  if (i.accepted_at) throw new HttpError(410, 'This invite has already been used. Sign in instead.');
  if (new Date(i.expires_at) < new Date()) throw new HttpError(410, 'This invite has expired. Ask for a new one.');
  return i;
}
export async function inviteInfo(t) {
  const i = await inviteByToken(t);
  const existing = Boolean((await q('select 1 from users where email=$1', [i.email])).rows[0]);
  return { email: i.email, role: i.role_name, inviter: i.inviter || 'An administrator', message: i.message, workspace: i.workspace_name, existingAccount: existing };
}
/** New people create their account; people who already have one confirm with their password and join. */
export async function acceptInvite(t, { name, password, acceptTerms }, meta = {}) {
  const i = await inviteByToken(t);
  needTerms(acceptTerms);
  await checkLimit('members', 0, i.workspace_id); // this invite is already counted; a plan that shrank since can stop it
  const existing = (await q('select * from users where email=$1', [i.email])).rows[0];
  let id = existing?.id;
  if (existing) {
    if (!(await verifyPassword(String(password || ''), existing.password_hash))) throw new HttpError(401, 'That password is incorrect. Use the password you sign in with.');
    if (existing.status !== 'active') throw new HttpError(403, 'This account is disabled.');
  } else {
    if (!String(name || '').trim()) throw new HttpError(400, 'Enter your name.');
    checkPassword(password);
  }
  const hash = existing ? null : await hashPassword(password);
  await tx(async (x) => {
    if (!existing) {
      id = newId();
      await x.query('insert into users (id, email, name, password_hash, role_id, project_access) values ($1,$2,$3,$4,$5,$6)',
        [id, i.email, name.trim(), hash, i.role_id, JSON.stringify(i.project_access)]);
    }
    await x.query(`insert into workspace_members (workspace_id, user_id, role_id, project_access) values ($1,$2,$3,$4)
      on conflict (workspace_id, user_id) do update set role_id = excluded.role_id, project_access = excluded.project_access, status = 'active'`,
      [i.workspace_id, id, i.role_id, JSON.stringify(i.project_access)]);
    await x.query('update invites set accepted_at=now() where id=$1', [i.id]);
    await writeAcceptance(x, id, i.email, meta);
  });
  return getUser(id, i.workspace_id);
}

// ---------------------------------------------------------------- sign-up
// SIGNUP_MODE (lib/platform.js): closed = invite only; waitlist = people leave their details and an administrator
// invites them; open = anyone creates an account and gets their own workspace (their company's isolated space).
// On a server with no accounts yet, sign-up creates the owner (the same as /setup).
export async function signup({ name, email, password, company, note, acceptTerms, website }, meta = {}) {
  if (String(website || '').trim()) return { requested: true }; // a hidden field only bots fill in
  if ((await userCount()) === 0) return { user: await createOwner({ name, email, password, acceptTerms, company }, meta) };
  const mode = signupMode();
  if (mode === 'closed') throw new HttpError(403, 'Sign-up is by invitation only. Ask your administrator for an invite.');
  email = normEmail(email);
  if (!String(name || '').trim()) throw new HttpError(400, 'Enter your name.');
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  needTerms(acceptTerms);
  if (mode === 'open') {
    checkPassword(password);
    if ((await q('select 1 from users where email=$1', [email])).rows[0]) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
    const id = newId();
    const ws = `ws_${crypto.randomBytes(6).toString('hex')}`;
    const hash = await hashPassword(password);
    const trialEnds = await trialEndFor(id);
    await tx(async (x) => {
      await x.query("insert into users (id, email, name, password_hash, role_id, project_access) values ($1,$2,$3,$4,'admin','\"all\"')",
        [id, email, String(name).trim().slice(0, 120), hash]);
      await insertWorkspace(x, { id: ws, name: company || `${String(name).trim().split(/\s+/)[0]}'s workspace`, ownerId: id, trialEnds });
      await writeAcceptance(x, id, email, meta);
    });
    return { user: await getUser(id, ws) };
  }
  // Waitlist: same answer whether or not the email already has an account or a request, so the form can't be used to find accounts.
  await q(`insert into signup_requests (id, email, name, company, note) values ($1,$2,$3,$4,$5)
    on conflict (email) do update set name = excluded.name, company = excluded.company, note = excluded.note`,
    [newId(), email, String(name).trim().slice(0, 120), String(company || '').trim().slice(0, 120), String(note || '').trim().slice(0, 1000)]);
  return { requested: true, mode };
}
// The waitlist belongs to whoever runs this TicketForge: the default workspace's owner (or a platform admin).
export async function listSignupRequests() {
  return (await q("select id, email, name, company, note, status, created_at from signup_requests order by created_at desc limit 500")).rows;
}
export async function setSignupRequest(id, status) {
  if (!['pending', 'invited', 'declined'].includes(status)) throw new HttpError(400, 'Unknown status.');
  await q('update signup_requests set status=$2 where id=$1', [id, status]);
}

// ---------------------------------------------------------------- password resets
/** True when the person also belongs to a workspace other than the current one. */
export async function inOtherWorkspaces(userId) {
  return Boolean((await q('select 1 from workspace_members where user_id=$1 and workspace_id<>$2 limit 1', [userId, needWs()])).rows[0]);
}
export async function createReset(userId) {
  const t = token();
  await q('insert into password_resets (token_hash, user_id, expires_at) values ($1,$2,$3)', [sha(t), userId, new Date(Date.now() + RESET_HOURS * 3600000)]);
  return t;
}
export async function userByEmail(email) { return (await q('select * from users where email=$1', [normEmail(email)])).rows[0] || null; }
export async function resetPassword(t, password) {
  checkPassword(password);
  const { rows } = await q('select * from password_resets where token_hash=$1', [sha(String(t || ''))]);
  const r = rows[0];
  if (!r || r.used_at || new Date(r.expires_at) < new Date()) throw new HttpError(410, 'This reset link is invalid or has expired. Request a new one.');
  await tx(async (x) => {
    await x.query('update users set password_hash=$2 where id=$1', [r.user_id, await hashPassword(password)]);
    await x.query('update password_resets set used_at=now() where token_hash=$1', [r.token_hash]);
    await x.query('delete from sessions where user_id=$1', [r.user_id]);
  });
  return getUserAny(r.user_id);
}

// ---------------------------------------------------------------- email
function smtpPass() { return process.env.SMTP_HOST ? process.env.SMTP_PASS || '' : process.env.SENDGRID_API_KEY || ''; }
export function emailConfig() {
  // SendGrid shortcut: SENDGRID_API_KEY (+ SENDGRID_FROM, SENDGRID_FROM_NAME) when no SMTP_HOST is set.
  if (!process.env.SMTP_HOST && process.env.SENDGRID_API_KEY) {
    const addr = process.env.SENDGRID_FROM || '';
    const name = process.env.SENDGRID_FROM_NAME || '';
    return {
      configured: true, provider: 'SendGrid', host: 'smtp.sendgrid.net', port: 587, secure: false, user: 'apikey',
      from: name && addr ? `"${name.replace(/"/g, '')}" <${addr}>` : addr, appUrl: process.env.APP_URL || '',
    };
  }
  const host = process.env.SMTP_HOST || '';
  return {
    configured: Boolean(host),
    host, port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : Number(process.env.SMTP_PORT) === 465,
    user: process.env.SMTP_USER || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    appUrl: process.env.APP_URL || '',
  };
}
let transport = null;
function mailer() {
  const c = emailConfig();
  if (!c.configured) return null;
  transport ??= c.host === 'json'
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: smtpPass() } : undefined });
  return transport;
}
export async function sendMail({ to, subject, text, html }) {
  const m = mailer();
  if (!m) return { sent: false, reason: 'Email is not configured (set SMTP_HOST and related settings).' };
  try {
    const info = await m.sendMail({ from: emailConfig().from || 'TicketForge <no-reply@localhost>', to, subject, text, html });
    if (emailConfig().host === 'json') console.log('[email:json]', info.message.toString().slice(0, 400));
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function emailLayout({ heading, intro, button, url, note }) {
  const html = `<!doctype html><html><body style="margin:0;background:#f7f8f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#172b4d">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
  <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;padding:32px;border:1px solid #dcdfe4">
  <tr><td style="font-size:15px;font-weight:600;color:#0c66e4;padding-bottom:20px">TicketForge</td></tr>
  <tr><td style="font-size:20px;font-weight:600;padding-bottom:12px">${escHtml(heading)}</td></tr>
  <tr><td style="font-size:14px;line-height:22px;padding-bottom:24px;white-space:pre-wrap">${escHtml(intro)}</td></tr>
  <tr><td style="padding-bottom:24px"><a href="${escHtml(url)}" style="background:#0c66e4;color:#fff;text-decoration:none;padding:10px 18px;border-radius:3px;font-weight:600;display:inline-block">${escHtml(button)}</a></td></tr>
  <tr><td style="font-size:12px;line-height:18px;color:#626f86">${escHtml(note)}<br>Or open this link: ${escHtml(url)}</td></tr>
  </table></td></tr></table></body></html>`;
  return { html, text: `${heading}\n\n${intro}\n\n${button}: ${url}\n\n${note}` };
}

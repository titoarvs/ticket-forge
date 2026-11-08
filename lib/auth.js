// Users, roles, sessions, invites, password resets and email.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import nodemailer from 'nodemailer';
// The sign-in system works with sessions, invites and users before anyone is signed in: system context.
import { qs as q, txs as tx, authGen } from './db.js';
import { ALL, DEFAULT_ROLES } from './permissions.js';

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

// ---------------------------------------------------------------- roles
export async function seedRoles() {
  for (const r of DEFAULT_ROLES) {
    await q('insert into roles (id, name, description, permissions, is_system) values ($1,$2,$3,$4,$5) on conflict (id) do nothing',
      [r.id, r.name, r.description, JSON.stringify(r.permissions), r.is_system]);
  }
  // The system admin role always has every permission (new ones included).
  await q('update roles set permissions = $1 where id = $2', [JSON.stringify(ALL), 'admin']);
}
export async function listRoles() {
  const { rows } = await q('select r.*, (select count(*) from users u where u.role_id = r.id)::int as users from roles r order by r.is_system desc, r.created_at, r.name');
  return rows;
}
export async function saveRole({ id, name, description, permissions }) {
  const perms = [...new Set((permissions || []).filter((k) => ALL.includes(k)))];
  if (!String(name || '').trim()) throw new HttpError(400, 'Give the role a name.');
  if (id) {
    const { rows } = await q('select * from roles where id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'Role not found');
    if (rows[0].is_system) throw new HttpError(400, 'The Administrator role cannot be changed.');
    await q('update roles set name=$2, description=$3, permissions=$4 where id=$1', [id, name.trim(), description || '', JSON.stringify(perms)]);
    return id;
  }
  const nid = newId();
  await q('insert into roles (id, name, description, permissions) values ($1,$2,$3,$4)', [nid, name.trim(), description || '', JSON.stringify(perms)]);
  return nid;
}
export async function deleteRole(id, replacement) {
  const { rows } = await q('select * from roles where id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'Role not found');
  if (rows[0].is_system) throw new HttpError(400, 'The Administrator role cannot be deleted.');
  await tx(async (t) => {
    if (replacement) {
      await t.query('update users set role_id=$2 where role_id=$1', [id, replacement]);
      await t.query('update invites set role_id=$2 where role_id=$1', [id, replacement]);
    }
    const used = await t.query('select count(*)::int n from users where role_id=$1', [id]);
    if (used.rows[0].n) throw new HttpError(400, 'Move this role\'s users to another role first.');
    await t.query('delete from invites where role_id=$1 and accepted_at is null', [id]);
    await t.query('delete from roles where id=$1', [id]);
  });
}

// ---------------------------------------------------------------- users & sessions
export const publicUser = (u) => u && ({
  id: u.id, email: u.email, name: u.name, roleId: u.role_id, roleName: u.role_name, permissions: u.permissions || [],
  projectAccess: u.project_access, isOwner: u.is_owner, status: u.status, createdAt: u.created_at, lastLoginAt: u.last_login_at,
});
const USER_SELECT = 'select u.*, r.name as role_name, r.permissions from users u join roles r on r.id = u.role_id';

export async function userCount() { return (await q('select count(*)::int n from users')).rows[0].n; }
export async function getUser(id) { return (await q(`${USER_SELECT} where u.id = $1`, [id])).rows[0] || null; }
export async function listUsers() { return (await q(`${USER_SELECT} order by u.is_owner desc, u.created_at`)).rows.map(publicUser); }

export async function createOwner({ name, email, password }) {
  email = normEmail(email);
  if (!String(name || '').trim()) throw new HttpError(400, 'Enter your name.');
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  checkPassword(password);
  const id = newId();
  const hash = await hashPassword(password);
  await tx(async (t) => {
    const n = (await t.query('select count(*)::int n from users')).rows[0].n;
    if (n) throw new HttpError(409, 'TicketForge is already set up. Sign in instead.');
    await t.query('insert into users (id, email, name, password_hash, role_id, project_access, is_owner) values ($1,$2,$3,$4,$5,$6,true)',
      [id, email, name.trim(), hash, 'admin', JSON.stringify('all')]);
  });
  return getUser(id);
}

export async function createSession(userId, userAgent = '') {
  const t = token();
  await q('insert into sessions (token_hash, user_id, expires_at, user_agent) values ($1,$2,$3,$4)',
    [sha(t), userId, new Date(Date.now() + SESSION_DAYS * 86400000), String(userAgent).slice(0, 200)]);
  await q('update users set last_login_at = now() where id = $1', [userId]);
  return { token: t, maxAge: SESSION_DAYS * 86400 };
}
// Every API request looks up who is signed in. Remember the answer briefly so a page load (several requests at
// once) costs one database round trip, not one per request. Any change to users, roles or sessions clears it
// at once (authGen); on servers with several copies, another copy's change shows within SESSION_CACHE_MS.
const SESSION_CACHE_MS = 15000;
const sessionCache = globalThis.__tfSessionCache ??= new Map();
export async function sessionUser(t) {
  if (!t) return null;
  const key = sha(t), now = Date.now(), gen = authGen();
  const hit = sessionCache.get(key);
  if (hit && hit.gen === gen && now - hit.at < SESSION_CACHE_MS && (!hit.exp || hit.exp > now)) return hit.u;
  const { rows } = await q(`select u.*, r.name as role_name, r.permissions, s.expires_at as session_expires from users u join roles r on r.id = u.role_id
    join sessions s on s.user_id = u.id where s.token_hash = $1 and s.expires_at > now()`, [key]);
  const r = rows[0];
  const u = r && r.status === 'active' ? r : null;
  if (sessionCache.size > 5000) sessionCache.clear();
  sessionCache.set(key, { u, at: now, gen, exp: r ? new Date(r.session_expires).getTime() : 0 });
  return u;
}
export async function destroySession(t) { if (t) await q('delete from sessions where token_hash = $1', [sha(t)]); }

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
  const { rows } = await q(`${USER_SELECT} where u.email = $1`, [normEmail(email)]);
  const u = rows[0];
  const ok = u && await verifyPassword(String(password || ''), u.password_hash);
  if (!ok) throw new HttpError(401, 'Email or password is incorrect.');
  if (u.status !== 'active') throw new HttpError(403, 'This account is disabled. Ask an administrator to enable it.');
  return u;
}

export async function updateUser(actor, id, { roleId, projectAccess, status, name }) {
  const u = await getUser(id);
  if (!u) throw new HttpError(404, 'User not found');
  if (u.is_owner && (roleId && roleId !== 'admin' || status === 'disabled' || (projectAccess && projectAccess !== 'all'))) throw new HttpError(400, 'The owner always keeps full access.');
  if (id === actor.id && status === 'disabled') throw new HttpError(400, 'You cannot disable your own account.');
  if (roleId) {
    if (!(await q('select 1 from roles where id=$1', [roleId])).rows[0]) throw new HttpError(400, 'Unknown role');
    await q('update users set role_id=$2 where id=$1', [id, roleId]);
  }
  if (projectAccess !== undefined) await q('update users set project_access=$2 where id=$1', [id, JSON.stringify(normAccess(projectAccess))]);
  if (status) {
    await q('update users set status=$2 where id=$1', [id, status === 'disabled' ? 'disabled' : 'active']);
    if (status === 'disabled') await q('delete from sessions where user_id=$1', [id]);
  }
  if (name) await q('update users set name=$2 where id=$1', [id, String(name).trim()]);
  return publicUser(await getUser(id));
}
export async function deleteUser(actor, id) {
  const u = await getUser(id);
  if (!u) throw new HttpError(404, 'User not found');
  if (u.is_owner) throw new HttpError(400, 'The owner cannot be removed.');
  if (id === actor.id) throw new HttpError(400, 'You cannot remove yourself.');
  await q('delete from users where id=$1', [id]);
}
export async function changePassword(user, current, next) {
  if (!(await verifyPassword(String(current || ''), user.password_hash))) throw new HttpError(400, 'Your current password is incorrect.');
  checkPassword(next);
  await q('update users set password_hash=$2 where id=$1', [user.id, await hashPassword(next)]);
}
const normAccess = (a) => (a === 'all' ? 'all' : [...new Set((Array.isArray(a) ? a : []).map(String))]);

// ---------------------------------------------------------------- invites
export async function createInvites(actor, { emails, roleId, projectAccess, message }) {
  const list = [...new Set(String(emails || '').split(/[\s,;]+/).map(normEmail).filter(Boolean))];
  if (!list.length) throw new HttpError(400, 'Enter at least one email address.');
  const bad = list.filter((e) => !isEmail(e));
  if (bad.length) throw new HttpError(400, `Not a valid email: ${bad.join(', ')}`);
  if (!(await q('select 1 from roles where id=$1', [roleId])).rows[0]) throw new HttpError(400, 'Choose a role.');
  const out = [];
  for (const email of list) {
    if ((await q('select 1 from users where email=$1', [email])).rows[0]) { out.push({ email, error: 'Already has an account' }); continue; }
    await q('update invites set revoked_at = now() where email=$1 and accepted_at is null and revoked_at is null', [email]);
    const t = token();
    const id = newId();
    await q('insert into invites (id, email, role_id, project_access, message, token_hash, invited_by, expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, email, roleId, JSON.stringify(normAccess(projectAccess)), String(message || '').slice(0, 1000), sha(t), actor.id, new Date(Date.now() + INVITE_DAYS * 86400000)]);
    out.push({ id, email, token: t });
  }
  return out;
}
export async function listInvites() {
  const { rows } = await q(`select i.id, i.email, i.role_id, r.name role_name, i.project_access, i.created_at, i.expires_at, i.accepted_at, i.revoked_at, i.emailed, u.name invited_by_name
    from invites i join roles r on r.id = i.role_id left join users u on u.id = i.invited_by order by i.created_at desc limit 200`);
  return rows;
}
export async function reissueInvite(id) {
  const t = token();
  const { rowCount } = await q('update invites set token_hash=$2, expires_at=$3, revoked_at=null, created_at=now() where id=$1 and accepted_at is null',
    [id, sha(t), new Date(Date.now() + INVITE_DAYS * 86400000)]);
  if (!rowCount) throw new HttpError(404, 'Invite not found or already accepted');
  const { rows } = await q('select email from invites where id=$1', [id]);
  return { id, email: rows[0].email, token: t };
}
export async function revokeInvite(id) { await q('update invites set revoked_at=now() where id=$1 and accepted_at is null', [id]); }
export async function markEmailed(id, ok) { await q('update invites set emailed=$2 where id=$1', [id, ok]); }

async function inviteByToken(t) {
  const { rows } = await q(`select i.*, r.name role_name, u.name inviter from invites i join roles r on r.id=i.role_id left join users u on u.id=i.invited_by
    where i.token_hash=$1`, [sha(String(t || ''))]);
  const i = rows[0];
  if (!i || i.revoked_at) throw new HttpError(404, 'This invite link is not valid. Ask for a new invite.');
  if (i.accepted_at) throw new HttpError(410, 'This invite has already been used. Sign in instead.');
  if (new Date(i.expires_at) < new Date()) throw new HttpError(410, 'This invite has expired. Ask for a new one.');
  return i;
}
export async function inviteInfo(t) {
  const i = await inviteByToken(t);
  return { email: i.email, role: i.role_name, inviter: i.inviter || 'An administrator', message: i.message };
}
export async function acceptInvite(t, { name, password }) {
  const i = await inviteByToken(t);
  if (!String(name || '').trim()) throw new HttpError(400, 'Enter your name.');
  checkPassword(password);
  const id = newId();
  const hash = await hashPassword(password);
  await tx(async (x) => {
    if ((await x.query('select 1 from users where email=$1', [i.email])).rows[0]) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
    await x.query('insert into users (id, email, name, password_hash, role_id, project_access) values ($1,$2,$3,$4,$5,$6)',
      [id, i.email, name.trim(), hash, i.role_id, JSON.stringify(i.project_access)]);
    await x.query('update invites set accepted_at=now() where id=$1', [i.id]);
  });
  return getUser(id);
}

// ---------------------------------------------------------------- password resets
export async function createReset(userId) {
  const t = token();
  await q('insert into password_resets (token_hash, user_id, expires_at) values ($1,$2,$3)', [sha(t), userId, new Date(Date.now() + RESET_HOURS * 3600000)]);
  return t;
}
export async function userByEmail(email) { return (await q(`${USER_SELECT} where u.email=$1`, [normEmail(email)])).rows[0] || null; }
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
  return getUser(r.user_id);
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

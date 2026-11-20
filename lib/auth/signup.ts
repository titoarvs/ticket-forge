import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { qs as q, txs as tx } from '../db';
import { signupMode } from '../platform';
import { checkLimit } from '../limits';
import {
  INVITE_MAX_SENDS,
  HttpError,
  needWs,
  token,
  sha,
  needTerms,
  verifyPassword,
  checkPassword,
  hashPassword,
  newId,
  writeAcceptance,
  getUser,
  userCount,
  createOwner,
  normEmail,
  isEmail,
  insertWorkspace,
  RESET_HOURS,
  getUserAny,
} from './create-owner';
import { INVITE_COOLDOWN_SECONDS, INVITE_DAYS } from './session-cookie';

/**
 * Throws 429 when an invite can't be sent again: the maximum is reached, or the cooldown hasn't
 * passed (says how long to wait).
 */
export function checkResend(inv) {
  if (inv.send_count >= INVITE_MAX_SENDS)
    throw new HttpError(
      429,
      `Invite limit reached: this invite has already been sent ${INVITE_MAX_SENDS} times. Revoke it and create a new one if the person still needs it.`,
    );
  const wait = Math.ceil(
    (new Date(inv.created_at).getTime() + INVITE_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000,
  );
  if (wait > 0)
    throw new HttpError(
      429,
      `This invite was sent recently. You can send it again in ${wait} second${wait === 1 ? '' : 's'}.`,
    );
}
export async function listInvites() {
  const { rows } = await q(
    `select i.id, i.email, i.role_id, r.name role_name, i.project_access, i.created_at, i.expires_at, i.accepted_at, i.revoked_at, i.emailed, u.name invited_by_name
    from invites i left join roles r on r.workspace_id = i.workspace_id and r.id = i.role_id left join users u on u.id = i.invited_by
    where i.workspace_id = $1 order by i.created_at desc limit 200`,
    [needWs()],
  );
  return rows;
}
export async function reissueInvite(id) {
  const ws = needWs();
  const cur = (
    await q(
      'select id, email, created_at, send_count from invites where id=$1 and workspace_id=$2 and accepted_at is null',
      [id, ws],
    )
  ).rows[0];
  if (!cur) throw new HttpError(404, 'Invite not found or already accepted');
  checkResend(cur);
  const t = token();
  // The cooldown and maximum are in the update too, so two parallel requests can't both resend.
  const { rowCount } = await q(
    `update invites set token_hash=$3, expires_at=$4, revoked_at=null, created_at=now(), send_count=send_count+1
    where id=$1 and workspace_id=$2 and accepted_at is null and send_count < $5 and created_at <= now() - ($6 * interval '1 second')`,
    [
      id,
      ws,
      sha(t),
      new Date(Date.now() + INVITE_DAYS * 86400000),
      INVITE_MAX_SENDS,
      INVITE_COOLDOWN_SECONDS,
    ],
  );
  if (!rowCount) throw new HttpError(429, 'This invite was just sent. Try again in a minute.');
  return { id, email: cur.email, token: t };
}
export async function revokeInvite(id) {
  await q(
    'update invites set revoked_at=now() where id=$1 and workspace_id=$2 and accepted_at is null',
    [id, needWs()],
  );
}
export async function markEmailed(id, ok) {
  await q('update invites set emailed=$2 where id=$1', [id, ok]);
}
async function inviteByToken(t) {
  const { rows } = await q(
    `select i.*, r.name role_name, u.name inviter, w.name workspace_name from invites i
    join workspaces w on w.id = i.workspace_id left join roles r on r.workspace_id = i.workspace_id and r.id = i.role_id
    left join users u on u.id = i.invited_by where i.token_hash=$1`,
    [sha(String(t || ''))],
  );
  const i = rows[0];
  if (!i || i.revoked_at)
    throw new HttpError(404, 'This invite link is not valid. Ask for a new invite.');
  if (i.accepted_at)
    throw new HttpError(410, 'This invite has already been used. Sign in instead.');
  if (new Date(i.expires_at) < new Date())
    throw new HttpError(410, 'This invite has expired. Ask for a new one.');
  return i;
}
export async function inviteInfo(t) {
  const i = await inviteByToken(t);
  const existing = Boolean((await q('select 1 from users where email=$1', [i.email])).rows[0]);
  return {
    email: i.email,
    role: i.role_name,
    inviter: i.inviter || 'An administrator',
    message: i.message,
    workspace: i.workspace_name,
    existingAccount: existing,
  };
}
/**
 * New people create their account; people who already have one confirm with their password and
 * join.
 */
export async function acceptInvite(t, { name, password, acceptTerms }: any, meta: any = {}) {
  const i = await inviteByToken(t);
  needTerms(acceptTerms);
  await checkLimit('members', 0, i.workspace_id); // this invite is already counted; a plan that shrank since can stop it
  const existing = (await q('select * from users where email=$1', [i.email])).rows[0];
  let id = existing?.id;
  if (existing) {
    if (!(await verifyPassword(String(password || ''), existing.password_hash)))
      throw new HttpError(401, 'That password is incorrect. Use the password you sign in with.');
    if (existing.status !== 'active') throw new HttpError(403, 'This account is disabled.');
  } else {
    if (!String(name || '').trim()) throw new HttpError(400, 'Enter your name.');
    checkPassword(password);
  }
  const hash = existing ? null : await hashPassword(password);
  await tx(async (x) => {
    if (!existing) {
      id = newId();
      await x.query(
        'insert into users (id, email, name, password_hash, role_id, project_access) values ($1,$2,$3,$4,$5,$6)',
        [id, i.email, name.trim(), hash, i.role_id, JSON.stringify(i.project_access)],
      );
    }
    await x.query(
      `insert into workspace_members (workspace_id, user_id, role_id, project_access) values ($1,$2,$3,$4)
      on conflict (workspace_id, user_id) do update set role_id = excluded.role_id, project_access = excluded.project_access, status = 'active'`,
      [i.workspace_id, id, i.role_id, JSON.stringify(i.project_access)],
    );
    await x.query('update invites set accepted_at=now() where id=$1', [i.id]);
    await writeAcceptance(x, id, i.email, meta);
  });
  return getUser(id, i.workspace_id);
}
// ---------------------------------------------------------------- sign-up SIGNUP_MODE
// (lib/platform.ts): closed = invite only; waitlist = people leave their details and an
// administrator invites them; open = anyone creates an account and gets their own workspace (their
// company's isolated space).
// On a server with no accounts yet, sign-up creates the owner (the same as /setup).
export async function signup(
  { name, email, password, company, note, acceptTerms, website }: any,
  meta: any = {},
) {
  if (String(website || '').trim()) return { requested: true }; // a hidden field only bots fill in
  if ((await userCount()) === 0)
    return { user: await createOwner({ name, email, password, acceptTerms, company }, meta) };
  const mode = signupMode();
  if (mode === 'closed')
    throw new HttpError(
      403,
      'Sign-up is by invitation only. Ask your administrator for an invite.',
    );
  email = normEmail(email);
  if (!String(name || '').trim()) throw new HttpError(400, 'Enter your name.');
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  needTerms(acceptTerms);
  if (mode === 'open') {
    checkPassword(password);
    if ((await q('select 1 from users where email=$1', [email])).rows[0])
      throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
    const id = newId();
    const ws = `ws_${crypto.randomBytes(6).toString('hex')}`;
    const hash = await hashPassword(password);
    await tx(async (x) => {
      await x.query(
        "insert into users (id, email, name, password_hash, role_id, project_access) values ($1,$2,$3,$4,'admin','\"all\"')",
        [id, email, String(name).trim().slice(0, 120), hash],
      );
      await insertWorkspace(x, {
        id: ws,
        name: company || `${String(name).trim().split(/\s+/)[0]}'s workspace`,
        ownerId: id,
      });
      await writeAcceptance(x, id, email, meta);
    });
    return { user: await getUser(id, ws) };
  }
  // Waitlist: same answer whether or not the email already has an account or a request, so the form
  // can't be used to find accounts.
  await q(
    `insert into signup_requests (id, email, name, company, note) values ($1,$2,$3,$4,$5)
    on conflict (email) do update set name = excluded.name, company = excluded.company, note = excluded.note`,
    [
      newId(),
      email,
      String(name).trim().slice(0, 120),
      String(company || '')
        .trim()
        .slice(0, 120),
      String(note || '')
        .trim()
        .slice(0, 1000),
    ],
  );
  return { requested: true, mode };
}
// The waitlist belongs to whoever runs this TicketForge: the default workspace's owner (or a
// platform admin).
export async function listSignupRequests() {
  return (
    await q(
      'select id, email, name, company, note, status, created_at from signup_requests order by created_at desc limit 500',
    )
  ).rows;
}
export async function setSignupRequest(id, status) {
  if (!['pending', 'invited', 'declined'].includes(status))
    throw new HttpError(400, 'Unknown status.');
  await q('update signup_requests set status=$2 where id=$1', [id, status]);
}
// ---------------------------------------------------------------- password resets
/** True when the person also belongs to a workspace other than the current one. */
export async function inOtherWorkspaces(userId) {
  return Boolean(
    (
      await q('select 1 from workspace_members where user_id=$1 and workspace_id<>$2 limit 1', [
        userId,
        needWs(),
      ])
    ).rows[0],
  );
}
export async function createReset(userId) {
  const t = token();
  await q('insert into password_resets (token_hash, user_id, expires_at) values ($1,$2,$3)', [
    sha(t),
    userId,
    new Date(Date.now() + RESET_HOURS * 3600000),
  ]);
  return t;
}
export async function userByEmail(email) {
  return (await q('select * from users where email=$1', [normEmail(email)])).rows[0] || null;
}
export async function resetPassword(t, password) {
  checkPassword(password);
  const { rows } = await q('select * from password_resets where token_hash=$1', [
    sha(String(t || '')),
  ]);
  const r = rows[0];
  if (!r || r.used_at || new Date(r.expires_at) < new Date())
    throw new HttpError(410, 'This reset link is invalid or has expired. Request a new one.');
  await tx(async (x) => {
    await x.query('update users set password_hash=$2 where id=$1', [
      r.user_id,
      await hashPassword(password),
    ]);
    await x.query('update password_resets set used_at=now() where token_hash=$1', [r.token_hash]);
    await x.query('delete from sessions where user_id=$1', [r.user_id]);
  });
  return getUserAny(r.user_id);
}
// ---------------------------------------------------------------- email
function smtpPass() {
  return process.env.SMTP_HOST ? process.env.SMTP_PASS || '' : process.env.SENDGRID_API_KEY || '';
}
export function emailConfig() {
  // SendGrid shortcut: SENDGRID_API_KEY (+ SENDGRID_FROM, SENDGRID_FROM_NAME) when no SMTP_HOST is
  // set.
  if (!process.env.SMTP_HOST && process.env.SENDGRID_API_KEY) {
    const addr = process.env.SENDGRID_FROM || '';
    const name = process.env.SENDGRID_FROM_NAME || '';
    return {
      configured: true,
      provider: 'SendGrid',
      host: 'smtp.sendgrid.net',
      port: 587,
      secure: false,
      user: 'apikey',
      from: name && addr ? `"${name.replace(/"/g, '')}" <${addr}>` : addr,
      appUrl: process.env.APP_URL || '',
    };
  }
  const host = process.env.SMTP_HOST || '';
  return {
    configured: Boolean(host),
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE === 'true'
      : Number(process.env.SMTP_PORT) === 465,
    user: process.env.SMTP_USER || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    appUrl: process.env.APP_URL || '',
  };
}
let transport = null;
function mailer() {
  const c = emailConfig();
  if (!c.configured) return null;
  transport ??=
    c.host === 'json'
      ? nodemailer.createTransport({ jsonTransport: true })
      : nodemailer.createTransport({
          host: c.host,
          port: c.port,
          secure: c.secure,
          auth: c.user ? { user: c.user, pass: smtpPass() } : undefined,
        });
  return transport;
}
export async function sendMail({ to, subject, text, html }: any) {
  const m = mailer();
  if (!m)
    return { sent: false, reason: 'Email is not configured (set SMTP_HOST and related settings).' };
  try {
    const info = await m.sendMail({
      from: emailConfig().from || 'TicketForge <no-reply@localhost>',
      to,
      subject,
      text,
      html,
    });
    if (emailConfig().host === 'json')
      console.log('[email:json]', info.message.toString().slice(0, 400));
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}
const escHtml = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function emailLayout({ heading, intro, button, url, note }: any) {
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

import { qs as q, authGen, txs as tx } from '../db';
import { checkLimit } from '../limits';
import {
  sha,
  MEMBER_COLS,
  HttpError,
  token,
  newId,
  normEmail,
  verifyPassword,
  getUserAny,
  needWs,
  getUser,
  roleExists,
  publicUser,
  checkPassword,
  hashPassword,
  isEmail,
  INVITE_MAX_SENDS,
} from './create-owner';
import { checkResend } from './signup';
import { INVITE_DAYS, INVITE_COOLDOWN_SECONDS } from './session-cookie';

// Every sign-in adds a session row that stays after it expires; with many people the table (and its
// indexes) would grow for good. Sign-ins also clear out expired ones: at most every 10 minutes per
// server, in batches, so a sweep never locks many rows at once or slows the sign-in that triggered
// it (not awaited).
const SWEEP_MS = 10 * 60000;
const SWEEP_BATCH = 5000;
const sweep = (globalThis.__tfSessionSweep ??= { at: 0 });
export function sweepExpired() {
  if (Date.now() - sweep.at < SWEEP_MS) return;
  sweep.at = Date.now();
  q(
    `delete from sessions where token_hash in (select token_hash from sessions where expires_at < now() limit ${SWEEP_BATCH})`,
  ).catch(() => {});
  q(
    `delete from password_resets where token_hash in (select token_hash from password_resets where expires_at < now() - interval '1 day' limit ${SWEEP_BATCH})`,
  ).catch(() => {});
}
// Every API request looks up who is signed in. Remember the answer briefly so a page load (several
// requests at once) costs one database round trip, not one per request. Any change to users, roles,
// memberships or sessions clears it at once (authGen); on servers with several copies, another
// copy's change shows within SESSION_CACHE_MS.
const SESSION_CACHE_MS = 15000;
const sessionCache = (globalThis.__tfSessionCache ??= new Map());
export async function sessionUser(t) {
  if (!t) return null;
  const key = sha(t),
    now = Date.now(),
    gen = authGen();
  const hit = sessionCache.get(key);
  if (hit && hit.gen === gen && now - hit.at < SESSION_CACHE_MS && (!hit.exp || hit.exp > now))
    return hit.u;
  // The session's workspace, or (none chosen, or no longer a member) the first workspace the person
  // belongs to.
  const { rows } = await q(
    `select ${MEMBER_COLS}, s.expires_at as session_expires from sessions s join users u on u.id = s.user_id
    join lateral (select * from workspace_members mm where mm.user_id = u.id and mm.status = 'active'
      order by (mm.workspace_id = coalesce(s.workspace_id, '')) desc, mm.created_at limit 1) m on true
    join workspaces w on w.id = m.workspace_id left join roles r on r.workspace_id = m.workspace_id and r.id = m.role_id
    where s.token_hash = $1 and s.expires_at > now()`,
    [key],
  );
  const r = rows[0];
  const u = r && r.status === 'active' ? r : null;
  if (sessionCache.size > 50000) {
    // drop the oldest tenth (Maps keep insertion order) instead of everyone at once
    let n = 5000;
    for (const k of sessionCache.keys()) {
      sessionCache.delete(k);
      if (--n <= 0) break;
    }
  }
  sessionCache.delete(key);
  sessionCache.set(key, { u, at: now, gen, exp: r ? new Date(r.session_expires).getTime() : 0 });
  return u;
}
export async function destroySession(t) {
  if (t) await q('delete from sessions where token_hash = $1', [sha(t)]);
}
/** Switch this sign-in to another workspace the person belongs to. */
export async function switchWorkspace(t, user, ws) {
  const m = (
    await q(
      "select 1 from workspace_members where workspace_id=$1 and user_id=$2 and status='active'",
      [String(ws || ''), user.id],
    )
  ).rows[0];
  if (!m) throw new HttpError(404, 'Workspace not found');
  await q('update sessions set workspace_id=$2 where token_hash=$1', [sha(String(t || '')), ws]);
}
// ---------------------------------------------------------------- API tokens (MCP clients) A token
// acts as one person in one workspace, with that person's role at the time of each call (nothing
// about the role is copied into the token). Only the hash is stored: the token itself is shown
// once, when it is made.
export const API_TOKEN_PREFIX = 'tfk_';
const API_TOKEN_DEFAULT_DAYS = 90;
const API_TOKEN_MAX_DAYS = 365;
const API_TOKEN_MAX_ACTIVE = 20;
/**
 * Makes a token for the signed-in person (in their current workspace). Returns { token, id, name,
 * expiresAt }; `token` is never shown again.
 */
export async function createApiToken(user, { name, expiresInDays }: any = {}) {
  const label = String(name || '')
    .trim()
    .slice(0, 80);
  if (!label)
    throw new HttpError(400, 'Give the token a name, for example the tool that will use it.');
  const days = expiresInDays == null ? API_TOKEN_DEFAULT_DAYS : Number(expiresInDays);
  if (!Number.isInteger(days) || days < 1 || days > API_TOKEN_MAX_DAYS)
    throw new HttpError(
      400,
      `Expiry must be a whole number of days from 1 to ${API_TOKEN_MAX_DAYS}.`,
    );
  const active = (
    await q(
      'select count(*)::int n from api_tokens where user_id = $1 and workspace_id = $2 and revoked_at is null and (expires_at is null or expires_at > now())',
      [user.id, user.workspace_id],
    )
  ).rows[0].n;
  if (active >= API_TOKEN_MAX_ACTIVE)
    throw new HttpError(
      400,
      `You already have ${API_TOKEN_MAX_ACTIVE} active tokens. Revoke one first.`,
    );
  const raw = `${API_TOKEN_PREFIX}${token()}`;
  const id = newId();
  const expiresAt = new Date(Date.now() + days * 86400000);
  await q(
    'insert into api_tokens (id, token_hash, user_id, workspace_id, name, expires_at) values ($1,$2,$3,$4,$5,$6)',
    [id, sha(raw), user.id, user.workspace_id, label, expiresAt],
  );
  return { token: raw, id, name: label, expiresAt };
}
/** The person's own tokens in this workspace (never the token itself). */
export async function listApiTokens(user) {
  return (
    await q(
      `select id, name, created_at as "createdAt", expires_at as "expiresAt", last_used_at as "lastUsedAt", revoked_at as "revokedAt"
      from api_tokens where user_id = $1 and workspace_id = $2 order by created_at desc`,
      [user.id, user.workspace_id],
    )
  ).rows;
}
export async function revokeApiToken(user, id) {
  const done = await q(
    'update api_tokens set revoked_at = now() where id = $1 and user_id = $2 and workspace_id = $3 and revoked_at is null returning id',
    [String(id || ''), user.id, user.workspace_id],
  );
  if (!done.rows[0]) throw new HttpError(404, 'Token not found');
}
/**
 * Who a token acts as: the person as a member of the token's workspace (so their role, permissions
 * and project access are read fresh on every call), or null when the token is unknown, revoked or
 * expired, or the person or membership is no longer active.
 */
export async function apiTokenUser(raw) {
  const t = String(raw || '');
  if (!t.startsWith(API_TOKEN_PREFIX) || t.length > 200) return null;
  const { rows } = await q(
    `select ${MEMBER_COLS}, t.id as token_id from api_tokens t join users u on u.id = t.user_id
    join workspace_members m on m.user_id = u.id and m.workspace_id = t.workspace_id
    join workspaces w on w.id = m.workspace_id left join roles r on r.workspace_id = m.workspace_id and r.id = m.role_id
    where t.token_hash = $1 and t.revoked_at is null and (t.expires_at is null or t.expires_at > now())`,
    [sha(t)],
  );
  const r = rows[0];
  if (!r || r.status !== 'active') return null;
  // "Last used" is only for the person's token list: written at most once a minute per token.
  await q(
    "update api_tokens set last_used_at = now() where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')",
    [r.token_id],
  ).catch(() => {});
  return r;
}
// Simple in-memory throttle for login / forgot-password. Keys (addresses, emails) whose attempts
// are all outside the window are dropped once the map gets big, so a flood of different keys can't
// grow server memory without end.
const attempts: Map<any, any> = new Map();
const ATTEMPT_KEYS_MAX = 20000;
export function throttle(key, limit = 8, windowMs = 15 * 60000) {
  const now = Date.now();
  if (attempts.size >= ATTEMPT_KEYS_MAX) {
    for (const [k, list] of attempts)
      if (!list.length || now - list[list.length - 1] >= windowMs) attempts.delete(k);
    // Still full (a flood inside one window): forget the oldest tenth (Maps keep insertion order).
    if (attempts.size >= ATTEMPT_KEYS_MAX) {
      let n = ATTEMPT_KEYS_MAX / 10;
      for (const k of attempts.keys()) {
        attempts.delete(k);
        if (--n <= 0) break;
      }
    }
  }
  const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit)
    throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.');
  list.push(now);
  attempts.set(key, list);
}
export async function login(email, password) {
  const { rows } = await q('select * from users u where u.email = $1', [normEmail(email)]);
  const u = rows[0];
  const ok = u && (await verifyPassword(String(password || ''), u.password_hash));
  if (!ok) throw new HttpError(401, 'Email or password is incorrect.');
  if (u.status !== 'active')
    throw new HttpError(403, 'This account is disabled. Ask an administrator to enable it.');
  const m = await getUserAny(u.id);
  if (!m || m.status !== 'active')
    throw new HttpError(
      403,
      'Your account isn’t part of any workspace right now. Ask a workspace owner to invite you again.',
    );
  return m;
}
export async function updateUser(actor, id, { roleId, projectAccess, status, name }: any) {
  const ws = needWs();
  const u = await getUser(id, ws);
  if (!u) throw new HttpError(404, 'User not found');
  if (
    u.is_owner &&
    ((roleId && roleId !== 'admin') ||
      status === 'disabled' ||
      (projectAccess && projectAccess !== 'all'))
  )
    throw new HttpError(400, 'The owner always keeps full access.');
  if (id === actor.id && status === 'disabled')
    throw new HttpError(400, 'You cannot disable your own account.');
  if (roleId) {
    if (!(await roleExists(ws, roleId))) throw new HttpError(400, 'Unknown role');
    await q('update workspace_members set role_id=$3 where workspace_id=$1 and user_id=$2', [
      ws,
      id,
      roleId,
    ]);
  }
  if (projectAccess !== undefined)
    await q('update workspace_members set project_access=$3 where workspace_id=$1 and user_id=$2', [
      ws,
      id,
      JSON.stringify(normAccess(projectAccess)),
    ]);
  if (status) {
    await q('update workspace_members set status=$3 where workspace_id=$1 and user_id=$2', [
      ws,
      id,
      status === 'disabled' ? 'disabled' : 'active',
    ]);
    if (status === 'disabled')
      await q('delete from sessions where user_id=$1 and workspace_id=$2', [id, ws]);
  }
  // A name belongs to the person's account; another workspace's admin may only change it if this is
  // their only workspace.
  if (name) {
    const others = (
      await q(
        'select count(*)::int n from workspace_members where user_id=$1 and workspace_id<>$2',
        [id, ws],
      )
    ).rows[0].n;
    if (!others || id === actor.id)
      await q('update users set name=$2 where id=$1', [id, String(name).trim()]);
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
    const left = (
      await t.query('select count(*)::int n from workspace_members where user_id=$1', [id])
    ).rows[0].n;
    if (!left) await t.query('delete from users where id=$1', [id]);
  });
}
export async function changePassword(user, current, next) {
  if (!(await verifyPassword(String(current || ''), user.password_hash)))
    throw new HttpError(400, 'Your current password is incorrect.');
  checkPassword(next);
  await q('update users set password_hash=$2 where id=$1', [user.id, await hashPassword(next)]);
}
const normAccess = (a) =>
  a === 'all' ? 'all' : [...new Set((Array.isArray(a) ? a : []).map(String))];
// ---------------------------------------------------------------- invites
export async function createInvites(actor, { emails, roleId, projectAccess, message }: any) {
  const ws = needWs();
  const list = [
    ...new Set(
      String(emails || '')
        .split(/[\s,;]+/)
        .map(normEmail)
        .filter(Boolean),
    ),
  ];
  if (!list.length) throw new HttpError(400, 'Enter at least one email address.');
  const bad = list.filter((e) => !isEmail(e));
  if (bad.length) throw new HttpError(400, `Not a valid email: ${bad.join(', ')}`);
  if (!(await roleExists(ws, roleId))) throw new HttpError(400, 'Choose a role.');
  // Emails that already have a pending invite are resends (they don't add to the member count).
  const pendingOf = async (email) =>
    (
      await q(
        'select id, created_at, send_count from invites where workspace_id=$1 and email=$2 and accepted_at is null and revoked_at is null and expires_at > now() order by created_at desc limit 1',
        [ws, email],
      )
    ).rows[0];
  let fresh = 0;
  for (const email of list) if (!(await pendingOf(email))) fresh++;
  if (fresh) await checkLimit('members', fresh, ws); // people + pending invites, within the plan (SaaS)
  const out: any[] = [];
  for (const email of list) {
    // People who already have an account (in another workspace) can be invited too: they join with
    // their login.
    if (
      (
        await q(
          'select 1 from workspace_members m join users u on u.id = m.user_id where m.workspace_id=$1 and u.email=$2',
          [ws, email],
        )
      ).rows[0]
    ) {
      out.push({ email, error: 'Already a member of this workspace' });
      continue;
    }
    const access = JSON.stringify(normAccess(projectAccess));
    const note = String(message || '').slice(0, 1000);
    const pending = await pendingOf(email);
    if (pending) {
      // Inviting the same email again is a resend: refused during the cooldown and past the
      // maximum.
      try {
        checkResend(pending);
        const t = token();
        const { rowCount } = await q(
          `update invites set token_hash=$3, expires_at=$4, created_at=now(), send_count=send_count+1, role_id=$5, project_access=$6, message=$7, invited_by=$8
          where id=$1 and workspace_id=$2 and accepted_at is null and revoked_at is null and send_count < $9 and created_at <= now() - ($10 * interval '1 second')`,
          [
            pending.id,
            ws,
            sha(t),
            new Date(Date.now() + INVITE_DAYS * 86400000),
            roleId,
            access,
            note,
            actor.id,
            INVITE_MAX_SENDS,
            INVITE_COOLDOWN_SECONDS,
          ],
        );
        if (!rowCount)
          throw new HttpError(429, 'This invite was just sent. Try again in a minute.'); // a parallel request won
        out.push({ id: pending.id, email, token: t });
      } catch (e) {
        if (!(e instanceof HttpError) || list.length === 1) throw e; // a single email fails the whole request
        out.push({ email, error: e.message });
      }
      continue;
    }
    await q(
      'update invites set revoked_at = now() where workspace_id=$1 and email=$2 and accepted_at is null and revoked_at is null',
      [ws, email],
    ); // expired ones
    const t = token();
    const id = newId();
    await q(
      'insert into invites (id, workspace_id, email, role_id, project_access, message, token_hash, invited_by, expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        id,
        ws,
        email,
        roleId,
        access,
        note,
        sha(t),
        actor.id,
        new Date(Date.now() + INVITE_DAYS * 86400000),
      ],
    );
    out.push({ id, email, token: t });
  }
  return out;
}

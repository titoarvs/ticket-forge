import crypto from 'node:crypto';
import { currentWs, qs as q, txs as tx, DEFAULT_WS } from '../db';
import { DEFAULT_ROLES, ALL } from '../permissions';
import { ACCEPTED_DOCS, LEGAL_VERSIONS } from '../legal/versions';
import { scrypt, SESSION_DAYS } from './session-cookie';
import { sweepExpired } from './create-invites';

// times one invite can be sent in total (first send + resends)
export const INVITE_MAX_SENDS = 5;
export const RESET_HOURS = 2;
export const newId = () => crypto.randomUUID();
export const token = () => crypto.randomBytes(32).toString('base64url');
export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const normEmail = (e) =>
  String(e || '')
    .trim()
    .toLowerCase();
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export class HttpError extends Error {
  status: number;
  extra?: any;
  constructor(status: number, msg?: string) {
    super(msg);
    this.status = status;
  }
}
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
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length, {
    N: Number(n),
    r: 8,
    p: 1,
  });
  return crypto.timingSafeEqual(want, got);
}
export function checkPassword(pw) {
  if (String(pw || '').length < 8)
    throw new HttpError(400, 'Use a password of at least 8 characters.');
}
// ---------------------------------------------------------------- workspaces Everything about
// people (role, project access, owner, enabled) belongs to their membership of a workspace. The
// workspace is the request's (see db.js currentWs); functions that run before anyone is signed in
// take it explicitly.
export function needWs(ws = currentWs()) {
  if (!ws) throw new HttpError(500, 'No workspace for this request.');
  return ws;
}
const wsName = (n) =>
  String(n || '')
    .trim()
    .slice(0, 80);
/**
 * A new workspace with the starter roles and its owner as the first member (inside a transaction
 * `x`).
 */
export async function insertWorkspace(x, { id, name, ownerId }: any) {
  // Every new workspace starts on the free plan; a paid plan (and its trial) is started later from
  // Billing.
  await x.query("insert into workspaces (id, name, owner_id, plan) values ($1,$2,$3,'free')", [
    id,
    wsName(name) || 'My workspace',
    ownerId,
  ]);
  await seedRolesWith(x, id);
  await x.query(
    `insert into workspace_members (workspace_id, user_id, role_id, project_access, is_owner) values ($1,$2,'admin','"all"',true)`,
    [id, ownerId],
  );
}
/** A signed-in person creates another workspace, which they own. */
export async function createWorkspace(user, { name }: any) {
  if (!wsName(name)) throw new HttpError(400, 'Give the workspace a name.');
  const n = (await q('select count(*)::int n from workspaces where owner_id = $1', [user.id]))
    .rows[0].n;
  if (n >= 20) throw new HttpError(400, 'You already own 20 workspaces.');
  const id = `ws_${crypto.randomBytes(6).toString('hex')}`;
  await tx((x) => insertWorkspace(x, { id, name, ownerId: user.id }));
  return { id, name: wsName(name) };
}
export async function listMyWorkspaces(userId) {
  // projects: how many this person can open there (all of them, or those on their access list or
  // that they made).
  return (
    await q(
      `select w.id, w.name, w.plan, m.is_owner, r.name as role_name,
      (select count(*) from projects p where p.workspace_id = w.id
        and (m.is_owner or m.project_access = '"all"'::jsonb or m.project_access ? p.id or p.created_by = m.user_id))::int as projects
    from workspace_members m join workspaces w on w.id = m.workspace_id
    left join roles r on r.workspace_id = m.workspace_id and r.id = m.role_id
    where m.user_id = $1 and m.status = 'active' order by w.name, w.created_at`,
      [userId],
    )
  ).rows.map((w) => ({
    id: w.id,
    name: w.name,
    plan: w.plan,
    isOwner: w.is_owner,
    role: w.role_name,
    projects: w.projects,
  }));
}
export async function renameWorkspace(actor, name) {
  if (!actor.is_owner) throw new HttpError(403, 'Only the workspace owner can rename it.');
  if (!wsName(name)) throw new HttpError(400, 'Give the workspace a name.');
  await q('update workspaces set name=$2 where id=$1', [needWs(), wsName(name)]);
}
// ---------------------------------------------------------------- roles
async function seedRolesWith(x, ws) {
  for (const r of DEFAULT_ROLES) {
    await x.query(
      'insert into roles (workspace_id, id, name, description, permissions, is_system) values ($1,$2,$3,$4,$5,$6) on conflict (workspace_id, id) do nothing',
      [ws, r.id, r.name, r.description, JSON.stringify(r.permissions), r.is_system],
    );
  }
  // The system admin role always has every permission (new ones included).
  await x.query('update roles set permissions = $1 where workspace_id = $2 and id = $3', [
    JSON.stringify(ALL),
    ws,
    'admin',
  ]);
}
/**
 * At start-up: the default workspace's roles, and every workspace's Administrator role gets new
 * permissions.
 */
export async function seedRoles() {
  await seedRolesWith({ query: q }, DEFAULT_WS);
  await q('update roles set permissions = $1 where id = $2', [JSON.stringify(ALL), 'admin']);
  // Restoring issue versions is for admins and managers: give it once to the existing Project lead
  // role (an admin can take it away again afterwards, so this runs only one time).
  const seeded = await q(
    "insert into app_meta (key, value) values ('perm_issue_restore', $1) on conflict (key) do nothing returning key",
    [JSON.stringify({ at: new Date().toISOString() })],
  );
  if (seeded.rows[0])
    await q(
      `update roles set permissions = permissions || '["issue.restore"]'::jsonb where id = 'lead' and not permissions ? 'issue.restore'`,
    );
  // Setting up a project's database: given once to the Project lead role, like issue.restore above.
  const dbSeeded = await q(
    "insert into app_meta (key, value) values ('perm_project_database', $1) on conflict (key) do nothing returning key",
    [JSON.stringify({ at: new Date().toISOString() })],
  );
  if (dbSeeded.rows[0])
    await q(
      `update roles set permissions = permissions || '["project.database"]'::jsonb where id = 'lead' and not permissions ? 'project.database'`,
    );
}
export async function listRoles() {
  const ws = needWs();
  const { rows } = await q(
    `select r.*, (select count(*) from workspace_members m where m.workspace_id = r.workspace_id and m.role_id = r.id)::int as users
    from roles r where r.workspace_id = $1 order by r.is_system desc, r.created_at, r.name`,
    [ws],
  );
  return rows;
}
export const roleExists = async (ws, id) =>
  Boolean((await q('select 1 from roles where workspace_id=$1 and id=$2', [ws, id])).rows[0]);
export async function saveRole({ id, name, description, permissions }: any) {
  const ws = needWs();
  const perms = [...new Set((permissions || []).filter((k) => ALL.includes(k)))];
  if (!String(name || '').trim()) throw new HttpError(400, 'Give the role a name.');
  if (id) {
    const { rows } = await q('select * from roles where workspace_id = $1 and id = $2', [ws, id]);
    if (!rows[0]) throw new HttpError(404, 'Role not found');
    if (rows[0].is_system) throw new HttpError(400, 'The Administrator role cannot be changed.');
    await q(
      'update roles set name=$3, description=$4, permissions=$5 where workspace_id=$1 and id=$2',
      [ws, id, name.trim(), description || '', JSON.stringify(perms)],
    );
    return id;
  }
  const nid = newId();
  await q(
    'insert into roles (workspace_id, id, name, description, permissions) values ($1,$2,$3,$4,$5)',
    [ws, nid, name.trim(), description || '', JSON.stringify(perms)],
  );
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
      await t.query(
        'update workspace_members set role_id=$3 where workspace_id=$1 and role_id=$2',
        [ws, id, replacement],
      );
      await t.query('update invites set role_id=$3 where workspace_id=$1 and role_id=$2', [
        ws,
        id,
        replacement,
      ]);
    }
    const used = await t.query(
      'select count(*)::int n from workspace_members where workspace_id=$1 and role_id=$2',
      [ws, id],
    );
    if (used.rows[0].n) throw new HttpError(400, "Move this role's users to another role first.");
    await t.query(
      'delete from invites where workspace_id=$1 and role_id=$2 and accepted_at is null',
      [ws, id],
    );
    await t.query('delete from roles where workspace_id=$1 and id=$2', [ws, id]);
  });
}
// ---------------------------------------------------------------- users & sessions
export const publicUser = (u) =>
  u && {
    id: u.id,
    email: u.email,
    name: u.name,
    roleId: u.role_id,
    roleName: u.role_name,
    permissions: u.permissions || [],
    projectAccess: u.project_access,
    isOwner: u.is_owner,
    status: u.status,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
    termsAcceptedAt: u.terms_accepted_at || null,
    workspaceId: u.workspace_id || null,
    workspaceName: u.workspace_name || null,
  };
// A person as a member of a workspace: their account plus that membership (same field names as
// before workspaces).
export const MEMBER_COLS = `u.id, u.email, u.name, u.password_hash, u.created_at, u.last_login_at, u.terms_version, u.privacy_version,
  u.terms_accepted_at, u.email_verified_at, case when u.status = 'active' then m.status else u.status end as status,
  m.role_id, m.project_access, m.is_owner, m.workspace_id, w.name as workspace_name, r.name as role_name, r.permissions`;
const MEMBER_FROM = `workspace_members m join users u on u.id = m.user_id join workspaces w on w.id = m.workspace_id
  left join roles r on r.workspace_id = m.workspace_id and r.id = m.role_id`;
export async function userCount() {
  return (await q('select count(*)::int n from users')).rows[0].n;
}
/** Someone as a member of the current workspace (or `ws`), or null. */
export async function getUser(id, ws = currentWs()) {
  if (!ws) return getUserAny(id);
  return (
    (
      await q(
        `select ${MEMBER_COLS} from ${MEMBER_FROM} where m.user_id = $1 and m.workspace_id = $2`,
        [id, ws],
      )
    ).rows[0] || null
  );
}
/**
 * Someone in their first active workspace (after sign-in or a password reset), or null if they
 * belong to none.
 */
export async function getUserAny(id) {
  return (
    (
      await q(
        `select ${MEMBER_COLS} from ${MEMBER_FROM} where m.user_id = $1 order by (m.status = 'active') desc, m.created_at limit 1`,
        [id],
      )
    ).rows[0] || null
  );
}
export async function listUsers() {
  return (
    await q(
      `select ${MEMBER_COLS} from ${MEMBER_FROM} where m.workspace_id = $1 order by m.is_owner desc, m.created_at`,
      [needWs()],
    )
  ).rows.map(publicUser);
}
// ---------------------------------------------------------------- consent (Terms of Use, Privacy
// Policy)
export function needTerms(accept) {
  if (accept !== true)
    throw new HttpError(
      400,
      'Please read and accept the Terms of Use and Privacy Policy to continue.',
    );
}
export async function writeAcceptance(x, userId, email, meta: any = {}) {
  for (const d of ACCEPTED_DOCS) {
    await x.query(
      'insert into legal_acceptances (user_id, email, doc, version, ip, user_agent) values ($1,$2,$3,$4,$5,$6)',
      [
        userId,
        email,
        d,
        LEGAL_VERSIONS[d].version,
        String(meta.ip || '').slice(0, 64),
        String(meta.userAgent || '').slice(0, 200),
      ],
    );
  }
  await x.query(
    'update users set terms_version=$2, privacy_version=$3, terms_accepted_at=now() where id=$1',
    [userId, LEGAL_VERSIONS.terms.version, LEGAL_VERSIONS.privacy.version],
  );
}
/** The documents this person still has to accept: never accepted, or a material change since. */
export function legalNeeds(u) {
  if (!u) return [];
  return ACCEPTED_DOCS.filter(
    (d) => LEGAL_VERSIONS[d].material && (u[`${d}_version`] || '') !== LEGAL_VERSIONS[d].version,
  );
}
export const legalStatus = (u) => ({
  needs: legalNeeds(u),
  versions: Object.fromEntries(ACCEPTED_DOCS.map((d) => [d, LEGAL_VERSIONS[d].version])),
  acceptedAt: u?.terms_accepted_at || null,
});
/**
 * A signed-in person accepts the current versions (after a change, or if they joined before consent
 * existed).
 */
export async function recordAcceptance(u, { accept, ip, userAgent }: any = {}) {
  needTerms(accept);
  await tx((x) => writeAcceptance(x, u.id, u.email, { ip, userAgent }));
  return getUser(u.id);
}
export async function createOwner(
  { name, email, password, acceptTerms, company }: any,
  meta: any = {},
) {
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
    await t.query(
      'insert into users (id, email, name, password_hash, role_id, project_access, is_owner) values ($1,$2,$3,$4,$5,$6,true)',
      [id, email, name.trim(), hash, 'admin', JSON.stringify('all')],
    );
    // The first account owns the default workspace (where data from before workspaces lives).
    if ((await t.query('select 1 from workspaces where id = $1', [DEFAULT_WS])).rows[0]) {
      await t.query('update workspaces set owner_id = $2 where id = $1', [DEFAULT_WS, id]);
      await t.query(
        `insert into workspace_members (workspace_id, user_id, role_id, project_access, is_owner) values ($1,$2,'admin','"all"',true)
        on conflict (workspace_id, user_id) do update set role_id = 'admin', project_access = '"all"', is_owner = true`,
        [DEFAULT_WS, id],
      );
    } else
      await insertWorkspace(t, { id: DEFAULT_WS, name: company || 'My workspace', ownerId: id });
    await writeAcceptance(t, id, email, meta);
  });
  return getUser(id, DEFAULT_WS);
}
export async function createSession(userId, userAgent = '', ws = null) {
  const t = token();
  await q(
    'insert into sessions (token_hash, user_id, expires_at, user_agent, workspace_id) values ($1,$2,$3,$4,$5)',
    [
      sha(t),
      userId,
      new Date(Date.now() + SESSION_DAYS * 86400000),
      String(userAgent).slice(0, 200),
      ws,
    ],
  );
  await q('update users set last_login_at = now() where id = $1', [userId]);
  sweepExpired();
  return { token: t, maxAge: SESSION_DAYS * 86400 };
}
